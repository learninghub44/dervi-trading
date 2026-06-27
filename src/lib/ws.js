/**
 * Lightweight WebSocket manager for Deriv API.
 *
 * Features:
 *  - Automatic reconnect with exponential backoff
 *  - Periodic ping keepalive (every 30 s)
 *  - forget_all sent before clean close
 *  - All DerivMsg builders include req_id per Deriv spec
 *
 * Usage:
 *   const ws = createDerivWS('wss://...', {
 *     onMessage: (msg) => console.log(msg),
 *     onOpen:    ()    => ws.send(DerivMsg.activeSymbols()),
 *   });
 *   ws.send(DerivMsg.subscribeTicks('1HZ100V'));
 *   ws.close(); // clean up
 */

const PING_INTERVAL_MS  = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const RECONNECT_FACTOR  = 2;

export function createDerivWS(url, { onMessage, onOpen, onError, onClose } = {}) {
  let socket          = null;
  let intentionallyClosed = false;
  let reconnectDelay  = RECONNECT_BASE_MS;
  let pingTimer       = null;
  const subscriptionIds = new Set();

  // ── Internal connect ────────────────────────────────────────────────────
  function connect() {
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      console.log('[WS] Connected:', url);
      reconnectDelay = RECONNECT_BASE_MS; // reset backoff on successful connect
      startPing();
      onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Record subscription IDs returned by Deriv so we can forget them
      if (msg.subscription?.id) {
        subscriptionIds.add(msg.subscription.id);
      }

      onMessage?.(msg);
    });

    socket.addEventListener('error', (err) => {
      console.error('[WS] Error:', err);
      onError?.(err);
    });

    socket.addEventListener('close', (ev) => {
      console.log('[WS] Closed:', ev.code, ev.reason);
      stopPing();
      onClose?.(ev);

      if (!intentionallyClosed) {
        // Reconnect with exponential backoff
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
        console.log(`[WS] Reconnecting in ${delay}ms…`);
        setTimeout(connect, delay);
      }
    });
  }

  // ── Ping keepalive ──────────────────────────────────────────────────────
  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      send({ ping: 1, req_id: reqId() });
    }, PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send — socket not open');
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  /**
   * Forget all active subscriptions then close the socket.
   * Call this in your component cleanup (useEffect return / unmount).
   */
  function close() {
    intentionallyClosed = true;
    stopPing();
    if (!socket) return;

    // Ask Deriv to cancel all subscriptions before disconnecting
    if (socket.readyState === WebSocket.OPEN) {
      send({ forget_all: 'all', req_id: reqId() });
      // Also forget individual IDs as a belt-and-suspenders measure
      for (const id of subscriptionIds) {
        send({ forget: id, req_id: reqId() });
      }
    }
    subscriptionIds.clear();
    socket.close();
  }

  connect();
  return { send, close };
}

// ── Auto-incrementing req_id ─────────────────────────────────────────────────
let _reqId = 1;
export function reqId() { return _reqId++; }

// ── Deriv message builders ───────────────────────────────────────────────────

export const DerivMsg = {
  /** Subscribe to live ticks for a symbol */
  subscribeTicks: (symbol = '1HZ100V') => ({
    ticks:     symbol,
    subscribe: 1,
    req_id:    reqId(),
  }),

  /** Get list of active symbols (brief) */
  activeSymbols: () => ({
    active_symbols: 'brief',
    req_id:         reqId(),
  }),

  /** Create a contract proposal (subscribes to price stream) */
  proposal: ({
    amount       = 10,
    basis        = 'stake',
    type         = 'CALL',
    currency     = 'USD',
    duration     = 5,
    durationUnit = 't',
    symbol       = '1HZ100V',
  } = {}) => ({
    proposal:          1,
    subscribe:         1,
    amount,
    basis,
    contract_type:     type,
    currency,
    duration,
    duration_unit:     durationUnit,
    underlying_symbol: symbol,
    req_id:            reqId(),
  }),

  /** Buy a contract by proposal ID */
  buy: (proposalId, price = 10) => ({
    buy:    proposalId,
    price,
    req_id: reqId(),
  }),

  /** Subscribe to an open contract's live status */
  subscribeOpenContract: (contractId) => ({
    proposal_open_contract: 1,
    contract_id:            contractId,
    subscribe:              1,
    req_id:                 reqId(),
  }),

  /** Ping to keep connection alive */
  ping: () => ({
    ping:   1,
    req_id: reqId(),
  }),
};
