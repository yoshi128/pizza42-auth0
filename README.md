# 🍕 Pizza42 - CIAM PoC with Auth0

This repository contains a proof of concept for Pizza42’s, built with **Auth0 by Okta**.  
It demonstrates universal login (DB, Social, Passkeys), RBAC-secured API calls, verified email enforcement, and a custom ID-token claim containing a snapshot of recent orders.

---
## ☁️ Deployment

Frontend (SPA): Deployed on Vercel
👉 https://pizza42-auth0-jcr.vercel.app/

Backend (API): Deployed on Render
👉 https://pizza42-auth0-jcr.onrender.com

Auth0 Application settings include both localhost and Vercel domain in Allowed Callback URLs, Logout URLs, Web Origins.

---

## ✅ Features Implemented

### 🔐 Authentication (via Auth0)
- Universal Login with:
  - Email/Password (Database Connection)
  - Social login (Google)
  - Passkeys (WebAuthn) enabled
- Sign up option for new customers (enabled in Auth0 Universal Login)
- Authorization Code Flow + PKCE for the SPA (best practice for SPAs)

### 🔒 API Protection
- Protected API endpoint (`/orders`,`/orders/summary`) with:
  - JWT validation (RS256, issuer, audience)
  - Scope enforcement (`create:orders`, `read:orders`, `read:orders_summary`)
- Email verification required before creating orders

### 📦 Business Logic (Auth0 Extensions)
- Order persistence in PostgreSQL (users, orders tables)
- Custom ID Token claim with order history (via **Post-Login Action**)
- Default role auto-assignment: a Post-Login Action assigns role pizza42-user (so users get create:orders/read:orders scopes)

### 🌐 Security
- CORS restricted to frontend origins (configured via CORS_ORIGINS and Auth0 Allowed Web Origins)

---

## 🔒 Auth0 Setup

**Applications → Applications**

- pizza42-spa (Single Page Application)
- pizza42-api-m2m (Machine to Machine for Management API)

**Applications → APIs**

- Pizza42 Orders API
  - Identifier / Audience: https://api.pizza42 (example – https://api.pizza42.jcr)
  - Enable RBAC
  - Add Permissions in the Access Token
  - Scopes:
    - create:orders
    - read:orders
    - read:orders_summary (for Action → /orders/summary)

**Authentication**

- Database (Username/Password)
- Social: Google
- Passkeys (WebAuthn)

**Actions (Post-Login)**

- AddOrdersToIdToken — populate the ID token with a DB snapshot
- AddDefaultRole — auto-assigns default role pizza42-user
Then add a flow in Actions -> Triggers -> post-login, include the actions in your flow

---

## ⚙️ Local Setup

### 1. Clone repo
```bash
git clone https://github.com/yoshi128/pizza42-auth0.git
cd pizza42-auth0
```
### 2. Backend (pizza42-api)
```bash
cd api
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
CORS_ORIGINS=http://localhost:8080,https://pizza42-auth0-jcr.vercel.app
```
### 3. Frontend (pizza42-spa)
```bash
cd ../spa
npx serve -s -l 8000   # or any static server
```
Open http://localhost:8000

---

## 📂 Project Structure
```bash
pizza42/
├── api/ # Backend (Node/Express API)
│ ├── server.js
│ ├── package.json
│ ├── .env.example # Environment variables (sample, no secrets)
│ └── ...
└── spa/ # Frontend (Single Page App)
│ ├── images
│ ├── index.html
│ ├── auth_config.json
```
---

## 🧪 Demo Scenarios

- Sign up with email/password → try to create order → blocked until email verified
- Verify email → retry → order accepted → persisted in PostgreSQL
- List orders → history returned from API → reads from PostgreSQL
- Orders claim in ID Token → Post-Login Action calls /orders/summary (M2M) → snapshot visible in Session box in SPA
- Login with Google → skips verification (email_verified=true)
- Optional: show Passkey login flow
- First login (no role) → AddDefaultRole Action auto-assigns pizza42-user → scopes (create:orders, read:orders) work

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

---

## Troubleshooting
| Symptom                  | Likely Cause               | What to check                                                                                           |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| 403 `insufficient_scope` | Missing role or bad scopes | User has role `pizza42-user`? API RBAC enabled? SPA requested scopes (`create:orders` / `read:orders`)? |
| 401 `invalid_token`      | Audience/issuer mismatch   | `AUTH0_AUDIENCE` matches API identifier; SPA requests tokens with that audience                         |
| 403 `Email not verified` | User not verified          | Verify user (email provider or Management API). Check API logs                                          |
| CORS blocked             | Origins not whitelisted    | `CORS_ORIGINS` (API) and **Allowed Web Origins** (Auth0 App) contain your SPA URL(s)                    |
| 500 from API             | Unhandled error            | Ensure the Express error handler above is present; check Render logs                                    |

- 401/403 from API → Check scopes (create:orders, read:orders) and audience match
- CORS error → Add SPA origin in CORS_ORIGINS (API) and Allowed Web Origins (Auth0)
- Email not verified → Verify email before POST /orders
- Orders claim missing → Ensure Action is attached and token refreshed

---

## 📝 Notes

This project is for demo purposes.

⚠️ Do not commit .env with secrets. Only .env.example is provided.

Deployment uses Vercel (SPA) and Render (API).

👨‍💻 Built by Jorge Camacho Reyes as part of the CIAM Specialist Tech Challenge.