# 🍕 Pizza42 - CIAM PoC with Auth0

This repository contains a **proof of concept** for Pizza42’s customer identity and access management (CIAM) solution, built with **Auth0 by Okta**.  
It demonstrates secure login, social login, passkeys option, calling a protected API, enforcing verified emails, and enriching ID tokens with custom claims.

---

## 📂 Project Structure
```bash
pizza42/
├── pizza42-api/ # Backend (Node/Express API)
│ ├── server.js
│ ├── package.json
│ ├── .env.example # Environment variables (sample, no secrets)
│ └── ...
└── pizza42-spa/ # Frontend (Single Page App)
└── index.html
```

---
## ✅ Features Implemented

### 🔐 Authentication (via Auth0)
- Universal Login with:
  - Email/Password (Database Connection) ✅ Auth0 DB connection
  - Social login (Google) ✅ Auth0 Social Connection
  - Passkeys (WebAuthn) enabled ✅ Auth0 WebAuthn (passkeys) support
- Sign up option for new customers (enabled in Auth0 Universal Login)
- Authorization Code Flow + PKCE for the SPA (best practice for SPAs)

### 🔒 API Protection
- Protected API endpoint (`/orders`) with:
  - JWT validation (RS256, issuer, audience) ✅ Auth0-provided JWKS
  - Scope enforcement (`create:orders`, `read:orders`) ✅ Auth0 Access Token scopes
- Email verification required before creating orders ✅ Auth0 rule/enforcement

### 📦 Business Logic (Auth0 Extensions)
- Order persistence in **Auth0 `app_metadata`** using the Management API ✅ Auth0 Management API
- Custom ID Token claim with order history (via **Post-Login Action**) ✅ Auth0 Actions

### 🌐 Security
- CORS restricted to frontend origins (configured in Auth0 Application settings)

---

## ⚙️ Local Setup

### 1. Clone repo
```bash
git clone https://github.com/<your-username>/pizza42.git
cd pizza42
```
### 2. Backend (pizza42-api)
```bash
cd pizza42-api
cp .env.example .env   # fill with your Auth0 values
npm install
npm run dev            # starts on http://localhost:3001
```
**Environment variables needed:**
```bash
PORT=3001
AUTH0_DOMAIN=dev-xxxxxx.us.auth0.com
AUTH0_AUDIENCE=...
MGMT_CLIENT_ID=...
MGMT_CLIENT_SECRET=...
CORS_ORIGINS=http://localhost:5173
```
### 3. Frontend (pizza42-spa)
```bash
cd ../pizza42-spa
npx serve -s -l 5173   # or any static server
```
Open http://localhost:5173

## ☁️ Deployment

Frontend (SPA): Deployed on Vercel
👉 https://NAME.vercel.app

Backend (API): Deployed on Render
👉 https://NAME.onrender.com

Auth0 Application settings include both localhost and Vercel domain in Allowed Callback URLs, Logout URLs, Web Origins:

http://localhost:5173

https://NAME.vercel.app

## 🔒 Auth0 Setup

**Applications → Applications**

pizza42-spa (Single Page Application)

pizza42-api-m2m (Machine to Machine for Management API)

**Applications → APIs**

Pizza42 Orders API with audience https://api.pizza42.jcr

Scopes: create:orders, read:orders

**Authentication**

Database (Username/Password)

Social: Google

Passkeys (WebAuthn)

**Actions**

Post-Login Action adds custom claim https://api.pizza42.jcr/orders

## 🧪 Demo Scenarios

- Sign up with email/password → try to create order → blocked until email verified
- Verify email → retry → order accepted → persisted in app_metadata
- List orders → history returned from API
- Orders claim in ID Token → visible in Session box in SPA
- Login with Google → skips verification (email_verified=true)
- Optional: show Passkey login flow

Note: Mark email as verified in Email provider or CLI using:
Get token
```bash
curl --request POST \
  --url https://dev-xxx.us.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id":"xxx",
    "client_secret":"xxx",
    "audience":"https://dev-xxx.us.auth0.com/api/v2/",
    "grant_type":"client_credentials"
  }'
  ```
Verify email
```bash
curl -X PATCH \
  -H "Authorization: Bearer TOKEN” \
  -H "Content-Type: application/json" \
  -d '{"email_verified": true}' \
  "https://dev-xxx.us.auth0.com/api/v2/users/auth0|ID”
```

## Post-Login Action
Add in Auth0: Actions -> Library - > Create Custom Action:
```bash
exports.onExecutePostLogin = async (event, api) => {
  const orders = (event.user.app_metadata && event.user.app_metadata.orders) || [];
  api.idToken.setCustomClaim(`${event.request.audience}/orders`, orders);
};
```
Then add a flow in Actions -> Triggers -> post-login, include the action in your flow

## Troubleshooting
- 401/403 from API → Check scopes (create:orders, read:orders) and audience match
- CORS error → Add SPA origin in CORS_ORIGINS (API) and Allowed Web Origins (Auth0)
- Email not verified → Verify email before POST /orders
- Orders claim missing → Ensure Action is attached and token refreshed

## 📝 Notes

This project is for demo purposes.

⚠️ Do not commit .env with secrets. Only .env.example is provided.

Deployment uses free tiers of Vercel (SPA) and Render (API).

👨‍💻 Built by Jorge Camacho Reyes as part of the CIAM Specialist Tech Challenge.