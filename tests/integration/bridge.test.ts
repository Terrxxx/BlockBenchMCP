import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { BridgeServer } from '../../src/server/bridge.js';
import { PluginConnection, type SocketFactory } from '../../src/plugin/connection.js';
import { Dispatcher } from '../../src/plugin/dispatcher.js';
import { silentLogger } from '../../src/shared/logger.js';
import type { BridgeConfig } from '../../src/shared/config.js';
import { inputSchemas, type Request } from '../../src/shared/protocol.js';
import { tempWorkspace } from '../helpers/temp.js';

const emptyState = { project: null, cubes: [], offset: 0, next_offset: null, bones: [], bone_offset: 0, next_bone_offset: null,
  textures: [], texture_offset: 0, next_texture_offset: null };
const sockets: WebSocket[] = [];
const bridges: BridgeServer[] = [];
const connections: PluginConnection[] = [];
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(10); }
  throw new Error('Condition did not become true');
}
async function bridge(timeout = 200): Promise<BridgeServer> {
  const config: BridgeConfig = { version: 1, host: '127.0.0.1', port: 0, token: randomBytes(32).toString('hex'), workspace: tempWorkspace(), timeout_ms: timeout };
  const server = new BridgeServer(config, silentLogger);
  bridges.push(server);
  await server.start();
  return server;
}
async function peer(server: BridgeServer, overrides: Record<string, unknown> = {}): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ version: 2, type: 'hello', workspace: server.config.workspace, token: server.config.token, plugin_version: '0.2.0', blockbench_version: '5.2.2', ...overrides }));
  return socket;
}
const stateInput = inputSchemas.get_project_state.parse({});
afterEach(async () => {
  for (const connection of connections.splice(0)) connection.stop();
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of bridges.splice(0)) await server.close();
});

