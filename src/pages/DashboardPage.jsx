import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAccounts, requestOtp, logout } from '../lib/api';
import { createDerivWS, DerivMsg } from '../lib/ws';

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

export default function DashboardPage() {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [accounts, setAccounts]        = useState([]);
  const [selectedAccount, setSelected] = useState(null);
  const [ticks, setTicks]              = useState([]);
  const [log, setLog]                  = useState([]);
  const [otpUrl, setOtpUrl]            = useState(null);
  const [proposalId, setProposalId]    = useState(null);
  const [proposal, setProposal]        = useState(null);
  const [loading, setLoading]          = useState({});

  // Connection status tracked in state so button labels update correctly
  const [publicConnected, setPublicConnected]  = useState(false);
  const [authConnected, setAuthConnected]      = useState(false);

  const publicWsRef = useRef(null);
  const authWsRef   = useRef(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function addLog(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString();
    setLog(prev => [{ ts, msg, type }, ...prev].slice(0, 50));
  }

  function setLoad(key, val) {
    setLoading(prev => ({ ...prev, [key]: val }));
  }

  // Clean up WebSockets on unmount
  useEffect(() => () => {
    publicWsRef.current?.close();
    authWsRef.current?.close();
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Fetch the user's account list from backend → Deriv */
  async function handleFetchAccounts() {
    setLoad('accounts', true);
    try {
      const data = await fetchAccounts();
      const list = data.accounts ?? data ?? [];
      setAccounts(list);
      addLog(`Loaded ${list.length} account(s)`);
    } catch (err) {
      addLog(`Fetch accounts failed: ${err.message}`, 'error');
    } finally {
      setLoad('accounts', false);
    }
  }

  /** Toggle public WebSocket for live ticks */
  function handlePublicWS() {
    if (publicWsRef.current) {
      publicWsRef.current.close();
      publicWsRef.current = null;
      setPublicConnected(false);
      addLog('Public WS disconnected');
      return;
    }

    addLog('Connecting to public WebSocket…');
    publicWsRef.current = createDerivWS(PUBLIC_WS_URL, {
      onOpen() {
        setPublicConnected(true);
        addLog('Public WS connected');
        publicWsRef.current.send(DerivMsg.activeSymbols());
        publicWsRef.current.send(DerivMsg.subscribeTicks('1HZ100V'));
      },
      onMessage(msg) {
        if (msg.msg_type === 'tick') {
          const { symbol, quote, epoch } = msg.tick;
          setTicks(prev => [{
            symbol,
            price: quote,
            time: new Date(epoch * 1000).toLocaleTimeString(),
          }, ...prev].slice(0, 20));
        }
      },
      onError: () => addLog('Public WS error', 'error'),
      onClose: (ev) => {
        // Only mark disconnected on intentional close (code 1000) or clean close
        if (ev.wasClean || ev.code === 1000) {
          setPublicConnected(false);
          addLog('Public WS closed');
        }
        // backoff reconnect is handled inside createDerivWS
      },
    });
  }

  /** Request an OTP from backend for the selected real account */
  async function handleRequestOtp() {
    if (!selectedAccount) {
      addLog('Select an account first', 'warn');
      return;
    }
    setLoad('otp', true);
    try {
      const data = await requestOtp(selectedAccount.account_id ?? selectedAccount.id);
      setOtpUrl(data.data?.url ?? data.url);
      addLog('OTP received — authenticated WS URL ready');
    } catch (err) {
      addLog(`OTP request failed: ${err.message}`, 'error');
    } finally {
      setLoad('otp', false);
    }
  }

  /** Toggle authenticated WebSocket using the OTP URL */
  function handleAuthWS() {
    if (!otpUrl) {
      addLog('Request an OTP first', 'warn');
      return;
    }

    if (authWsRef.current) {
      authWsRef.current.close();
      authWsRef.current = null;
      setAuthConnected(false);
      setProposalId(null);
      setProposal(null);
      addLog('Authenticated WS disconnected');
      return;
    }

    addLog('Connecting to authenticated WebSocket…');
    authWsRef.current = createDerivWS(otpUrl, {
      onOpen() {
        setAuthConnected(true);
        addLog('Authenticated WS connected — ready to trade');
      },
      onError: () => addLog('Authenticated WS error', 'error'),
      onClose: (ev) => {
        if (ev.wasClean || ev.code === 1000) {
          setAuthConnected(false);
          addLog('Authenticated WS closed');
        }
      },
      onMessage(msg) {
        switch (msg.msg_type) {
          case 'proposal':
            setProposalId(msg.proposal?.id);
            setProposal(msg.proposal);
            addLog(`Proposal: id=${msg.proposal?.id}  price=$${msg.proposal?.ask_price}  payout=$${msg.proposal?.payout}`);
            break;

          case 'buy':
            addLog(`Contract bought: id=${msg.buy?.contract_id}`, 'success');
            authWsRef.current?.send(
              DerivMsg.subscribeOpenContract(msg.buy.contract_id)
            );
            break;

          case 'proposal_open_contract': {
            const c = msg.proposal_open_contract;
            if (c?.is_sold) {
              addLog(
                `Contract settled: profit=${c.profit >= 0 ? '+' : ''}${c.profit} status=${c.status}`,
                c.profit >= 0 ? 'success' : 'error'
              );
            }
            break;
          }

          case 'error':
            addLog(`WS error: ${msg.error?.message ?? JSON.stringify(msg.error)}`, 'error');
            break;

          default:
            break;
        }
      },
    });
  }

  /** Send a CALL proposal over the authenticated WS */
  function handleSendProposal() {
    if (!authWsRef.current) {
      addLog('Connect authenticated WS first', 'warn');
      return;
    }
    authWsRef.current.send(DerivMsg.proposal());
    addLog('Proposal request sent (CALL / 1HZ100V / $10 / 5 ticks)');
  }

  /** Buy the last received proposal */
  function handleBuy() {
    if (!authWsRef.current || !proposalId) {
      addLog('No proposal to buy — send a proposal first', 'warn');
      return;
    }
    authWsRef.current.send(DerivMsg.buy(proposalId, proposal?.ask_price ?? 10));
    addLog(`Buying proposal ${proposalId} @ $${proposal?.ask_price ?? 10}…`);
  }

  /** Logout: clear cookie, redirect to login */
  async function handleLogout() {
    publicWsRef.current?.close();
    authWsRef.current?.close();
    await logout().catch(() => {});
    navigate('/');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="dashboard">
      {/* Header */}
      <header className="topbar">
        <span className="brand">⚡ Deriv Trading</span>
        <button className="btn small" onClick={handleLogout}>Logout</button>
      </header>

      <main className="grid">
        {/* ── Left column: controls ── */}
        <section className="panel controls">
          <h2>Account</h2>
          <button
            className="btn"
            onClick={handleFetchAccounts}
            disabled={loading.accounts}
          >
            {loading.accounts ? 'Loading…' : 'Fetch Accounts'}
          </button>

          {accounts.length > 0 && (
            <div className="account-list">
              {accounts.map((acc) => {
                const id = acc.account_id ?? acc.id ?? acc;
                return (
                  <button
                    key={id}
                    className={`account-item ${selectedAccount === acc ? 'selected' : ''}`}
                    onClick={() => setSelected(acc)}
                  >
                    {id} {acc.currency ? `(${acc.currency})` : ''}{' '}
                    {acc.account_type === 'real' ? '🟢' : '🔵'}
                  </button>
                );
              })}
            </div>
          )}

          <hr />
          <h2>Market Data</h2>
          <button className="btn" onClick={handlePublicWS}>
            {publicConnected ? 'Disconnect Public WS' : 'Connect Public WS'}
          </button>

          <hr />
          <h2>Real Trading</h2>
          <button
            className="btn"
            onClick={handleRequestOtp}
            disabled={loading.otp || !selectedAccount}
          >
            {loading.otp ? 'Requesting…' : 'Request OTP'}
          </button>
          {otpUrl && <p className="status-chip green">OTP ready</p>}

          <button className="btn" onClick={handleAuthWS} disabled={!otpUrl}>
            {authConnected ? 'Disconnect Auth WS' : 'Connect Auth WS'}
          </button>

          <button className="btn" onClick={handleSendProposal} disabled={!authConnected}>
            Send Proposal (CALL / 1HZ100V)
          </button>

          {proposal && (
            <div className="proposal-box">
              <p>Ask price: <strong>${proposal.ask_price}</strong></p>
              <p>Payout: <strong>${proposal.payout}</strong></p>
              <p>Multiplier: <strong>{((proposal.payout / proposal.display_value) * 100).toFixed(0)}%</strong></p>
            </div>
          )}

          <button
            className="btn accent"
            onClick={handleBuy}
            disabled={!proposalId}
          >
            Buy Contract
          </button>
        </section>

        {/* ── Middle: live ticks ── */}
        <section className="panel ticks-panel">
          <h2>Live Ticks — 1HZ100V</h2>
          {ticks.length === 0
            ? <p className="empty">Connect public WS to see ticks</p>
            : (
              <table className="tick-table">
                <thead><tr><th>Time</th><th>Price</th></tr></thead>
                <tbody>
                  {ticks.map((t, i) => (
                    <tr key={i}>
                      <td>{t.time}</td>
                      <td className="price">{t.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </section>

        {/* ── Right: event log ── */}
        <section className="panel log-panel">
          <h2>Event Log</h2>
          {log.length === 0
            ? <p className="empty">No events yet</p>
            : log.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.type}`}>
                <span className="log-ts">{entry.ts}</span>
                <span className="log-msg">{entry.msg}</span>
              </div>
            ))
          }
        </section>
      </main>
    </div>
  );
}
