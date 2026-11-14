import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('Blockbench command adapter', () => {
  let host: FakeHost;
  let workspace: Workspace;
  let adapter: BlockbenchAdapter;
  function run<K extends Command>(command: K, params: unknown): ToolOutput<K> {
    return adapter.execute(requestSchema.parse({ version: 4, type: 'request', request_id: randomUUID(), deadline_ms: Date.now() + 1000, command, params })) as ToolOutput<K>;
  }
  function create(): string { return run('create_project', { name: 'test', model_identifier: 'test' }).project.id; }
  const cube = { name: 'body', from: [0, 0, 0], to: [8, 12, 4] };
  beforeEach(() => { host = new FakeHost(); workspace = new Workspace(tempWorkspace(), fs); adapter = new BlockbenchAdapter(host, workspace); });

  it('creates Bedrock projects and reports an empty or paginated active state', () => {
    expect(run('get_project_state', {}).project).toBeNull();
    const id = create();
    expect(host.project).toMatchObject({ uuid: id, format: { id: 'bedrock' }, texture_width: 64, saved: false });
    run('create_cubes', { project_id: id, cubes: [cube, { ...cube, name: 'head' }] });
    const page = run('get_project_state', { limit: 1 });
    expect(page.project).toMatchObject({ cube_count: 2, group_count: 1, managed: true });
    expect(page.next_offset).toBe(1); expect(page.cubes).toHaveLength(1);
  });
  it('uses exactly one undo transaction and reuses the root bone', () => {
    const id = create(); host.calls = [];
    const first = run('create_cubes', { project_id: id, cubes: [cube, cube] });
    expect(host.calls).toEqual(['initEdit', 'Group.init', 'Cube', 'Cube.init', 'Cube', 'Cube.init', 'Canvas.updateAll', 'finishEdit']);
    const second = run('create_cubes', { project_id: id, cubes: [cube] });
    expect(second.root_group_id).toBe(first.root_group_id);
    expect(host.bones).toHaveLength(1);
  });
  it('rolls back the whole batch, root and saved flag after partial initialization', () => {
    const id = create(); host.project!.saved = true; host.failAttachAt = 2;
    expect(() => run('create_cubes', { project_id: id, cubes: [cube, cube, cube] })).toThrow('rolled back');
    expect(host.elements).toHaveLength(0); expect(host.bones).toHaveLength(0);
    expect(host.project!.saved).toBe(true); expect(host.editing).toBe(false);
    host.failAttachAt = -1;
    expect(run('create_cubes', { project_id: id, cubes: [cube] }).count).toBe(1);
  });
  it('rejects invalid batches before beginning an Undo edit', () => {
    const id = create(); host.calls = [];
    expect(() => run('create_cubes', { project_id: id, cubes: [cube, { ...cube, from: [10, 0, 0] }] })).toThrow();
    expect(host.calls).toEqual([]);
  });
  it('protects existing tabs, changed active project, format and open edit', () => {
    const id = create();
    expect(() => run('create_cubes', { project_id: randomUUID(), cubes: [cube] })).toThrow('active project changed');
    host.editing = true;
    expect(() => run('create_cubes', { project_id: id, cubes: [cube] })).toThrow('Finish');
    host.editing = false; host.project!.format.id = 'free';
    expect(() => run('create_cubes', { project_id: id, cubes: [cube] })).toThrow('Bedrock');
    host.project!.format.id = 'bedrock';
    adapter = new BlockbenchAdapter(host, workspace);
    expect(() => run('save_project', { project_id: id, path: 'test.bbmodel' })).toThrow('Only projects created');
  });
  it('saves exclusively through the official codec and rejects an unrequested overwrite', () => {
    const id = create(); host.calls = [];
    const saved = run('save_project', { project_id: id, path: 'test.bbmodel' });
    expect(saved.bytes).toBe(fs.statSync(path.join(workspace.root, 'test.bbmodel')).size);
    expect(host.calls).toEqual(['Codecs.project.compile', 'Codecs.project.write']);
    expect(host.project!.save_path).toBe(path.join(workspace.root, 'test.bbmodel'));
    expect(() => run('save_project', { project_id: id, path: 'test.bbmodel' })).toThrow('Target exists');
    expect(run('save_project', { project_id: id, path: 'test.bbmodel', overwrite: true }).saved).toBe(true);
  });
  it('restores save metadata on failure without claiming that the disk is unchanged', () => {
    const id = create(); const previous = { ...host.project }; host.failWrite = true;
    expect(() => run('save_project', { project_id: id, path: 'different.bbmodel' })).toThrow('metadata was restored');
    expect(host.project).toEqual(previous);
  });
  it('rejects escaped save paths and external resources before compilation', () => {
    const id = create(); host.calls = [];
    expect(() => run('save_project', { project_id: id, path: '../escape.bbmodel' })).toThrow();
    host.resources = [path.join(tempWorkspace(), 'texture.png')];
    expect(() => run('save_project', { project_id: id, path: 'test.bbmodel' })).toThrow('outside');
    expect(host.calls).toEqual([]);
  });
  it('fails explicitly on unsupported hosts', () => {
    host.version = '4.12.0'; expect(() => create()).toThrow('5.2.2');
    host.version = '5.2.2'; host.desktop = false; expect(() => create()).toThrow('desktop');
  });
});
