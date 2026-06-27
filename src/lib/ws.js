/**
 * Lightweight WebSocket manager.
 *
 * Usage:
 *   const ws = createDerivWS('wss://...', {
 *     onMessage: (msg) => console.log(msg),
 *     onOpen:    ()    => ws.send({ active_symbols: 'brief' }),
 *   });
 *   ws.send({ ticks: '1HZ100V', subscribe: 1 });
 *   ws.close(); // clean up
 */
export function createDerivWS(url, { onMessage, onOpen, onError, onClose } = {}) {
  let socket = null;
  // Track subscription IDs so we can forget them on close
  const subscriptionIds = new Set();

  function connect() {
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      console.log('[WS] Connected:', url);
      onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Record subscription IDs returned by Deriv
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
      onClose?.(ev);
    });
  }

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
    if (!socket) return;
    // Ask Deriv to cancel each subscription before disconnecting
    for (const id of subscriptionIds) {
      send({ forget: id });
    }
    subscriptionIds.clear();
    socket.close();
  }

  connect();
  return { send, close };
}

// ─── Deriv message builders ──────────────────────────────────────────────────

export const DerivMsg = {
  /** Subscribe to live ticks for a symbol */
  subscribeTicks: (symbol = '1HZ100V') => ({
    ticks: symbol,
    subscribe: 1,
  }),

  /** Get list of active symbols */
  activeSymbols: () => ({
    active_symbols: 'brief',
  }),

  /** Create a contract proposal */
  proposal: ({
    amount     = 10,
    basis      = 'stake',
    type       = 'CALL',
    currency   = 'USD',
    duration   = 5,
    durationUnit = 't',
    symbol     = '1HZ100V',
  } = {}) => ({
    proposal: 1,
    subscribe: 1,
    amount,
    basis,
    contract_type:     type,
    currency,
    duration,
    duration_unit:     durationUnit,
    underlying_symbol: symbol,
  }),

  /** Buy a contract by proposal ID */
  buy: (proposalId, price = 10) => ({
    buy:   proposalId,
    price,
  }),

  /** Subscribe to an open contract's state */
  subscribeOpenContract: (contractId) => ({
    proposal_open_contract: 1,
    contract_id:            contractId,
    subscribe:              1,
  }),
};
