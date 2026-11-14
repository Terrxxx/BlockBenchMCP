import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { outputSchemas, type Command } from '../src/shared/protocol.js';
import { Workspace } from '../src/shared/workspace.js';

const { values } = parseArgs({ options: { workspace: { type: 'string' } } });
if (!values.workspace) throw new Error('Provide --workspace <absolute path>');
const workspace = new Workspace(values.workspace, fs);
const clients: Client[] = [];
const evidence: unknown[] = [];
const relative = `.tmp/multi-session-${Date.now()}`;
fs.mkdirSync(workspace.resolve(relative, true), { recursive: true });
async function connect() {
  const client = new Client({ name: 'multi-session-smoke', version: '0.7.1' }); clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/server/index.js'), '--workspace', workspace.root], stderr: 'inherit' }));
  assert.equal((await client.listTools()).tools.length, 29); return client;
}
async function call(c: Client, name: Command, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args }); evidence.push({ name, result: r.structuredContent });
  if (r.isError) throw new Error(JSON.stringify(r.structuredContent)); return r.structuredContent;
}
try {
  const a = await connect(), b = await connect();
  // Only read-only probes may be retried while the desktop plugin reconnects.
  for (let i = 0; ; i++) {
    const r = await a.callTool({ name: 'list_projects', arguments: {} });
    if (!r.isError) break;
    if (i === 60) throw new Error('Desktop plugin did not reconnect.');
    await new Promise(r => setTimeout(r, 1000));
  }
  const pa = outputSchemas.create_project.parse(await call(a, 'create_project', { name: 'multi_chat_A', model_identifier: 'multi_chat_a' })).project.id;
  const pb = outputSchemas.create_project.parse(await call(b, 'create_project', { name: 'multi_chat_B', model_identifier: 'multi_chat_b' })).project.id;
  await Promise.all([
    call(a, 'create_cubes', { project_id: pa, cubes: [{ name: 'only_A', from: [0, 0, 0], to: [2, 2, 2] }] }),
    call(b, 'create_cubes', { project_id: pb, cubes: [{ name: 'only_B', from: [0, 0, 0], to: [3, 3, 3] }] }),
  ]);
  for (const [c, id, name] of [[a, pa, 'only_A'], [b, pb, 'only_B']] as const) {
    const state = outputSchemas.get_project_state.parse(await call(c, 'get_project_state', {}));
    assert.equal(state.project!.id, id); assert.deepEqual(state.cubes.map(c => c.name), [name]);
    await call(c, 'save_project', { project_id: id, path: `${relative}/${name}.bbmodel` });
  }
  await a.close();
  for (let i = 0; ; i++) {
    const r = await b.callTool({ name: 'get_project_state', arguments: {} });
    if (!r.isError) { assert.equal(outputSchemas.get_project_state.parse(r.structuredContent).project!.id, pb); break; }
    if (i === 60) throw new Error('Surviving client did not recover.');
    await new Promise(r => setTimeout(r, 500));
  }
  const c = await connect();
  await call(c, 'select_project', { project_id: pa });
  assert.equal(outputSchemas.get_project_state.parse(await call(c, 'get_project_state', {})).project!.id, pa);
  assert.equal(outputSchemas.get_project_state.parse(await call(b, 'get_project_state', {})).project!.id, pb);
  fs.writeFileSync(workspace.resolve(`${relative}/evidence.json`, true), JSON.stringify({ passed: true, calls: evidence }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence: `${relative}/evidence.json`, projects: [pa, pb] }));
} finally { await Promise.all(clients.map(c => c.close())); }
