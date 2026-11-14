import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { SharedBridge } from '../../src/server/shared-bridge.js';
import { PluginConnection } from '../../src/plugin/connection.js';
import { Dispatcher } from '../../src/plugin/dispatcher.js';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { silentLogger } from '../../src/shared/logger.js';
import { inputSchemas, type Request } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';
import type { BridgeConfig } from '../../src/shared/config.js';

const bridges: SharedBridge[] = [], plugins: PluginConnection[] = [];
const delay = (n: number) => new Promise(r => setTimeout(r, n));
afterEach(async () => { plugins.splice(0).forEach(p => p.stop()); await Promise.all(bridges.splice(0).map(b => b.close())); });
async function fixture(before?: (request: Request) => Promise<void>) {
  const listener = net.createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const address = listener.address() as net.AddressInfo;
  await new Promise<void>(r => listener.close(() => r()));
  const root = tempWorkspace();
  const config: BridgeConfig = { version: 1, workspace: root, token: randomBytes(32).toString('hex'), host: '127.0.0.1', port: address.port, timeout_ms: 1000 };
  const a = new SharedBridge(config, silentLogger), b = new SharedBridge(config, silentLogger); bridges.push(a, b);
  await a.start(); await b.start();
  const host = new FakeHost(), adapter = new BlockbenchAdapter(host, new Workspace(root, fs));
  const plugin = new PluginConnection(config, new Dispatcher(async r => { await before?.(r); return adapter.execute(r); }, silentLogger), url => {
    const s = new WebSocket(url);
    return { get readyState() { return s.readyState; }, send: d => s.send(d), close: () => s.close(), onOpen: cb => s.on('open', cb), onMessage: cb => s.on('message', d => cb(d.toString())), onClose: cb => s.on('close', cb), onError: cb => s.on('error', cb) };
  }, silentLogger, '5.2.2', () => {}, 10);
  plugins.push(plugin); plugin.start();
  for (let i = 0; i < 100; i++) { try { await a.call('list_projects', inputSchemas.list_projects.parse({})); break; } catch { await delay(10); } }
  return { a, b, config, host };
}
it('shares one plugin, serializes target selection and isolates each client current-project view', async () => {
  const { a, b } = await fixture();
  const pa = (await a.call('create_project', inputSchemas.create_project.parse({ name: 'A', model_identifier: 'a' }))).project.id;
  const pb = (await b.call('create_project', inputSchemas.create_project.parse({ name: 'B', model_identifier: 'b' }))).project.id;
  const cubes = (id: string, name: string) => inputSchemas.create_cubes.parse({ project_id: id, cubes: [{ name, from: [0, 0, 0], to: [1, 1, 1] }] });
  await Promise.all([a.call('create_cubes', cubes(pa, 'only_A')), b.call('create_cubes', cubes(pb, 'only_B'))]);
  const [sa, sb] = await Promise.all([a.call('get_project_state', inputSchemas.get_project_state.parse({})), b.call('get_project_state', inputSchemas.get_project_state.parse({}))]);
  expect(sa.project!.id).toBe(pa); expect(sa.cubes.map(c => c.name)).toEqual(['only_A']);
  expect(sb.project!.id).toBe(pb); expect(sb.cubes.map(c => c.name)).toEqual(['only_B']);
  await b.close(); expect((await a.call('get_project_state', inputSchemas.get_project_state.parse({}))).project!.id).toBe(pa);
});
it('surviving client takes ownership after owner exit and plugin reconnects without losing managed projects', async () => {
  const { a, b } = await fixture();
  const id = (await b.call('create_project', inputSchemas.create_project.parse({ name: 'survivor', model_identifier: 'survivor' }))).project.id;
  await a.close(); await delay(30);
  for (let i = 0; i < 100; i++) {
    try { const state = await b.call('get_project_state', inputSchemas.get_project_state.parse({})); expect(state.project!.id).toBe(id); expect(state.project!.managed).toBe(true); return; }
    catch (e) { if (i === 99) throw e; await delay(10); }
  }
});
it('rejects wrong credentials and another workspace without disrupting the owner', async () => {
  const { a, config } = await fixture();
  for (const changed of [{ token: '0'.repeat(64) }, { workspace: tempWorkspace() }]) {
    const c = new SharedBridge({ ...config, ...changed }, silentLogger); bridges.push(c);
    await expect(c.start()).rejects.toThrow('handshake rejected');
  }
  expect((await a.call('list_projects', inputSchemas.list_projects.parse({}))).total).toBe(0);
});
it('does not dispatch already cancelled mutations or silently use another tab after a target closes', async () => {
  const { a, b, host } = await fixture();
  const p = inputSchemas.create_project.parse({ name: 'cancel', model_identifier: 'cancel' });
  const controller = new AbortController(); controller.abort();
  await expect(b.call('create_project', p, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(host.tabs).toHaveLength(0);
  const id = (await b.call('create_project', p)).project.id;
  await a.call('create_project', p); host.tabs = host.tabs.filter(t => t.uuid !== id);
  await expect(b.call('get_project_state', inputSchemas.get_project_state.parse({}))).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('does not replay a timed-out mutation', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  const { a, b, host } = await fixture(async r => { if (r.command === 'create_cubes') { calls++; await gate; } });
  const id = (await a.call('create_project', inputSchemas.create_project.parse({ name: 'slow', model_identifier: 'slow' }))).project.id;
  const input = inputSchemas.create_cubes.parse({ project_id: id, cubes: [{ name: 'once', from: [0, 0, 0], to: [1, 1, 1] }] });
  const slow = b.call('create_cubes', input);
  const assertion = expect(slow).rejects.toMatchObject({ code: expect.stringMatching(/TIMEOUT|CANCELLED/), outcomeUnknown: true });
  await assertion;
  release(); await delay(30);
  expect(calls).toBe(1); expect(host.elements).toHaveLength(1);
  const state = await b.call('get_project_state', inputSchemas.get_project_state.parse({}));
  expect(state.cubes).toHaveLength(1); expect(calls).toBe(1);
});
it('cancels a queued client mutation without executing it after the active edit finishes', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  const { a, b, host } = await fixture(async r => { if (r.command === 'create_cubes') { calls++; await gate; } });
  const id = (await a.call('create_project', inputSchemas.create_project.parse({ name: 'queue', model_identifier: 'queue' }))).project.id;
  const input = inputSchemas.create_cubes.parse({ project_id: id, cubes: [{ name: 'one', from: [0, 0, 0], to: [1, 1, 1] }] });
  const first = a.call('create_cubes', input);
  while (!calls) await delay(5);
  const controller = new AbortController();
  const second = b.call('create_cubes', input, controller.signal);
  const rejected = expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
  await delay(20); controller.abort(); await rejected;
  release(); await first; await delay(30);
  expect(calls).toBe(1); expect(host.elements).toHaveLength(1);
});
