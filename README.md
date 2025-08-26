# 🍕 Pizza42 - CIAM PoC with Auth0

This repository contains a **proof of concept** for Pizza42’s customer identity and access management (CIAM) solution, built with **Auth0 by Okta**.  
It demonstrates secure login, social login, passkeys option, calling a protected API, enforcing verified emails, and enriching ID tokens with custom claims.

---

## 📂 Project Structure

pizza42/
├── pizza42-api/ # Backend (Node/Express API)
│ ├── server.js
│ ├── package.json
│ ├── .env.example # Environment variables (sample, no secrets)
│ └── ...
└── pizza42-spa/ # Frontend (Single Page App)
└── index.html


---

## ✅ Features Implemented

- **Universal Login** with:
  - Email/Password (Database connection)
  - Social login (Google)
  - Passkeys (WebAuthn) enabled
- **Sign up** option for new customers
- **Authorization Code Flow + PKCE** for the SPA
- **Protected API** (`/orders`) with:
  - JWT validation (RS256, issuer, audience)
  - Scope enforcement (`create:orders`, `read:orders`)
  - Email verification required before creating orders
- **Order persistence** in Auth0 `app_metadata` using the **Management API**
- **Custom ID Token claim** with order history (via Post-Login Action)
- **CORS** restricted to frontend origins

---

## ⚙️ Running Locally

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
Environment variables needed:

PORT=3001
AUTH0_DOMAIN=dev-xxxxxx.us.auth0.com
AUTH0_AUDIENCE=https://api.pizza42.jcr
MGMT_CLIENT_ID=...
MGMT_CLIENT_SECRET=...
CORS_ORIGINS=http://localhost:5173

### 3. Frontend (pizza42-spa)
```bash
cd ../pizza42-spa
npx serve -s -l 5173   # or any static server
```
Open http://localhost:5173

### ☁️ Deployment

Frontend (SPA): Deployed on Vercel
👉 https://pizza42-spa-<something>.vercel.app

Backend (API): Deployed on Render
👉 https://pizza42-api.onrender.com

Auth0 Application settings include both:

http://localhost:5173

https://pizza42-spa-<something>.vercel.app

### 🔒 Auth0 Setup

Applications → Applications

pizza42-spa (Single Page Application)

pizza42-api-m2m (Machine to Machine)

Applications → APIs

Pizza42 Orders API with audience https://api.pizza42.jcr

Scopes: create:orders, read:orders

Authentication

Database (Username/Password)

Social: Google

Passkeys (WebAuthn)

Actions

Post-Login Action adds custom claim https://api.pizza42.jcr/orders

### 🧪 Demo Scenarios

Sign up with email/password

Login → Sign up → Create order → Rejected (403, email not verified).

Mark email as verified in Dashboard

Retry → Order accepted → Stored in app_metadata.

List orders

Shows full order history from API.

Orders in ID Token

Displayed automatically in SPA after login (via Action).

Login with Google

Skips verification (email_verified=true).

### 📝 Notes

This project is for demo purposes.

Do not commit .env with secrets. Only .env.example is provided.

Deployment uses free tiers of Vercel (SPA) and Render (API).

👨‍💻 Built by Jorge Camacho Reyes as part of the CIAM Specialist Tech Challenge.



Pizza42 • Auth0 CIAM PoC (SPA + API)

A small, production-style proof of concept that demonstrates how Pizza42 could use Okta’s Auth0 for customer identity:

Login & Sign-up (Universal Login; social login optional)

Email verification (required to place orders)

Scope-protected Orders API (create:orders, read:orders)

Persist orders in the user’s Auth0 app_metadata

Inject order history into the ID Token via a Post-Login Action

This PoC closely follows the Auth0 SPA Quickstart patterns (config via auth_config.json, SPA SDK, RS256 access tokens, scope checks in the API).

Table of Contents

Architecture

Folder Structure

Prerequisites

Auth0 Configuration

Local Setup

How It Works

Post-Login Action (ID Token claim)

Smoke Tests

Troubleshooting

Security Notes

Architecture

SPA (Vanilla JS)

Uses @auth0/auth0-spa-js to authenticate and obtain tokens for the API.

Reads public config from auth_config.json like the Auth0 Quickstart.

Shows session state (user, email_verified) and the orders claim from the ID Token.

Calls the Orders API with audience + scopes.

API (Node/Express)

Validates incoming RS256 access tokens (express-oauth2-jwt-bearer).

Enforces scopes (create:orders, read:orders).

Requires verified email for creating orders.

Stores/retrieves orders in Auth0 app_metadata via Management API.

Folder Structure
PIZZA42/
├─ pizza42-api/           # Node/Express API (protected by Auth0)
│  ├─ server.js
│  ├─ package.json
│  ├─ .env                # NOT committed (secrets)
│  └─ .env.example        # Safe template (no secrets)
├─ pizza42-spa/           # Vanilla JS SPA (static)
│  ├─ index.html
│  └─ auth_config.json    # Public config (no secrets)
├─ pizza42-spa-react/     # (Optional sandbox; not required for the PoC)
├─ .gitignore
└─ README.md

Prerequisites

Node.js 18+ (20+ recommended)

Git and a GitHub account

