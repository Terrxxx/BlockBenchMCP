import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { BridgeServer } from './bridge.js';
import type { BridgeConfig } from '../shared/config.js';
import type { Logger } from '../shared/logger.js';
import { asBridgeError, BridgeError, errorSchema } from '../shared/errors.js';
import { commandNames, inputSchemas, outputSchemas, isReadOnlyCommand, parseJson, MAX_MESSAGE_BYTES, type Command, type ToolInput, type ToolOutput } from '../shared/protocol.js';
import { nativeId } from '../shared/schemas/common.js';

const helloSchema = z.strictObject({ type: z.literal('client_hello'), version: z.literal(1), workspace: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/) });
const callSchema = z.strictObject({ type: z.literal('client_call'), id: z.uuid(), command: z.enum(commandNames), params: z.unknown(), target: nativeId.optional(), deadline: z.number().int().positive() });
const cancelSchema = z.strictObject({ type: z.literal('client_cancel'), id: z.uuid() });
const replySchema = z.discriminatedUnion('ok', [
  z.strictObject({ type: z.literal('client_result'), id: z.uuid(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ type: z.literal('client_result'), id: z.uuid(), ok: z.literal(false), error: errorSchema }),
]);
type Call = z.infer<typeof callSchema>;
export type BridgeCaller = Pick<BridgeServer, 'call'>;

/** One port owner, many authenticated stdio forwarders; no request replay. */
export class SharedBridge implements BridgeCaller {
  private owner: BridgeServer | undefined;
  private socket: WebSocket | undefined;
  private opening: Promise<void> | undefined;
  private stopped = false;
  private target: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private clients = new Set<WebSocket>();
  private pending = new Map<string, (error?: BridgeError, result?: unknown) => void>();
  constructor(private readonly config: BridgeConfig, private readonly log: Logger) {}
  async start(): Promise<void> { await this.connect(); }
  private async connect(): Promise<void> {
    if (this.stopped) throw new BridgeError('DISCONNECTED', 'MCP session closed.');
    if (this.owner || this.socket?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async open(): Promise<void> {
    const owner = new BridgeServer(this.config, this.log, (socket, hello) => this.accept(socket, hello));
    try { await owner.start(); if (this.stopped) { await owner.close(); return; } this.owner = owner; return; }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error; }
    const socket = new WebSocket(`ws://127.0.0.1:${this.config.port}`, { maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false, handshakeTimeout: 3000 });
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { socket.terminate(); reject(new BridgeError('UNSUPPORTED_VERSION', 'Existing bridge did not accept multi-session handshake; restart the old MCP server.')); }, 3000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'client_hello', version: 1, workspace: this.config.workspace, token: this.config.token })));
      socket.on('message', (data, binary) => {
        try {
          if (binary) throw new Error('Binary frame');
          const value = parseJson(data.toString());
          if (!ready) {
            z.strictObject({ type: z.literal('client_ready'), version: z.literal(1) }).parse(value);
            ready = true; clearTimeout(timer);
            if (this.stopped) { socket.terminate(); reject(new BridgeError('DISCONNECTED', 'Session closed.')); return; }
            this.socket = socket; resolve(); return;
          }
          const reply = replySchema.parse(value);
          this.pending.get(reply.id)?.(reply.ok ? undefined : new BridgeError(reply.error.code, reply.error.message, reply.error.outcome_unknown), reply.ok ? reply.result : undefined);
        } catch { socket.terminate(); }
      });
      socket.on('error', () => { if (!ready) { clearTimeout(timer); reject(new BridgeError('DISCONNECTED', 'Cannot reach the shared bridge; retry connection, not a prior mutation.')); } });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!ready) reject(new BridgeError('UNSUPPORTED_VERSION', 'Shared bridge handshake rejected: check workspace/key or restart the old MCP server.'));
        if (this.socket !== socket) return;
        this.socket = undefined;
        for (const finish of this.pending.values()) finish(new BridgeError('DISCONNECTED', 'Shared bridge disconnected; inspect state before retrying.', true));
      });
    });
  }
  private accept(socket: WebSocket, value: unknown): void {
    const hello = helloSchema.safeParse(value);
    if (!hello.success || hello.data.workspace !== this.config.workspace || !timingSafeEqual(Buffer.from(hello.data.token), Buffer.from(this.config.token)) || this.clients.size >= 16) {
      socket.close(1008, 'Client authentication/version/limit rejected'); return;
    }
    this.clients.add(socket);
    const active = new Map<string, AbortController>();
    const seen = new Set<string>();
    socket.on('close', () => { this.clients.delete(socket); for (const c of active.values()) c.abort(); });
    socket.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Binary');
        const value = parseJson(data.toString());
        const cancel = cancelSchema.safeParse(value);
        if (cancel.success) { active.get(cancel.data.id)?.abort(); return; }
        const call = callSchema.parse(value);
        if (seen.has(call.id)) { socket.close(1008, 'Duplicate request'); return; }
        if (seen.size >= 4096) { socket.close(1008, 'Client request limit; reconnect'); return; }
        seen.add(call.id);
        const controller = new AbortController(); active.set(call.id, controller);
        void this.dispatch(call, controller.signal).then(result => ({ type: 'client_result', id: call.id, ok: true, result }), error => ({ type: 'client_result', id: call.id, ok: false, error: asBridgeError(error).toJSON() }))
          .then(reply => { active.delete(call.id); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply)); });
      } catch { socket.close(1008, 'Invalid client message'); }
    });
    socket.send(JSON.stringify({ type: 'client_ready', version: 1 }));
  }
  private dispatch(call: Call, signal?: AbortSignal): Promise<unknown> {
    if (this.queued >= 32) return Promise.reject(new BridgeError('BUSY', 'Shared operation queue is full.'));
    const params = inputSchemas[call.command].parse(call.params);
    const deadline = Math.min(call.deadline, Date.now() + this.config.timeout_ms);
    this.queued++;
    const task = this.tail.then(async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
      try {
        if (signal?.aborted || this.stopped) throw new BridgeError('CANCELLED', 'Request cancelled before dispatch.');
        if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Request expired in the shared queue.');
        const owner = this.owner;
        if (!owner) throw new BridgeError('DISCONNECTED', 'Bridge ownership changed.');
        const target = 'project_id' in params ? params.project_id : call.target;
        if (target && !['create_project', 'select_project', 'list_projects'].includes(call.command)) {
          await owner.call('select_project', { project_id: target }, controller.signal);
        }
        if (Date.now() >= deadline || controller.signal.aborted) throw new BridgeError('TIMEOUT', 'Request expired before model operation.');
        return await owner.call(call.command, params, controller.signal);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.queued--; }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async call<K extends Command>(command: K, input: ToolInput<K>, signal?: AbortSignal): Promise<ToolOutput<K>> {
    const params = inputSchemas[command].parse(input);
    await this.connect();
    if (this.stopped) throw new BridgeError('DISCONNECTED', 'MCP session closed before dispatch.');
    if (signal?.aborted) throw new BridgeError('CANCELLED', 'Cancelled before dispatch.');
    const call: Call = { type: 'client_call', id: randomUUID(), command, params, deadline: Date.now() + this.config.timeout_ms, ...(this.target ? { target: this.target } : {}) };
    let result: unknown;
    if (this.owner) result = await this.dispatch(call, signal);
    else {
      const socket = this.socket!;
      result = await new Promise<unknown>((resolve, reject) => {
        const cancel = () => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'client_cancel', id: call.id })); };
        const finish = (error?: BridgeError, value?: unknown) => {
          if (!this.pending.delete(call.id)) return;
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (error) reject(new BridgeError(error.code, error.message, error.outcomeUnknown && !isReadOnlyCommand(command))); else resolve(value);
        };
        const abort = () => { cancel(); finish(new BridgeError('CANCELLED', 'Waiting cancelled; inspect state before retrying.', true)); };
        const timer = setTimeout(() => { cancel(); finish(new BridgeError('TIMEOUT', 'Shared request timed out; inspect state before retrying.', true)); }, this.config.timeout_ms);
        this.pending.set(call.id, finish); signal?.addEventListener('abort', abort, { once: true });
        socket.send(JSON.stringify(call), error => { if (error) finish(new BridgeError('DISCONNECTED', 'Shared request send failed.', true)); });
      });
    }
    const parsed = outputSchemas[command].safeParse(result);
    if (!parsed.success) throw new BridgeError('INVALID_MESSAGE', 'Shared bridge returned an invalid result; inspect state before retrying.', !isReadOnlyCommand(command));
    const checked = parsed.data;
    if ((command === 'create_project' || command === 'select_project') && 'project' in checked && checked.project) this.target = checked.project.id;
    else if ('project_id' in params) this.target = params.project_id;
    return checked as ToolOutput<K>;
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.socket?.terminate();
    await this.owner?.close(); this.owner = undefined;
  }
}
