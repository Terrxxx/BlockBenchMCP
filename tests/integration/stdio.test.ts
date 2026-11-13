import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { WebSocket } from 'ws';
import { build } from 'esbuild';
import { Workspace } from '../../src/shared/workspace.js';
import { createConfig } from '../../src/shared/config.js';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Dispatcher } from '../../src/plugin/dispatcher.js';
import { commandNames, outputSchemas } from '../../src/shared/protocol.js';
import { silentLogger } from '../../src/shared/logger.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';
import { pngFixture } from '../helpers/png.js';

async function freePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Expected IP socket');
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

describe('official SDK client -> real stdio server -> real WS -> adapter', () => {
  it.each(['legacy', 'modern'] as const)('runs all ten tools using %s protocol mode', async mode => {
    const root = tempWorkspace();
    const workspace = new Workspace(root, fs);
    fs.writeFileSync(path.join(root, 'atlas.png'), pngFixture());
    const config = createConfig(workspace, await freePort());
    const entry = path.join(root, 'server.mjs');
    await build({ entryPoints: ['src/server/index.ts'], outfile: entry, bundle: true, packages: 'external', platform: 'node', format: 'esm' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--workspace', root], stderr: 'pipe' });
    let logs = '';
    transport.stderr?.on('data', data => { logs += String(data); });
    const client = new Client({ name: 'blockbench-ai-test', version: '0.1.0' }, {
      versionNegotiation: { mode: mode === 'legacy' ? 'legacy' : { pin: '2026-07-28' } },
    });
    let socket: WebSocket | undefined;
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name).sort()).toEqual([...commandNames].sort());
      const offline = await client.callTool({ name: 'get_project_state', arguments: {} });
      expect(offline.isError).toBe(true);
      const host = new FakeHost();
      const adapter = new BlockbenchAdapter(host, workspace);
      const dispatcher = new Dispatcher(request => adapter.execute(request), silentLogger);
      socket = new WebSocket(`ws://127.0.0.1:${config.port}`);
      const peer = socket;
      await new Promise<void>((resolve, reject) => { peer.once('open', resolve); peer.once('error', reject); });
      const ready = new Promise<void>(resolve => peer.once('message', () => resolve()));
      peer.send(JSON.stringify({ version: 2, type: 'hello', workspace: root, token: config.token, plugin_version: '0.2.0', blockbench_version: '5.2.2' }));
      await ready;
      peer.on('message', data => { void dispatcher.receive(data.toString()).then(response => { if (response) peer.send(JSON.stringify(response)); }); });
      const created = await client.callTool({ name: 'create_project', arguments: { name: 'stdio_test', model_identifier: 'stdio_test' } });
      expect(created.isError).not.toBe(true);
      const id = outputSchemas.create_project.parse(created.structuredContent).project.id;
      const boneResult = await client.callTool({ name: 'create_bones', arguments: { project_id: id, bones: [
        { key: 'head', name: 'head', parent_key: 'root' }, { key: 'root', name: 'root' },
      ] } });
      const bones = outputSchemas.create_bones.parse(boneResult.structuredContent).bones;
      const head = bones.find(bone => bone.key === 'head')!.id;
      const updated = await client.callTool({ name: 'update_bones', arguments: { project_id: id, bones: [{ bone_id: head, origin: [0,12,0], rotation: [0,15,0] }] } });
      expect(outputSchemas.update_bones.parse(updated.structuredContent).count).toBe(1);
      const cubes = await client.callTool({ name: 'create_cubes', arguments: { project_id: id, cubes: [{ name: 'body', from: [-4, 0, -2], to: [4, 12, 2] }] } });
      expect(outputSchemas.create_cubes.parse(cubes.structuredContent).count).toBe(1);
      const cubeIds = outputSchemas.create_cubes.parse(cubes.structuredContent).cube_ids;
      const moved = await client.callTool({ name: 'reparent_cubes', arguments: { project_id: id, cube_ids: cubeIds, parent_id: head } });
      expect(outputSchemas.reparent_cubes.parse(moved.structuredContent).parent_id).toBe(head);
      const imported = await client.callTool({ name: 'import_texture', arguments: { project_id: id, path: 'atlas.png' } });
      const texture = outputSchemas.import_texture.parse(imported.structuredContent).texture;
      const uv = await client.callTool({ name: 'set_cube_uv', arguments: { project_id: id, cubes: [{ cube_id: cubeIds[0], uv_offset: [8,8], mirror_uv: true }] } });
      expect(outputSchemas.set_cube_uv.parse(uv.structuredContent).count).toBe(1);
      const bound = await client.callTool({ name: 'assign_texture', arguments: { project_id: id, cube_ids: cubeIds, texture_id: texture.id } });
      expect(outputSchemas.assign_texture.parse(bound.structuredContent).count).toBe(1);
      const state = await client.callTool({ name: 'get_project_state', arguments: {} });
      expect(outputSchemas.get_project_state.parse(state.structuredContent).project?.cube_count).toBe(1);
      expect(outputSchemas.get_project_state.parse(state.structuredContent)).toMatchObject({
        project: { group_count: 2, texture_count: 1 },
        cubes: [{ parent_id: head, uv_offset: [8,8], mirror_uv: true, texture_ids: [texture.id] }],
        textures: [{ id: texture.id, internal: true }],
      });
      const saved = await client.callTool({ name: 'save_project', arguments: { project_id: id, path: 'stdio.bbmodel' } });
      expect(outputSchemas.save_project.parse(saved.structuredContent).saved).toBe(true);
      const blocked = await client.callTool({ name: 'save_project', arguments: { project_id: id, path: '../escape.bbmodel' } });
      expect(blocked.isError).toBe(true);
      expect(logs).not.toContain(config.token);
      expect(fs.readFileSync(path.join(root, 'stdio.bbmodel'), 'utf8')).toBe('TEST_ONLY_OFFICIAL_CODEC_STUB');
    } finally {
      socket?.terminate();
      await client.close();
    }
  });
});
