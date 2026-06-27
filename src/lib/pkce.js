/**
 * PKCE helpers for OAuth 2.0 Authorization Code with PKCE
 * https://datatracker.ietf.org/doc/html/rfc7636
 */

/** Generate a cryptographically random code verifier (43–128 chars) */
export function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** Derive the code challenge from a verifier using SHA-256 */
export async function generateCodeChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generate a random state parameter to prevent CSRF */
export function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Build the Deriv authorization URL */
export async function buildAuthUrl() {
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state     = generateState();

  // Persist in sessionStorage so the callback page can retrieve them
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             import.meta.env.VITE_DERIV_AUTH_CLIENT_ID,
    redirect_uri:          import.meta.env.VITE_DERIV_AUTH_REDIRECT_URI,
    scope:                 'trade',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  });

  return `https://auth.deriv.com/oauth2/auth?${params}`;
}
