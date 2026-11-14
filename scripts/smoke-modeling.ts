import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PLUGIN_VERSION, commandNames, outputSchemas, type Command, type ToolOutput } from '../src/shared/protocol.js';
import { faceNames } from '../src/shared/schemas/modeling.js';
import { Workspace } from '../src/shared/workspace.js';
import { inspectRenderPixels } from './render-smoke-check.js';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, 'wait-seconds': { type: 'string', default: '120' } } });
if (!values.workspace || !path.isAbsolute(values.workspace)) throw new Error('Use --workspace <absolute authorized repository directory>. Stop the same-port Codex MCP first.');
const wait = Number(values['wait-seconds']);
if (!Number.isInteger(wait) || wait < 1 || wait > 600) throw new Error('wait-seconds must be 1–600');
const workspace = new Workspace(values.workspace, fs);
workspace.pngTarget('examples/atlas-64.png');
const relative = `.tmp/modeling-smoke-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const dir = workspace.resolve(relative, true); fs.mkdirSync(dir, { recursive: true });
const client = new Client({ name: 'blockbench-modeling-smoke', version: PLUGIN_VERSION });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/server/index.js'), '--workspace', workspace.root], stderr: 'inherit' });
const evidence: unknown[] = [];
async function call<K extends Command>(name: K, args: Record<string, unknown>): Promise<ToolOutput<K>> {
  const result = await client.callTool({ name, arguments: args });
  evidence.push({ name, arguments: args, result: result.structuredContent, isError: result.isError ?? false });
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
  return outputSchemas[name].parse(result.structuredContent) as ToolOutput<K>;
}
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...commandNames].sort());
  console.log(`${commandNames.length} tools registered; waiting for v${PLUGIN_VERSION} desktop plugin.`);
  const end = Date.now() + wait * 1000;
  while (true) {
    const r = await client.callTool({ name: 'get_project_state', arguments: {} });
    if (!r.isError) break;
    if (Date.now() >= end) throw new Error('Plugin connection timed out; reload v0.7.0 and Connect.');
    await delay(1000);
  }
  const existing = await call('list_projects', {});
  const original = existing.projects.find(p => p.active)?.id;
  const name = `door_api_${Date.now().toString(36)}`;
  const id = (await call('create_project', { name, model_identifier: name })).project.id;
  const groups = (await call('create_bones', { project_id: id, bones: [
    { key: 'frame', name: 'frame', origin: [-16, 0, 8] }, { key: 'door', name: 'door', origin: [-15, 0, 8] },
  ] })).bones;
  const frame = groups.find(b => b.key === 'frame')!.id, door = groups.find(b => b.key === 'door')!.id;
  const fixed = (await call('create_cubes', { project_id: id, parent_id: frame, cubes: [{ name: 'frame_left', from: [-16, 0, 6.5], to: [-15, 32, 10] }] })).cube_ids[0]!;
  const leaf = (await call('create_cubes', { project_id: id, parent_id: door, cubes: [{ name: 'leaf_left', from: [-14.75, 1, 7], to: [-13.75, 31, 9] }] })).cube_ids[0]!;
  const made = await call('create_cubes', { project_id: id, parent_id: door, cubes: [{ name: 'rivet', from: [-13, 4, 6], to: [-12.5, 4.5, 6.3] }] });
  const rivet = made.cube_ids[0]!, ids = [fixed, leaf, rivet];
  assert.equal(made.uv_warnings[0]!.faces.length, 6);
  const atlas = (await call('import_texture', { project_id: id, path: 'examples/atlas-64.png' })).texture.id;
  await call('assign_texture', { project_id: id, texture_id: atlas, cube_ids: ids });
  const before = await call('validate_project', { project_id: id });
  assert.equal(before.issues.filter(i => i.cube_id === rivet && i.code === 'DEGENERATE_UV').length, 6);
  await call('set_face_uv', { project_id: id, cubes: [{ cube_id: rivet, faces: Object.fromEntries(faceNames.map(face => [face, { uv: [8, 8, 12, 12], rotation: face === 'north' ? 90 : 0 }])) }] });
  const repaired = await call('get_cube_uv', { project_id: id, cube_ids: [rivet] });
  assert.equal(repaired.cubes[0]!.box_uv, false);
  assert.deepEqual(repaired.cubes[0]!.faces.north.uv, [8, 8, 12, 12]);
  assert.equal(repaired.cubes[0]!.faces.north.rotation, 90);
  assert.equal(repaired.cubes[0]!.faces.north.texture, atlas);
  await call('update_cubes', { project_id: id, cubes: [{ cube_id: rivet, name: 'rivet_repaired', from: [-12, 4, 6], to: [-11.5, 4.5, 6.3] }] });
  assert.equal((await call('validate_project', { project_id: id })).issue_count, 0);
  const animation = (await call('create_animation', { project_id: id, name: 'animation.door_api.open', length: 1 })).animation.id;
  await call('set_keyframes', { project_id: id, animation_id: animation, keyframes: [
    { bone_id: door, channel: 'rotation', time: 0, value: [0, 0, 0] }, { bone_id: door, channel: 'rotation', time: 1, value: [0, 90, 0] },
  ] });
  await call('save_project', { project_id: id, path: `${relative}/door.bbmodel` });
  const baseline = await call('get_project_state', {}), keys = await call('get_animation_state', { project_id: id, animation_id: animation });
  const staticCheck = await call('check_collisions', { project_id: id, cube_ids: [fixed, leaf] });
  assert.deepEqual(staticCheck.collisions, []);
  const animated = await call('check_collisions', { project_id: id, cube_ids: [fixed, leaf], animation: { animation_id: animation, times: [0, .5, 1] } });
  assert.equal(animated.complete, true);
  assert.ok(animated.collisions.some(c => c.time === 1 && Math.abs(c.min_projection_overlap - 1) < 1e-4));
  assert.deepEqual(await call('get_project_state', {}), baseline);
  assert.deepEqual(await call('get_animation_state', { project_id: id, animation_id: animation }), keys);
  const render = async (suffix: string, time: number) => {
    const file = `${relative}/${suffix}.png`;
    await call('render_project', { project_id: id, path: file, width: 256, height: 256, camera: { projection: 'orthographic', position: [28, 28, 48], target: [-14, 16, 8], vertical_size: 40 }, animation: { animation_id: animation, time } });
    const pixels = inspectRenderPixels(fs.readFileSync(workspace.resolve(file)));
    assert.ok(pixels.visible > 50); return pixels;
  };
  const restPixels = await render('closed', 0), openPixels = await render('open', 1);
  assert.notEqual(restPixels.pixel_sha256, openPixels.pixel_sha256);
  await call('export_bedrock_model', { project_id: id, path: `${relative}/door.geo.json` });
  await call('create_project', { name: `${name}_tab`, model_identifier: `${name}_tab` });
  assert.equal((await call('select_project', { project_id: id })).project.active, true);
  assert.deepEqual(await call('get_project_state', {}), baseline);
  assert.deepEqual(await call('get_cube_uv', { project_id: id, cube_ids: [rivet] }), repaired);
  if (original) await call('select_project', { project_id: original });
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify({ passed: true, version: PLUGIN_VERSION, real_host: true, calls: evidence }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, evidence: `${relative}/evidence.json`, project_id: id, remaining_manual: 'Undo/Redo and reopening door.bbmodel' }));
} catch (error) {
  fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ error: String(error), calls: evidence }, null, 2), { flag: 'wx' });
  throw error;
} finally { await client.close(); }
