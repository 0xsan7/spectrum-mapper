class WebSocketClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.reconnectAttempts = 0;
    this.connect();
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      document.getElementById('statusText').textContent = 'Connected';
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (error) {
        console.error('Parse error:', error);
      }
    };

    this.ws.onerror = () => {
      document.getElementById('statusText').textContent = 'Error';
    };

    this.ws.onclose = () => {
      document.getElementById('statusText').textContent = 'Disconnected';
      if (this.reconnectAttempts < 5) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 3000);
      }
    };
  }
}
