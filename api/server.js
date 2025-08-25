import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { auth, requiredScopes } from 'express-oauth2-jwt-bearer';

dotenv.config();

const app = express();
app.use(express.json());

// allow only configured origins
const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  }
}));

const {
  PORT = 3001,
  AUTH0_DOMAIN,
  AUTH0_AUDIENCE,
  MGMT_CLIENT_ID,
  MGMT_CLIENT_SECRET
} = process.env;

// validate Auth0 access tokens (RS256)
const checkJwt = auth({
  audience: AUTH0_AUDIENCE,
  issuerBaseURL: `https://${AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256'
});

// get a token for the Management API
async function getMgmtToken() {
  const { data } = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
    client_id: MGMT_CLIENT_ID,
    client_secret: MGMT_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: 'client_credentials'
  });
  return data.access_token;
}

// require verified email
async function requireVerifiedEmail(req, res, next) {
  try {
    const userSub = req.auth?.payload?.sub;
    if (!userSub) return res.status(401).json({ error: 'Token missing sub' });

    const mgmtToken = await getMgmtToken();
    const { data: user } = await axios.get(
      `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userSub)}`,
      { headers: { Authorization: `Bearer ${mgmtToken}` } }
    );

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Email not verified. Please verify your email before placing an order.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Error validating email' });
  }
}

// healthcheck
app.get('/health', (_, res) => res.json({ ok: true }));

// create order
app.post('/orders',
  checkJwt,
  requiredScopes('create:orders'),
  requireVerifiedEmail,
  async (req, res) => {
    try {
      const userSub = req.auth.payload.sub;
      const order = req.body;

      const mgmtToken = await getMgmtToken();

      const { data: user } = await axios.get(
        `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userSub)}`,
        { headers: { Authorization: `Bearer ${mgmtToken}` } }
      );

      const orders = Array.isArray(user.app_metadata?.orders)
        ? user.app_metadata.orders
        : [];

      orders.push({ ...order, ts: Date.now() });

      await axios.patch(
        `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userSub)}`,
        { app_metadata: { ...user.app_metadata, orders } },
        { headers: { Authorization: `Bearer ${mgmtToken}` } }
      );

      res.json({ ok: true, saved: order });
    } catch (e) {
      res.status(500).json({ error: 'Could not save order in user profile.' });
    }
  }
);

// list orders
app.get('/orders',
  checkJwt,
  requiredScopes('read:orders'),
  async (req, res) => {
    try {
      const userSub = req.auth.payload.sub;
      const mgmtToken = await getMgmtToken();

      const { data: user } = await axios.get(
        `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userSub)}`,
        { headers: { Authorization: `Bearer ${mgmtToken}` } }
      );

      res.json({ orders: user.app_metadata?.orders ?? [] });
    } catch (e) {
      res.status(500).json({ error: 'Could not retrieve order history.' });
    }
  }
);

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
