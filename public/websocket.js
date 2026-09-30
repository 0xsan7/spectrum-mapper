class WebSocketClient {
  /**
   * @param {(data: object) => void} onMessage called with each parsed frame
   * @param {(message: object) => void} [onStatus] called with
   *   {state, error} on connect / disconnect / protocol error
   */
  constructor(onMessage, onStatus = () => {}) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.reconnectAttempts = 0;
    this.closedByUs = false;
    this.queue = [];
    this.connect();
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatus({ state: 'Connected' });
      // Flush anything typed while we were down.
      const queued = this.queue;
      this.queue = [];
      queued.forEach((msg) => this.send(msg));
    };

    this.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        Logger.error('Parse error', error);
        return;
      }
      if (data && data.type === 'error') {
        Logger.error(`Server rejected a message: ${data.message}`);
        return;
      }
      this.onMessage(data);
    };

    this.ws.onerror = () => this.onStatus({ state: 'Connection error' });

    this.ws.onclose = () => {
      this.onStatus({ state: 'Disconnected' });
      if (this.closedByUs) return;
      // Back off, capped, rather than hammering a server that is down.
      if (this.reconnectAttempts < 5) {
        const delay = 1000 * 2 ** this.reconnectAttempts;
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
      } else {
        this.onStatus({ state: 'Reconnect limit reached' });
      }
    };
  }

  /**
   * Send a command. Messages issued while the socket is down are queued and
   * flushed on reconnect, so dragging a slider offline does not lose state.
   */
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else if (this.queue.length < 50) {
      this.queue.push(message);
    }
  }

  close() {
    this.closedByUs = true;
    if (this.ws) this.ws.close();
  }
}
