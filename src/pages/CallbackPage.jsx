import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangeCode } from '../lib/api';

/**
 * Deriv redirects here after login:
 *   http://localhost:5173/callback?code=...&state=...
 *
 * This page:
 *  1. Validates the `state` param (CSRF check).
 *  2. Sends `code` + `code_verifier` to the backend.
 *  3. Backend stores the token in an http-only cookie and returns 200.
 *  4. We redirect to the dashboard.
 */
export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    async function handleCallback() {
      const params       = new URLSearchParams(window.location.search);
      const code         = params.get('code');
      const returnedState = params.get('state');

      // ── CSRF check ──────────────────────────────────────────────────────
      const savedState = sessionStorage.getItem('oauth_state');
      if (!returnedState || returnedState !== savedState) {
        setError('State mismatch — possible CSRF attack. Please try logging in again.');
        return;
      }

      // ── Code check ──────────────────────────────────────────────────────
      if (!code) {
        setError('No authorization code received from Deriv.');
        return;
      }

      const verifier = sessionStorage.getItem('pkce_verifier');
      if (!verifier) {
        setError('PKCE verifier missing. Please try logging in again.');
        return;
      }

      try {
        await exchangeCode(code, verifier);
        // Clean up one-time-use values
        sessionStorage.removeItem('pkce_verifier');
        sessionStorage.removeItem('oauth_state');
        navigate('/dashboard');
      } catch (err) {
        setError(`Token exchange failed: ${err.message}`);
      }
    }

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="page center">
        <div className="card error">
          <h2>Authentication Error</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => navigate('/')}>Back to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page center">
      <div className="card">
        <div className="spinner" />
        <p>Completing login…</p>
      </div>
    </div>
  );
}
