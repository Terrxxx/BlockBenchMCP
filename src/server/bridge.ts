import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { BridgeConfig } from '../shared/config.js';
import { BridgeError } from '../shared/errors.js';
import type { Logger } from '../shared/logger.js';
import {
  helloSchema, isReadOnlyCommand, inputSchemas, outputSchemas, parseJson, responseSchema, VERSION, MAX_MESSAGE_BYTES,
  type Command, type ToolInput, type ToolOutput,
} from '../shared/protocol.js';

interface Pending {
  command: Command;
  finish: (error: BridgeError | null, result?: unknown) => void;
}

export class BridgeServer {
  private server: WebSocketServer | undefined;
  private peer: WebSocket | undefined;
  private readonly pending = new Map<string, Pending>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private alive = true;
  constructor(readonly config: BridgeConfig, private readonly log: Logger,
    private readonly acceptClient?: (socket: WebSocket, hello: unknown) => void) {}

  get connected(): boolean { return this.peer?.readyState === WebSocket.OPEN; }
  get port(): number {
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw new Error('Bridge not listening');
    return address.port;
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('Bridge already started');
    const server = new WebSocketServer({
      host: '127.0.0.1', port: this.config.port, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false,
      verifyClient: (info: { req: IncomingMessage }) => {
        const host = info.req.headers.host;
        const origin = info.req.headers.origin;
        return info.req.socket.remoteAddress === '127.0.0.1'
          && host === `127.0.0.1:${this.port}`
          && (origin === undefined || origin === 'file://' || origin === 'null')
          && (this.server?.clients.size ?? 0) < (this.acceptClient ? 20 : 4);
      },
    });
    this.server = server;
    server.on('connection', socket => this.accept(socket));
    server.on('error', error => {
      if (this.acceptClient && 'code' in error && error.code === 'EADDRINUSE') return; // Normal follower election.
      this.log('error', 'bridge_error');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    }).catch(error => { this.server = undefined; server.close(); throw error; });
    this.heartbeat = setInterval(() => {
      if (!this.peer) return;
      if (!this.alive) { this.peer.terminate(); return; }
      this.alive = false;
      this.peer.ping();
    }, 10_000);
    this.heartbeat.unref();
    this.log('info', 'bridge_listening', { host: '127.0.0.1', port: this.port });
  }

  private accept(socket: WebSocket): void {
    let authenticated = false;
    let client = false;
    const timer = setTimeout(() => socket.terminate(), 3000);
    socket.on('error', () => this.log('warn', 'socket_error'));
    socket.on('pong', () => { if (this.peer === socket) this.alive = true; });
    socket.on('close', () => {
      clearTimeout(timer);
      if (this.peer !== socket) return;
      this.peer = undefined;
      this.rejectPending('DISCONNECTED', 'Blockbench disconnected; inspect state before retrying a mutation.');
      this.log('warn', 'plugin_disconnected');
    });
    socket.on('message', (data, binary) => {
      if (client) return;
      try {
        if (binary) throw new BridgeError('INVALID_MESSAGE', 'Text frames required.');
        const message = parseJson(data.toString());
        if (!authenticated) {
          if (this.acceptClient && typeof message === 'object' && message !== null && 'type' in message && message.type === 'client_hello') {
            client = true;
            clearTimeout(timer);
            this.acceptClient(socket, message);
            return;
          }
          const hello = helloSchema.parse(message);
          const supplied = Buffer.from(hello.token);
          const expected = Buffer.from(this.config.token);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
            || hello.workspace !== this.config.workspace || this.peer) {
            socket.close(1008, 'Authentication or session rejected');
            return;
          }
          authenticated = true;
          clearTimeout(timer);
          this.peer = socket;
          this.alive = true;
          socket.send(JSON.stringify({ version: VERSION, type: 'ready' }));
          this.log('info', 'plugin_connected', { blockbench_version: hello.blockbench_version });
          return;
        }
        const response = responseSchema.parse(message);
        const item = this.pending.get(response.request_id);
        if (!item) { this.log('warn', 'late_or_unknown_response', { request_id: response.request_id }); return; }
        if (response.ok) {
          const parsed = outputSchemas[item.command].safeParse(response.result);
          if (!parsed.success) item.finish(new BridgeError('INVALID_MESSAGE', 'Plugin returned an invalid result.', !isReadOnlyCommand(item.command)));
          else item.finish(null, parsed.data);
        } else item.finish(new BridgeError(response.error.code, response.error.message, response.error.outcome_unknown));
      } catch {
        this.log('warn', 'invalid_plugin_message');
        socket.close(1008, 'Invalid bridge message');
      }
    });
  }

  async call<K extends Command>(command: K, input: ToolInput<K>, signal?: AbortSignal): Promise<ToolOutput<K>> {
    const params = inputSchemas[command].parse(input);
    const peer = this.peer;
    if (!peer || peer.readyState !== WebSocket.OPEN) throw new BridgeError('NOT_CONNECTED', 'Connect the Blockbench AI MCP desktop plugin first.');
    if (signal?.aborted) throw new BridgeError('CANCELLED', 'Request cancelled before dispatch.');
    if (this.pending.size >= 32) throw new BridgeError('BUSY', 'Too many pending requests.');
    const requestId = randomUUID();
    const started = Date.now();
    const result = await new Promise<unknown>((resolve, reject) => {
      const finish = (error: BridgeError | null, value?: unknown): void => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.log(error ? 'warn' : 'info', 'request_finished', {
          request_id: requestId, command, duration_ms: Date.now() - started, code: error?.code ?? 'OK',
        });
        if (error) reject(error); else resolve(value);
      };
      const abort = (): void => finish(new BridgeError('CANCELLED', 'Waiting cancelled; inspect state before retrying a mutation.', !isReadOnlyCommand(command)));
      const timer = setTimeout(() => finish(new BridgeError('TIMEOUT', 'Blockbench request timed out; inspect state before retrying a mutation.', !isReadOnlyCommand(command))), this.config.timeout_ms);
      this.pending.set(requestId, { command, finish });
      signal?.addEventListener('abort', abort, { once: true });
      peer.send(JSON.stringify({ version: VERSION, type: 'request', request_id: requestId, deadline_ms: started + this.config.timeout_ms, command, params }), error => {
        if (error) finish(new BridgeError('DISCONNECTED', 'Request could not be delivered.', !isReadOnlyCommand(command)));
      });
    });
    // The command-specific schema is checked at the network boundary above.
    return result as ToolOutput<K>;
  }

  private rejectPending(code: 'DISCONNECTED', message: string): void {
    for (const pending of this.pending.values()) pending.finish(new BridgeError(code, message, !isReadOnlyCommand(pending.command)));
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    this.rejectPending('DISCONNECTED', 'Bridge stopped.');
    const server = this.server;
    if (!server) return;
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    this.server = undefined;
    this.peer = undefined;
  }
}
