// WebSocket mit automatischem Wiederverbinden.

export class Socket {
  constructor(onMessage, onState) {
    this.onMessage = onMessage;
    this.onState = onState;
    this.ws = null;
    this.queue = [];
    this.retry = 500;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.onState(true);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      this.onState(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 5000);
    };
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (this.queue.length < 50) this.queue.push(data);
  }
}
