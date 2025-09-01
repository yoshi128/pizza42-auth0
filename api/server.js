// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import axios from "axios"; // Management API (email check + minimal profile enrichment)

dotenv.config();

const {
  PORT = 3001,
  CORS_ORIGINS = "",
  AUTH0_DOMAIN,
  AUTH0_AUDIENCE,
  DATABASE_URL,
  MGMT_CLIENT_ID,
  MGMT_CLIENT_SECRET,
} = process.env;

// ---------- App & Middleware ----------
const app = express();
app.use(express.json());

// CORS, allowed origins
const origins = CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

// ---------- JWT Resource Server (RS256) ----------
if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.error("Missing AUTH0_DOMAIN or AUTH0_AUDIENCE.");
  process.exit(1);
}
const checkJwt = auth({
  audience: AUTH0_AUDIENCE,
  issuerBaseURL: `https://${AUTH0_DOMAIN}/`,
  tokenSigningAlg: "RS256",
});

// ---------- Postgres ----------
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}
const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  // TLS on; in production prefer validating CA instead of rejectUnauthorized:false
  ssl: { rejectUnauthorized: false },
});

// Creates tables if they don't exist
async function initSchema() {
  const ddl = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    auth0_sub TEXT UNIQUE NOT NULL,
    email TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    items JSONB NOT NULL,
    total NUMERIC(10,2) NOT NULL,
    address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`;
  await pool.query(ddl);
  console.log("DB schema ready.");
}

async function ensureUser(auth0Sub, email) {
  const q = `
    INSERT INTO users (auth0_sub, email)
    VALUES ($1,$2)
    ON CONFLICT (auth0_sub) DO UPDATE SET email = EXCLUDED.email
    RETURNING id`;
  const { rows } = await pool.query(q, [auth0Sub, email || null]);
  return rows[0].id;
}

// ---------- Management API helpers ----------
let mgmtCache = { token: null, exp: 0 }; // simple in-memory cache
async function getMgmtToken() {
  if (!MGMT_CLIENT_ID || !MGMT_CLIENT_SECRET) {
    throw new Error("Missing MGMT_CLIENT_ID / MGMT_CLIENT_SECRET");
  }
  const now = Math.floor(Date.now() / 1000);
  if (mgmtCache.token && mgmtCache.exp - 30 > now) return mgmtCache.token;

  const { data } = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
    client_id: MGMT_CLIENT_ID,
    client_secret: MGMT_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: "client_credentials",
  });
  mgmtCache = { token: data.access_token, exp: now + data.expires_in };
  return mgmtCache.token;
}

async function isEmailVerifiedViaMgmtApi(sub) {
  try {
    const mgmt = await getMgmtToken();
    const { data: user } = await axios.get(
      `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(sub)}`,
      { headers: { Authorization: `Bearer ${mgmt}` } }
    );
    return !!user.email_verified;
  } catch (e) {
    console.error("Mgmt API email check failed:", e?.response?.data || e.message);
    return null;
  }
}

// Update profile: count + last order summary (not full order body)
async function updateProfileOrderSummary(sub, summary /* {id,total,created_at} */) {
  try {
    const mgmt = await getMgmtToken();
    const base = `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(sub)}`;

    // read current metadata
    const { data: user } = await axios.get(base, {
      headers: { Authorization: `Bearer ${mgmt}` }
    });

    const meta = user.app_metadata || {};
    const orders_count = (meta.orders_count || 0) + 1;

    const patch = {
      app_metadata: {
        ...meta,
        orders_count,
        last_order: {
          id: summary.id,
          total: summary.total,
          created_at: summary.created_at
        }
      }
    };

    await axios.patch(base, patch, {
      headers: { Authorization: `Bearer ${mgmt}` }
    });
  } catch (e) {
    console.error("profile enrichment failed:", e?.response?.data || e.message);
  }
}

// ---------- Verified email gate ----------
async function requireVerifiedEmail(req, res, next) {
  try {
    const payload = req.auth?.payload || {};
    const sub = payload.sub;
    if (!sub) return res.status(401).json({ error: "Token missing sub" });

    // Fast path: if the token already carries email_verified
    if (payload.email_verified === true) return next();
    if (payload.email_verified === false) {
      return res.status(403).json({ error: "Email not verified" });
    }

    // Fallback: call Mgmt API if the claim isn't present
    const verified = await isEmailVerifiedViaMgmtApi(sub);
    if (verified === true) return next();

    return res.status(403).json({ error: "Email not verified" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Email verification error" });
  }
}

// ---------- Routes ----------
app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * POST /orders
 * Requires:
 *  - Valid JWT (audience = AUTH0_AUDIENCE)
 *  - scope create:orders
 *  - Verified email
 * Body: { items:[{id,qty}], total:number, address?:string }
 * Saves in Postgres and updates compact profile summary (count + last_order).
 */
app.post(
  "/orders",
  checkJwt,
  requiredScopes("create:orders"),
  requireVerifiedEmail,
  async (req, res, next) => {
    try {
      const sub = req.auth.payload.sub;
      const email = req.auth.payload.email || null;
      const userId = await ensureUser(sub, email);

      const { items, total, address } = req.body || {};
      if (!Array.isArray(items) || !Number.isFinite(total)) {
        return res.status(400).json({ error: "Invalid body. Expect {items:[], total:number, address?}" });
      }

      const q = `
        INSERT INTO orders (user_id, items, total, address)
        VALUES ($1, $2::jsonb, $3::numeric, $4)
        RETURNING id, created_at
      `;
      const params = [userId, JSON.stringify(items), total, address || null];
      const { rows } = await pool.query(q, params);

      const orderSummary = {
        id: rows[0].id,
        total,
        created_at: rows[0].created_at
      };

      // Saves to User's profile
      updateProfileOrderSummary(sub, orderSummary).catch(() => {});

      return res.status(201).json({
        ...orderSummary,
        items,
        address: address || null
      });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * GET /orders
 * Requires:
 *  - Valid JWT
 *  - scope read:orders
 * Returns user's history from DB.
 */
app.get(
  "/orders",
  checkJwt,
  requiredScopes("read:orders"),
  async (req, res) => {
    try {
      const sub = req.auth.payload.sub;
      const email = req.auth.payload.email || null;
      const userId = await ensureUser(sub, email);

      const { rows } = await pool.query(
        `SELECT id, items, total, address, created_at
         FROM orders
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.json({ orders: rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not retrieve order history." });
    }
  }
);

/**
 * GET /orders/summary
 * For Auth0 Post-Login Action to get snapshot (max 5).
 * Requires:
 *  - M2M JWT
 *  - scope read:orders_summary
 * Query: ?sub=<auth0_sub>
 * Returns: [{ id, total, created_at }, ...]
 */
app.get(
  "/orders/summary",
  checkJwt,
  requiredScopes("read:orders_summary"),
  async (req, res) => {
    try {
      const gty = req.auth?.payload?.gty;
      if (gty && gty !== "client-credentials") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const sub = req.query.sub;
      if (!sub) return res.status(400).json({ error: "Missing sub" });

      const { rows: urows } = await pool.query(
        `SELECT id FROM users WHERE auth0_sub = $1`,
        [sub]
      );
      if (!urows.length) return res.json([]);
      const userId = urows[0].id;

      const { rows } = await pool.query(
        `SELECT id, total, created_at
         FROM orders
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId]
      );

      res.json(rows.map(r => ({ id: r.id, total: r.total, created_at: r.created_at })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Summary error" });
    }
  }
);

// ---------- Start ----------
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`);
    });
  })
  .catch(e => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
