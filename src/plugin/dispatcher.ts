import { z } from 'zod';
import { asBridgeError, BridgeError } from '../shared/errors.js';
import { failure, outputSchemas, parseJson, requestSchema, VERSION, type Request, type Response } from '../shared/protocol.js';
import type { Logger } from '../shared/logger.js';

export type CommandHandler = (request: Request) => unknown | Promise<unknown>;
interface CacheEntry { fingerprint: string; response: Promise<Response> }

/** Serializes host operations; deduplicates only the last 256 accepted request IDs. */
export class Dispatcher {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly handler: CommandHandler, private readonly log: Logger) {}

  async receive(text: string, active: () => boolean = () => true): Promise<Response | null> {
    let value: unknown;
    try { value = parseJson(text); }
    catch { return null; }
    const identity = z.object({ request_id: z.uuid(), version: z.number() }).safeParse(value);
    if (!identity.success) return null;
    if (identity.data.version !== VERSION) return failure(identity.data.request_id, new BridgeError('UNSUPPORTED_VERSION', 'Unsupported bridge protocol version.'));
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) return failure(identity.data.request_id, asBridgeError(parsed.error));
    const request = parsed.data;
    const fingerprint = JSON.stringify(request);
    const cached = this.cache.get(request.request_id);
    if (cached) return cached.fingerprint === fingerprint ? cached.response
      : failure(request.request_id, new BridgeError('DUPLICATE_REQUEST', 'request_id was already used with different content.'));
    if (this.queued >= 32) return failure(request.request_id, new BridgeError('BUSY', 'Plugin queue is full.'));
    this.queued++;
    const response = this.tail.then(async (): Promise<Response> => {
      try {
        if (!active()) throw new BridgeError('DISCONNECTED', 'Connection closed before execution.');
        if (Date.now() >= request.deadline_ms) throw new BridgeError('TIMEOUT', 'Request expired before execution.');
        const parsedResult = outputSchemas[request.command].safeParse(await this.handler(request));
        if (!parsedResult.success) throw new BridgeError('INVALID_MESSAGE', 'Host produced an invalid result; inspect state before retrying.', request.command !== 'get_project_state');
        return { version: VERSION, type: 'response', request_id: request.request_id, ok: true, result: parsedResult.data };
      } catch (error) {
        const mapped = asBridgeError(error);
        this.log('warn', 'command_failed', { request_id: request.request_id, command: request.command, code: mapped.code });
        return failure(request.request_id, mapped);
      } finally { this.queued--; }
    });
    this.tail = response;
    this.cache.set(request.request_id, { fingerprint, response });
    if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
    return response;
  }
}