An Auth0 tenant with:

A SPA Application

A Custom API (Identifier/audience)

A Machine-to-Machine application authorized for Management API (for user profile updates)

Auth0 Configuration
1) API (Orders API)

APIs → Create API

Identifier: https://api.pizza42.jcr ← must exactly match the audience used by SPA & API

Signing Algorithm: RS256

Permissions:

create:orders

read:orders

2) SPA Application

Applications → Applications → (Your SPA)

Allowed Callback URLs:
http://localhost:5173

Allowed Logout URLs:
http://localhost:5173

Allowed Web Origins:
http://localhost:5173

Ensure the SPA is authorized to call your API (via APIs → (Your API) → Machine to Machine/Applications or by requesting audience/scopes in the SPA).

3) Authentication

Authentication → Database: enable Username/Password (Sign-up)

Authentication → Social: enable Google (optional)

Authentication → Passkeys: enable (optional but recommended)

Local Setup
1) API (Node/Express)

Install dependencies and create your .env from the example:

cd pizza42-api
npm install
cp .env.example .env


Fill .env (do not commit this file):

PORT=3001
AUTH0_DOMAIN=dev-y36uo5tjf58wgosd.us.auth0.com
AUTH0_AUDIENCE=https://api.pizza42.jcr
MGMT_CLIENT_ID=YOUR_MGMT_CLIENT_ID
MGMT_CLIENT_SECRET=YOUR_MGMT_CLIENT_SECRET
CORS_ORIGINS=http://localhost:5173


Note: If server.js uses ESM import syntax, ensure package.json contains "type": "module", or rename to server.mjs.

Run the API:

node server.js
# Health check:
# curl http://localhost:3001/health  -> {"ok":true}

2) SPA (Vanilla JS)

Create/edit pizza42-spa/auth_config.json (public, safe to commit):

{
  "domain": "dev-y36uo5tjf58wgosd.us.auth0.com",
  "clientId": "YOUR_SPA_CLIENT_ID",
  "audience": "https://api.pizza42.jcr",
  "apiBase": "http://localhost:3001"
}


Serve the SPA locally (static server):

cd ../pizza42-spa
npx serve -l 5173
# Open http://localhost:5173

How It Works

Login & Sign-up: The SPA opens Universal Login, supports DB sign-up and (optional) Google/social.

Email Verification: Users can sign in before verifying, but placing orders requires email_verified = true.

Scope-protected API:

POST /orders requires a valid token with create:orders and verified email.

GET /orders requires a token with read:orders.

Persisting Orders: The API uses the Management API to store orders in user.app_metadata.orders.

ID Token Claim: A Post-Login Action injects app_metadata.orders into the ID Token as a custom claim namespaced by the audience, e.g.

https://api.pizza42.jcr/orders


SPA UI: Shows login status, email_verified, the orders claim from the ID Token, and the API responses.

Post-Login Action (ID Token claim)

Create an Action (Triggers → Post-Login) and attach it to the login flow:

exports.onExecutePostLogin = async (event, api) => {
  const orders = (event.user.app_metadata && event.user.app_metadata.orders) || [];
  // Namespace with your audience so the SPA can read it consistently
  api.idToken.setCustomClaim(`${event.request.audience}/orders`, orders);
};


After placing a new order, the SPA refreshes tokens to display the updated claim.

Smoke Tests

End-to-end

Open http://localhost:5173

Click Login → complete sign-up/login in Universal Login

Without verifying email, click Create Order → UI should show “Email not verified”

Verify your email (link from Auth0), return to the SPA

Click Create Order → should return 200 and persist the order

Click List Orders → the API should return your order history

Check the Session & ID Token panel → email_verified: true and orders_from_id_token populated (if your Action is attached)

API (curl)

# Obtain an access token from the SPA and set it in $TOKEN, then:

# List orders
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/orders

# Create order (requires verified email + scope create:orders)
curl -X POST http://localhost:3001/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"pepperoni","qty":1}],"total":22.5,"address":"123 Pizza St"}'

Troubleshooting

401/403 from API

The token doesn’t include the expected audience or scope. Ensure SPA requests:

authorizationParams: { audience, scope: "openid profile email create:orders read:orders" }

The user’s email isn’t verified (required for POST /orders).

CORS errors

Add the SPA origin to API’s CORS_ORIGINS in .env.

Add the SPA URL to Allowed Web Origins in the SPA application settings in Auth0.

“Invalid token” / “Issuer mismatch”

AUTH0_AUDIENCE must match the API Identifier exactly.

issuerBaseURL must be https://YOUR_DOMAIN/ (including trailing slash).

Orders claim not appearing in ID Token

Is the Action attached to the Post-Login trigger?

Did you refresh the token in the SPA after creating an order?

Security Notes

Do not commit .env files. The repo includes pizza42-api/.env.example as a safe template.

auth_config.json is public and should contain no secrets (SPA Client ID & domain are public by design).

If any secret is ever committed accidentally, rotate it in Auth0 immediately and remove it from git history.

That’s it.
This PoC shows a realistic CIAM flow (login/sign-up, email verification, scope-protected API, profile enrichment via Management API, and ID Token customization via Actions) in a small, easy-to-review codebase.