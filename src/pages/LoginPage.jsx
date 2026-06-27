import { buildAuthUrl } from '../lib/pkce';

export default function LoginPage() {
  async function handleLogin() {
    const url = await buildAuthUrl();
    window.location.href = url;   // redirect to Deriv OAuth
  }

  return (
    <div className="page center">
      <div className="card">
        <div className="logo">⚡</div>
        <h1>Deriv Trading</h1>
        <p className="subtitle">Connect your Deriv account to start trading</p>
        <button className="btn primary large" onClick={handleLogin}>
          Login with Deriv
        </button>
        <p className="note">Uses OAuth 2.0 with PKCE — your credentials never touch this app.</p>
      </div>
    </div>
  );
}
