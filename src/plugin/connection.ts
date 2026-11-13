import type { BridgeConfig } from '../shared/config.js';
import type { Logger } from '../shared/logger.js';
import { parseJson, readySchema, VERSION, PLUGIN_VERSION } from '../shared/protocol.js';
import { Dispatcher } from './dispatcher.js';

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onOpen(callback: () => void): void;
  onMessage(callback: (data: unknown) => void): void;
  onClose(callback: () => void): void;
  onError(callback: () => void): void;
}
export type SocketFactory = (url: string) => SocketLike;
export const browserSocket: SocketFactory = url => {
  const socket = new WebSocket(url);
  return {
    get readyState() { return socket.readyState; },
    send: data => socket.send(data), close: () => socket.close(),
    onOpen: callback => socket.addEventListener('open', callback),
    onMessage: callback => socket.addEventListener('message', event => callback(event.data as unknown)),
    onClose: callback => socket.addEventListener('close', callback),
    onError: callback => socket.addEventListener('error', callback),
  };
};

export class PluginConnection {
  private socket: SocketLike | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private attempts = 0;
  constructor(
    private readonly config: BridgeConfig,
    private readonly dispatcher: Dispatcher,
    private readonly factory: SocketFactory,
    private readonly log: Logger,
    private readonly blockbenchVersion: string,
    private readonly status: (value: string) => void = () => {},
    private readonly retryBaseMs = 500,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: SocketLike;
    try { socket = this.factory(`ws://127.0.0.1:${this.config.port}`); }
    catch { this.scheduleRetry(); return; }
    this.socket = socket;
    let ready = false;
    this.status('Connecting');
    this.handshake = setTimeout(() => socket.close(), 3000);
    socket.onOpen(() => socket.send(JSON.stringify({
      version: VERSION, type: 'hello', workspace: this.config.workspace, token: this.config.token,
      plugin_version: PLUGIN_VERSION, blockbench_version: this.blockbenchVersion,
    })));
    socket.onMessage(data => {
      if (typeof data !== 'string') { socket.close(); return; }
      if (!ready) {
        try { readySchema.parse(parseJson(data)); }
        catch { socket.close(); return; }
        ready = true;
        this.attempts = 0;
        clearTimeout(this.handshake);
        this.status('Connected');
        this.log('info', 'bridge_connected');
        return;
      }
      void this.dispatcher.receive(data, () => !this.stopped && this.socket === socket && socket.readyState === 1)
        .then(response => {
          if (socket.readyState !== 1) return;
          if (response) socket.send(JSON.stringify(response)); else socket.close();
        }).catch(() => socket.close());
    });
    socket.onError(() => this.log('warn', 'bridge_connection_error'));
    socket.onClose(() => {
      if (this.socket !== socket) return;
      clearTimeout(this.handshake);
      this.socket = undefined;
      this.status('Disconnected');
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = Math.min(this.retryBaseMs * 2 ** Math.min(this.attempts++, 5), 10_000);
    this.retry = setTimeout(() => this.connect(), delay);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.status('Disconnected');
  }
}
