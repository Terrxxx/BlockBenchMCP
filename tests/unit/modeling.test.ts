import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { inputSchemas, outputSchemas, requestSchema, VERSION, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { faceEditsSchema, faceNames } from '../../src/shared/schemas/modeling.js';
import { Workspace } from '../../src/shared/workspace.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';

const rivet = { name: 'rivet', from: [0, 0, 0], to: [0.5, 0.5, 0.3] };
const faceUV = (uv = [8, 8, 12, 12]) => faceEditsSchema.parse(Object.fromEntries(faceNames.map(name => [name, { uv }])));
describe('modeling feedback and repair', () => {
  let host: FakeHost, adapter: BlockbenchAdapter, project: string;
  async function run<K extends Command>(command: K, params: unknown, deadline = Date.now() + 2000): Promise<ToolOutput<K>> {
    return outputSchemas[command].parse(await adapter.execute(requestSchema.parse({ version: VERSION, type: 'request', request_id: randomUUID(), command, params, deadline_ms: deadline }))) as ToolOutput<K>;
  }
  const create = () => run('create_cubes', { project_id: project, cubes: [rivet] });
  beforeEach(async () => {
    host = new FakeHost(); adapter = new BlockbenchAdapter(host, new Workspace(tempWorkspace(), fs));
    project = (await run('create_project', { name: 'door', model_identifier: 'door' })).project.id;
  });
  it('lists tabs without switching, pages them, selects explicitly and preserves each project contents', async () => {
    const ids = (await create()).cube_ids;
    const second = (await run('create_project', { name: 'other', model_identifier: 'other' })).project.id;
    const page = await run('list_projects', { limit: 1 });
    expect(page).toMatchObject({ total: 2, next_offset: 1, projects: [{ id: project, active: false, managed: true }] });
    expect(host.project!.uuid).toBe(second);
    await expect(run('get_cube_uv', { project_id: project, cube_ids: ids })).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' });
    expect((await run('select_project', { project_id: project })).project).toMatchObject({ active: true, managed: true });
    expect((await run('get_project_state', {})).cubes[0]!.id).toBe(ids[0]);
    expect((await run('list_projects', { offset: 1 })).projects[0]!.id).toBe(second);
  });
  it.each(['locked-current', 'locked-target', 'editing', 'closed', 'refused'])('rejects tab switch: %s', async reason => {
    const first = host.project!;
    await run('create_project', { name: 'second', model_identifier: 'second' });
    if (reason === 'locked-current') host.project!.locked = true;
    if (reason === 'locked-target') first.locked = true;
    if (reason === 'editing') host.editing = true;
    if (reason === 'closed') host.tabs.splice(0, 1);
    if (reason === 'refused') vi.spyOn(host, 'selectProject').mockReturnValue(false);
    await expect(run('select_project', { project_id: first.uuid })).rejects.toMatchObject({ code: reason === 'closed' ? 'NOT_FOUND' : 'BUSY' });
    expect(host.project!.uuid).not.toBe(first.uuid);
  });
  it('selecting an unmanaged tab allows inspection but never grants mutation authority', async () => {
    const id = (await create()).cube_ids[0]!;
    adapter = new BlockbenchAdapter(host, new Workspace(tempWorkspace(), fs));
    expect((await run('select_project', { project_id: project })).project.managed).toBe(false);
    expect((await run('get_cube_uv', { project_id: project, cube_ids: [id] })).cubes[0]!.cube_id).toBe(id);
    await expect(run('update_cubes', { project_id: project, cubes: [{ cube_id: id, name: 'no' }] })).rejects.toMatchObject({ code: 'PROJECT_NOT_OWNED' });
  });
  it('reproduces the door rivet zero-area UV problem and repairs all six faces without scaling geometry', async () => {
    const made = await create(), id = made.cube_ids[0]!;
    expect(made.uv_warnings).toEqual([{ cube_id: id, code: 'DEGENERATE_BOX_UV', faces: [...faceNames] }]);
    const texture = { uuid: randomUUID(), name: 'atlas', width: 64, height: 64, internal: true };
    host.atlases.push(texture);
    await run('assign_texture', { project_id: project, texture_id: texture.uuid, cube_ids: [id] });
    expect((await run('validate_project', { project_id: project })).issues.filter(i => i.code === 'DEGENERATE_UV')).toHaveLength(6);
    host.calls = [];
    await run('set_face_uv', { project_id: project, cubes: [{ cube_id: id, faces: faceUV() }] });
    expect(host.calls.filter(c => c === 'initEdit')).toHaveLength(1);
    expect((await run('validate_project', { project_id: project })).issue_count).toBe(0);
    const uv = (await run('get_cube_uv', { project_id: project, cube_ids: [id] })).cubes[0]!;
    expect(uv.box_uv).toBe(false); expect(uv.faces.north.texture).toBe(texture.uuid);
    expect(uv.dimensions[0]).toMatchObject({ model_size: [.5, .5], pixel_size: [4, 4] });
    expect(host.elements[0]!.to).toEqual(rivet.to);
    // Assignment remains usable after switching out of Box UV.
    await run('assign_texture', { project_id: project, texture_id: texture.uuid, cube_ids: [id] });
    expect((await run('set_cube_uv', { project_id: project, cubes: [{ cube_id: id, uv_offset: [4, 4] }] })).uv_warnings).toHaveLength(1);
  });
  it('reports bounded diagnostics with a truthful total and ignores disabled faces', async () => {
    const id = (await create()).cube_ids[0]!;
    host.elements[0]!.faces.north!.texture = null;
    const report = await run('validate_project', { project_id: project, max_issues: 1 });
    expect(report).toMatchObject({ checked_cubes: 1, issue_count: 10, truncated: true });
    expect(report.issues).toHaveLength(1);
    await expect(run('validate_project', { project_id: project }, Date.now() - 1)).rejects.toMatchObject({ code: 'TIMEOUT' });
    const wrong = { cube_id: id, faces: faceUV() }; wrong.faces.north.uv = [0, 0, 80, 1];
    await expect(run('set_face_uv', { project_id: project, cubes: [wrong] })).rejects.toMatchObject({ code: 'UV_OUT_OF_BOUNDS' });
  });
  it('accepts mirrored/fractional UV and rotation, rejects degenerate rectangles unless explicitly allowed', async () => {
    const id = (await create()).cube_ids[0]!, faces = faceUV([10.5, 10.25, 2.5, 4.25]);
    faces.north.rotation = 90;
    await run('set_face_uv', { project_id: project, cubes: [{ cube_id: id, faces }] });
    expect((await run('get_cube_uv', { project_id: project, cube_ids: [id] })).cubes[0]!.dimensions[0]!.pixel_size).toEqual([6, 8]);
    const points = [{ cube_id: id, faces: faceUV([1, 1, 1, 1]) }];
    await expect(run('set_face_uv', { project_id: project, cubes: points })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await run('set_face_uv', { project_id: project, cubes: points, allow_degenerate: true });
    expect((await run('validate_project', { project_id: project })).issues.some(i => i.code === 'DEGENERATE_UV')).toBe(true);
  });
  it('preflights the entire batch, not only the first valid cube', async () => {
    const ids = (await run('create_cubes', { project_id: project, cubes: [rivet, rivet] })).cube_ids;
    const snapshot = structuredClone(host.elements); host.calls = [];
    await expect(run('set_face_uv', { project_id: project, cubes: [{ cube_id: ids[0], faces: faceUV() }, { cube_id: ids[1], faces: faceUV([0, 0, 65, 4]) }] })).rejects.toMatchObject({ code: 'UV_OUT_OF_BOUNDS' });
    await expect(run('update_cubes', { project_id: project, cubes: [{ cube_id: ids[0], name: 'changed' }, { cube_id: ids[1], from: [1, 1, 1] }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(host.calls).not.toContain('initEdit'); expect(host.elements).toEqual(snapshot);
  });
  it.each(['set_face_uv', 'update_cubes'] as const)('rolls back %s and saved status after partial native failure', async command => {
    const id = (await create()).cube_ids[0]!, before = await run('get_cube_uv', { project_id: project, cube_ids: [id] });
    const snapshot = structuredClone(host.elements); host.project!.saved = true; host.failUpdate = true;
    const cubes = command === 'set_face_uv' ? [{ cube_id: id, faces: faceUV() }] : [{ cube_id: id, name: 'changed' }];
    await expect(run(command, { project_id: project, cubes })).rejects.toThrow('rolled back');
    expect(host.elements).toEqual(snapshot); expect(host.project!.saved).toBe(true);
    expect(await run('get_cube_uv', { project_id: project, cube_ids: [id] })).toEqual(before);
  });
  it('updates coordinates/pivot in place and preserves face UV, identity, bindings and parent', async () => {
    const id = (await create()).cube_ids[0]!;
    await run('set_face_uv', { project_id: project, cubes: [{ cube_id: id, faces: faceUV() }] });
    const parent = host.elements[0]!.parent, faces = host.cubeFaces(host.elements[0]!);
    await run('update_cubes', { project_id: project, cubes: [{ cube_id: id, from: [-1, 0, 0], origin: [0, 0, 6], rotation: [0, 30, 0] }] });
    expect(host.elements[0]).toMatchObject({ uuid: id, from: [-1, 0, 0], origin: [0, 0, 6], rotation: [0, 30, 0], parent });
    expect(host.cubeFaces(host.elements[0]!)).toEqual(faces);
  });
  it('rejects unknown fields, duplicate IDs, empty edits and incomplete face maps', () => {
    const id = randomUUID();
    for (const cubes of [[{ cube_id: id }], [{ cube_id: id, name: 'x', script: 'eval' }], [{ cube_id: id, name: 'a' }, { cube_id: id, name: 'b' }]]) {
      expect(() => inputSchemas.update_cubes.parse({ project_id: project, cubes })).toThrow();
    }
    expect(() => inputSchemas.set_face_uv.parse({ project_id: project, cubes: [{ cube_id: id, faces: { north: { uv: [0, 0, 4, 4] } } }] })).toThrow();
  });
  it('checks create UV bounds before starting Undo', async () => {
    host.calls = [];
    await expect(run('create_cubes', { project_id: project, cubes: [{ name: 'too large', from: [0, 0, 0], to: [64, 64, 64] }] })).rejects.toMatchObject({ code: 'UV_OUT_OF_BOUNDS' });
    expect(host.calls).not.toContain('initEdit');
  });
  it('collision results exclude same parent by default and report truncation honestly', async () => {
    const ids = (await run('create_cubes', { project_id: project, cubes: [rivet, rivet, rivet] })).cube_ids;
    expect((await run('check_collisions', { project_id: project, cube_ids: ids })).checked_pairs).toBe(0);
    const report = await run('check_collisions', { project_id: project, cube_ids: ids, include_same_bone: true, max_results: 1 });
    expect(report).toMatchObject({ complete: false, checked_pairs: 2, sampled_times: [null] });
    expect(report.collisions).toHaveLength(1);
    expect((await run('check_collisions', { project_id: project, cube_ids: ids, include_same_bone: true })).collisions).toHaveLength(3);
    await expect(run('check_collisions', { project_id: project, cube_ids: ids }, Date.now() - 1)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('validates animation times before native sampling and forwards explicit samples', async () => {
    const ids = (await create()).cube_ids;
    const clip = (await run('create_animation', { project_id: project, name: 'animation.door.open', length: 1 })).animation.id;
    const spy = vi.spyOn(host, 'collisionShapes');
    await expect(run('check_collisions', { project_id: project, cube_ids: ids, animation: { animation_id: clip, times: [2] } })).rejects.toMatchObject({ code: 'KEYFRAME_OUT_OF_BOUNDS' });
    expect(spy).not.toHaveBeenCalled();
    expect((await run('check_collisions', { project_id: project, cube_ids: ids, animation: { animation_id: clip, times: [0, .5, 1] } })).sampled_times).toEqual([0, .5, 1]);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
