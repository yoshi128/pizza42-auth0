// server.js
// Node ESM (asegúrate de tener "type":"module" en package.json)

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import axios from "axios"; // solo para verificación de email vía Management API (opcional)

dotenv.config();

const {
  PORT = 3001,
  CORS_ORIGINS = "",
  AUTH0_DOMAIN,
  AUTH0_AUDIENCE,
  DATABASE_URL,
  // Opcional (solo si quieres reforzar email_verified consultando Management API)
  MGMT_CLIENT_ID,
  MGMT_CLIENT_SECRET,
} = process.env;

// ---------- App & Middleware ----------
const app = express();
app.use(express.json());

// CORS por lista blanca
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
  ssl: { rejectUnauthorized: false }, // Render/Neon/Supabase suelen requerir SSL
});

// Crea tablas si no existen
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

// ---------- Email verification (policy) ----------
async function isEmailVerifiedViaMgmtApi(sub) {
  if (!MGMT_CLIENT_ID || !MGMT_CLIENT_SECRET) return null; // no disponible
  try {
    const { data: token } = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
      client_id: MGMT_CLIENT_ID,
      client_secret: MGMT_CLIENT_SECRET,
      audience: `https://${AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    });
    const { data: user } = await axios.get(
      `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(sub)}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    return !!user.email_verified;
  } catch (e) {
    console.error("Mgmt API email check failed:", e?.response?.data || e.message);
    return null;
  }
}

/**
 * requireVerifiedEmail:
 * 1) Intenta usar req.auth.payload.email_verified si viene en el Access Token.
 * 2) Si no está y configuraste MGMT creds, consulta Management API.
 * 3) Si es false/indeterminado, bloquea.
 */
async function requireVerifiedEmail(req, res, next) {
  try {
    const payload = req.auth?.payload || {};
    const sub = payload.sub;
    if (!sub) return res.status(401).json({ error: "Token missing sub" });

    if (payload.email_verified === true) return next();
    if (payload.email_verified === false) return res.status(403).json({ error: "Email not verified" });

    const verified = await isEmailVerifiedViaMgmtApi(sub);
    if (verified === true) return next();

    return res.status(403).json({ error: "Email not verified" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Email verification error" });
  }
}

// ---------- Rutas ----------
app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * POST /orders
 * Requiere:
 *  - JWT válido
 *  - scope create:orders
 *  - email verificado
 * Body: { items:[{id,qty}], total:number, address?:string }
 * Guarda en BD y devuelve la orden creada.
 */
app.post(
  "/orders",
  checkJwt,
  requiredScopes("create:orders"),
  requireVerifiedEmail,
  async (req, res) => {
    try {
      const sub = req.auth.payload.sub;
      const email = req.auth.payload.email || null;
      const userId = await ensureUser(sub, email);

      const { items, total, address } = req.body || {};
      if (!Array.isArray(items) || typeof total !== "number") {
        return res.status(400).json({ error: "Invalid body. Expect {items:[], total:number, address?}" });
      }

      const ins = await pool.query(
        `INSERT INTO orders (user_id, items, total, address)
         VALUES ($1,$2,$3,$4)
         RETURNING id, created_at`,
        [userId, items, total, address || null]
      );

      res.status(201).json({
        id: ins.rows[0].id,
        created_at: ins.rows[0].created_at,
        items,
        total,
        address: address || null,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not save order." });
    }
  }
);

/**
 * GET /orders
 * Requiere:
 *  - JWT válido
 *  - scope read:orders
 * Devuelve historial completo del usuario desde BD.
 */
app.get("/orders",
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

      res.json({ orders: rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not retrieve order history." });
    }
  }
);

/**
 * GET /orders/summary
 * Uso: Auth0 Action Post-Login obtiene snapshot (máx 5) desde BD.
 * Seguridad: JWT + scope 'read:orders_summary' (token de M2M).
 * Query: ?sub=<auth0_sub>
 * Respuesta: [{ id, total, created_at }, ...]
 */
app.get(
  "/orders/summary",
  checkJwt,
  requiredScopes("read:orders_summary"),
  async (req, res) => {
    try {
      // (Opcional) Limitar a tokens de Client Credentials:
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
      if (!urows.length) return res.json([]); // sin usuario => no hay órdenes
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