/**
 * The live channel to the Site Server (same origin WebSocket): note changes, guided
 * session messages and WebRTC signalling. Reconnects by itself after a drop.
 */
export type LiveMessage = Record<string, unknown> & { t: string };
type Listener = (m: LiveMessage) => void;

export class LiveChannel {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private queue: string[] = [];
  private closed = false;
  private retry = 500;
  /** Called with true when connected, false when the connection dropped. */
  onState: (connected: boolean) => void = () => undefined;
  /** Re-sent after every reconnection (e.g. which environment this page watches). */
  private hello: LiveMessage[] = [];

  constructor() {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`,
    );
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.onState(true);
      for (const m of this.hello) ws.send(JSON.stringify(m));
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      let m: LiveMessage;
      try {
        m = JSON.parse(String(e.data)) as LiveMessage;
      } catch {
        return;
      }
      for (const fn of [...(this.listeners.get(m.t) ?? []), ...(this.listeners.get('*') ?? [])])
        fn(m);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onState(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 10_000);
    };
  }

  /** Sends now (or when connected); `sticky` messages are sent again after reconnecting. */
  send(m: LiveMessage, sticky = false): void {
    if (sticky) this.hello = [...this.hello.filter((x) => x.t !== m.t), m];
    const s = JSON.stringify(m);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (!sticky) this.queue.push(s);
  }

  forget(t: string): void {
    this.hello = this.hello.filter((x) => x.t !== t);
  }

  on(t: string, fn: Listener): () => void {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
    return () => this.listeners.get(t)?.delete(fn);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