describe('real loopback WebSocket bridge', () => {
  it('rejects a phase-one plugin instead of silently mixing protocol versions', async () => {
    const server = await bridge();
    const socket = await peer(server, { version: 1, plugin_version: '0.1.0' });
    await until(() => socket.readyState === WebSocket.CLOSED);
    expect(server.connected).toBe(false);
  });
  it('rejects offline requests and wrong token without becoming connected', async () => {
    const server = await bridge();
    await expect(server.call('get_project_state', stateInput)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    const socket = await peer(server, { token: '0'.repeat(64) });
    await until(() => socket.readyState === WebSocket.CLOSED);
    expect(server.connected).toBe(false);
  });
  it('rejects browser origins and a second plugin', async () => {
    const server = await bridge();
    const hostile = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: 'https://example.com' });
    sockets.push(hostile);
    await new Promise<void>(resolve => hostile.once('error', () => resolve()));
    await peer(server);
    await until(() => server.connected);
    const second = await peer(server);
    await until(() => second.readyState === WebSocket.CLOSED);
    expect(server.connected).toBe(true);
  });
  it('matches out-of-order replies by request_id', async () => {
    const server = await bridge(1000);
    const socket = await peer(server);
    await until(() => server.connected);
    const received: Request[] = [];
    socket.on('message', data => {
      const request = JSON.parse(data.toString()) as Request;
      if (request.type !== 'request') return;
      received.push(request);
      if (received.length === 2) for (const item of received.reverse()) {
        socket.send(JSON.stringify({ version: 2, type: 'response', request_id: item.request_id, ok: true, result: { ...emptyState, offset: (item.params as typeof stateInput).offset } }));
      }
    });
    const [first, second] = await Promise.all([
      server.call('get_project_state', { ...stateInput, offset: 3, limit: 1 }), server.call('get_project_state', { ...stateInput, offset: 7, limit: 1 }),
    ]);
    expect([first.offset, second.offset]).toEqual([3, 7]);
  });
  it('times out mutations with uncertain outcome and does not replay them', async () => {
    const server = await bridge(40);
    const socket = await peer(server);
    await until(() => server.connected);
    let count = 0;
    socket.on('message', () => { count++; });
    await expect(server.call('create_project', inputSchemas.create_project.parse({ name: 'test', model_identifier: 'test' })))
      .rejects.toMatchObject({ code: 'TIMEOUT', outcomeUnknown: true });
    await pause(60);
    expect(count).toBe(1);
  });
  it('cleans pending requests on disconnect and can accept a replacement peer', async () => {
    const server = await bridge();
    const socket = await peer(server);
    await until(() => server.connected);
    const request = expect(server.call('get_project_state', stateInput)).rejects.toMatchObject({ code: 'DISCONNECTED' });
    socket.close();
    await request;
    const replacement = await peer(server);
    await until(() => server.connected);
    replacement.on('message', data => {
      const value = JSON.parse(data.toString()) as Request;
      replacement.send(JSON.stringify({ version: 2, type: 'response', request_id: value.request_id, ok: true, result: emptyState }));
    });
    await expect(server.call('get_project_state', stateInput)).resolves.toEqual(emptyState);
  });
  it('supports cancellation and validates plugin results', async () => {
    const server = await bridge();
    const socket = await peer(server);
    await until(() => server.connected);
    const controller = new AbortController();
    const result = expect(server.call('get_project_state', stateInput, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await result;
    socket.on('message', data => {
      const value = JSON.parse(data.toString()) as Request;
      socket.send(JSON.stringify({ version: 2, type: 'response', request_id: value.request_id, ok: true, result: { wrong: true } }));
    });
    await expect(server.call('get_project_state', stateInput)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });
  it('runs the plugin connection and reconnects after transport loss', async () => {
    const server = await bridge(1000);
    const factory: SocketFactory = url => {
      const ws = new WebSocket(url); sockets.push(ws);
      return {
        get readyState() { return ws.readyState; }, send: data => ws.send(data), close: () => ws.close(),
        onOpen: cb => { ws.on('open', cb); }, onClose: cb => { ws.on('close', cb); },
        onError: cb => { ws.on('error', cb); }, onMessage: cb => { ws.on('message', data => cb(data.toString())); },
      };
    };
    const connection = new PluginConnection({ ...server.config, port: server.port }, new Dispatcher(() => emptyState, silentLogger), factory, silentLogger, '5.2.2', () => {}, 10);
    connections.push(connection); connection.start();
    await until(() => server.connected);
    await expect(server.call('get_project_state', stateInput)).resolves.toEqual(emptyState);
    sockets.at(-1)!.terminate();
    await until(() => sockets.length >= 2 && server.connected);
    await expect(server.call('get_project_state', stateInput)).resolves.toEqual(emptyState);
    connection.stop();
    await until(() => !server.connected);
    const count = sockets.length;
    await pause(50);
    expect(sockets).toHaveLength(count);
  });
});

describe('plugin dispatcher', () => {
  const request = (): Request => ({ version: 2, type: 'request', request_id: randomUUID(), deadline_ms: Date.now() + 1000, command: 'get_project_state', params: stateInput });
  it('deduplicates request_id and refuses reuse with different arguments', async () => {
    let calls = 0;
    const dispatcher = new Dispatcher(() => { calls++; return emptyState; }, silentLogger);
    const message = request();
    const [a, b] = await Promise.all([dispatcher.receive(JSON.stringify(message)), dispatcher.receive(JSON.stringify(message))]);
    expect(a).toEqual(b); expect(calls).toBe(1);
    expect(await dispatcher.receive(JSON.stringify({ ...message, deadline_ms: message.deadline_ms + 1 })))
      .toMatchObject({ ok: false, error: { code: 'DUPLICATE_REQUEST' } });
  });
  it('rejects expired, invalid and disconnected queued commands without invoking the host', async () => {
    let calls = 0;
    const dispatcher = new Dispatcher(() => { calls++; return emptyState; }, silentLogger);
    expect(await dispatcher.receive(JSON.stringify({ ...request(), deadline_ms: 1 }))).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(await dispatcher.receive(JSON.stringify({ ...request(), command: 'eval' }))).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(await dispatcher.receive(JSON.stringify(request()), () => false)).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(await dispatcher.receive(JSON.stringify({ ...request(), version: 99 }))).toMatchObject({ error: { code: 'UNSUPPORTED_VERSION' } });
    expect(calls).toBe(0);
  });
  it('serializes execution and checks expiry after waiting in the queue', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const dispatcher = new Dispatcher(async () => { calls++; await gate; return emptyState; }, silentLogger);
    const first = dispatcher.receive(JSON.stringify(request()));
    const second = dispatcher.receive(JSON.stringify({ ...request(), deadline_ms: Date.now() + 5 }));
    await pause(15); release();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ error: { code: 'TIMEOUT' } });
    expect(calls).toBe(1);
  });
});
