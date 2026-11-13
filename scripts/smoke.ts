import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { outputSchemas } from '../src/shared/protocol.js';
import { errorSchema } from '../src/shared/errors.js';
import { z } from 'zod';

const { values } = parseArgs({ options: {
  workspace: { type: 'string' }, 'inspect-only': { type: 'boolean', default: false },
  'wait-seconds': { type: 'string', default: '120' },
} });
if (!values.workspace) throw new Error('Usage: npm run smoke -- --workspace <directory> [--inspect-only] [--wait-seconds 120]');
const wait = Number(values['wait-seconds']);
if (!Number.isInteger(wait) || wait < 1 || wait > 600) throw new Error('wait-seconds must be 1–600');
const workspace = path.resolve(values.workspace);
const entry = path.resolve('dist/server/index.js');
const client = new Client({ name: 'blockbench-ai-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--workspace', workspace], stderr: 'inherit' });
try {
  await client.connect(transport);
  console.log('MCP connected. Open Blockbench AI MCP: Connect and enter the workspace directory.');
  const end = Date.now() + wait * 1000;
  while (true) {
    const state = await client.callTool({ name: 'get_project_state', arguments: {} });
    if (!state.isError) { console.log(JSON.stringify(state.structuredContent, null, 2)); break; }
    const failure = z.object({ error: errorSchema }).safeParse(state.structuredContent);
    if (!failure.success || failure.data.error.code !== 'NOT_CONNECTED') throw new Error(JSON.stringify(state));
    if (Date.now() >= end) throw new Error('Desktop plugin did not connect in time.');
    await delay(1000);
  }
  if (!values['inspect-only']) {
    const suffix = Date.now().toString(36);
    const created = await client.callTool({ name: 'create_project', arguments: { name: `mcp_smoke_${suffix}`, model_identifier: `mcp_smoke_${suffix}` } });
    if (created.isError) throw new Error(JSON.stringify(created));
    const id = outputSchemas.create_project.parse(created.structuredContent).project.id;
    const cubes = await client.callTool({ name: 'create_cubes', arguments: { project_id: id, cubes: [
      { name: 'body', from: [-4, 0, -2], to: [4, 12, 2] },
      { name: 'head', from: [-4, 12, -4], to: [4, 20, 4], origin: [0, 12, 0] },
    ] } });
    if (cubes.isError) throw new Error(JSON.stringify(cubes));
    const saved = await client.callTool({ name: 'save_project', arguments: { project_id: id, path: `mcp_smoke_${suffix}.bbmodel` } });
    if (saved.isError) throw new Error(JSON.stringify(saved));
    console.log(JSON.stringify(saved.structuredContent, null, 2));
    console.log('Four-tool round trip succeeded. Verify the viewport, Undo/Redo, and reopen the saved bbmodel in Blockbench.');
  }
} finally { await client.close(); }
