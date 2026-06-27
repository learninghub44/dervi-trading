/**
 * API client for backend routes.
 * In production: same origin, BASE is '' (empty).
 * In dev: Vite proxy forwards /oauth /accounts /otp to Express on :3001.
 */

const BASE = import.meta.env.VITE_BACKEND_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch {}
    throw new Error(`${res.status} ${res.statusText}${detail ? ': ' + detail : ''}`);
  }

  return res.json();
}

export const exchangeCode = (code, code_verifier) =>
  request('/oauth/token', { method: 'POST', body: JSON.stringify({ code, code_verifier }) });

export const logout = () =>
  request('/oauth/logout', { method: 'POST' });

export const fetchAccounts = () =>
  request('/accounts');

export const requestOtp = (accountId) =>
  request(`/otp/${accountId}`, { method: 'POST' });
