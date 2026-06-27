/**
 * Deriv Trading — Fullstack Server
 * In production: builds Vite output is in /dist, Express serves it + API routes.
 * In dev: run `npm run dev` (Vite) separately from `npm start` (Express).
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json());
app.use(cookieParser());

// In prod, frontend and backend share the same origin — no CORS needed.
// In dev, Vite runs on :5173 and Express on :3001.
if (!isProd) {
  app.use(cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }));
}

const DERIV_APP_ID   = process.env.DERIV_APP_ID;
const CLIENT_ID      = process.env.DERIV_AUTH_CLIENT_ID;
const CLIENT_SECRET  = process.env.DERIV_AUTH_CLIENT_SECRET;
const REDIRECT_URI   = process.env.DERIV_AUTH_REDIRECT_URI;
const TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';
const API_BASE       = 'https://api.derivws.com/trading/v1';

// ─── helpers ────────────────────────────────────────────────────────────────

function getAccessToken(req) {
  return req.cookies?.deriv_access_token ?? null;
}

function derivHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    'Deriv-App-ID': DERIV_APP_ID,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

// ─── API routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /oauth/token
 * Exchanges PKCE code for tokens; stores access_token in http-only cookie.
 */
app.post('/oauth/token', async (req, res) => {
  const { code, code_verifier } = req.body;
  if (!code || !code_verifier)
    return res.status(400).json({ error: 'code and code_verifier are required' });

  try {
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      code_verifier,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET ?? '',
      redirect_uri:  REDIRECT_URI,
    });

    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: 'Token exchange failed', detail: err });
    }

    const tokens = await tokenRes.json();

    res.cookie('deriv_access_token', tokens.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: tokens.expires_in * 1000,
    });

    res.json({ success: true, expires_in: tokens.expires_in });
  } catch (err) {
    console.error('Token route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /oauth/logout */
app.post('/oauth/logout', (_req, res) => {
  res.clearCookie('deriv_access_token');
  res.json({ success: true });
});

/** GET /accounts */
app.get('/accounts', async (req, res) => {
  const token = getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const r = await fetch(`${API_BASE}/options/accounts`, { headers: derivHeaders(token) });
    if (!r.ok) return res.status(r.status).json({ error: 'Deriv API error', detail: await r.text() });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /otp/:accountId */
app.post('/otp/:accountId', async (req, res) => {
  const token = getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const r = await fetch(`${API_BASE}/options/accounts/${req.params.accountId}/otp`, {
      method: 'POST',
      headers: derivHeaders(token),
    });
    if (!r.ok) return res.status(r.status).json({ error: 'OTP request failed', detail: await r.text() });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /bulk-purchase */
app.post('/bulk-purchase', async (req, res) => {
  if (!req.body?.contract_parameters || !req.body?.accounts)
    return res.status(400).json({ error: 'contract_parameters and accounts are required' });

  try {
    const r = await fetch(`${API_BASE}/options/contracts/bulk-purchase/real`, {
      method: 'POST',
      headers: derivHeaders(null),
      body: JSON.stringify(req.body),
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Bulk purchase failed', detail: await r.text() });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Serve Vite build in production ─────────────────────────────────────────

if (isProd) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // SPA fallback — all non-API routes serve index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT} [${isProd ? 'production' : 'development'}]`));
