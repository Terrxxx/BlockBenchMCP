import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { inputSchemas, requestSchema, VERSION, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('Bedrock bone tools', () => {
  let host: FakeHost;
  let adapter: BlockbenchAdapter;
  let project: string;
  function run<K extends Command>(command: K, params: unknown): ToolOutput<K> {
    return adapter.execute(requestSchema.parse({ version: VERSION, type: 'request', request_id: randomUUID(), deadline_ms: Date.now()+1000, command, params })) as ToolOutput<K>;
  }
  const cube = { name: 'body', from: [0,0,0], to: [2,4,2] };
  function bones() {
    const result = run('create_bones', { project_id: project, bones: [
      { key: 'head', name: 'head', parent_key: 'root', origin: [0,4,0] }, { key: 'root', name: 'root' },
    ] });
    return { root: result.bones.find(bone => bone.key === 'root')!.id, head: result.bones.find(bone => bone.key === 'head')!.id };
  }
  beforeEach(() => {
    host = new FakeHost(); adapter = new BlockbenchAdapter(host, new Workspace(tempWorkspace(), fs));
    project = run('create_project', { name: 'bones', model_identifier: 'bones' }).project.id;
    host.calls = [];
  });

  it('creates unordered hierarchy in one edit, returns input key order and paginates bone state', () => {
    const ids = bones();
    expect(host.bones.map(b => b.name)).toEqual(['root','head']);
    expect(host.bones[1]!.parent).toBe(host.bones[0]);
    expect(host.calls.filter(call => call === 'initEdit')).toHaveLength(1);
    expect(host.calls.filter(call => call === 'finishEdit')).toHaveLength(1);
    expect(run('get_project_state', { bone_offset: 1, limit: 1 })).toMatchObject({
      bones: [{ id: ids.head, parent_id: ids.root, origin: [0,4,0] }], next_bone_offset: null,
    });
    expect(run('get_project_state', { limit: 1 }).next_bone_offset).toBe(1);
  });
  it('creates cubes in explicit bones and reuses the top-level named root for legacy batches', () => {
    const ids = bones();
    const explicit = run('create_cubes', { project_id: project, parent_id: ids.head, cubes: [cube] });
    expect(explicit.root_group_id).toBe(ids.head);
    const legacy = run('create_cubes', { project_id: project, cubes: [cube] });
    expect(legacy.root_group_id).toBe(ids.root); expect(host.bones).toHaveLength(2);
  });
  it.each([
    [{ key: 'a', name: 'a', parent_key: 'b' }, { key: 'b', name: 'b', parent_key: 'a' }],
    [{ key: 'a', name: 'a', parent_key: 'missing' }],
    [{ key: 'a', name: 'same' }, { key: 'b', name: 'same' }],
  ].map(specs => ({ specs })))('rejects invalid complete graphs without beginning an edit', ({ specs }) => {
    expect(() => run('create_bones', { project_id: project, bones: specs })).toThrow();
    expect(host.calls).toEqual([]); expect(host.bones).toHaveLength(0);
  });
  it('rejects duplicate keys, invalid names, conflicting parents and empty patches', () => {
    expect(() => inputSchemas.create_bones.parse({ project_id: project, bones: [{ key:'a',name:'a' },{ key:'a',name:'b' }] })).toThrow();
    expect(() => inputSchemas.create_bones.parse({ project_id: project, bones: [{ key:'a',name:'with space' }] })).toThrow();
    expect(() => inputSchemas.create_bones.parse({ project_id: project, bones: [{ key:'a',name:'a',parent_id:null,parent_key:'b' }] })).toThrow();
    expect(() => inputSchemas.update_bones.parse({ project_id:project,bones:[{ bone_id:randomUUID() }] })).toThrow();
  });
  it('rolls back partially initialized bones and can recover', () => {
    host.project!.saved = true; host.failGroupAt = 2;
    expect(() => bones()).toThrow('rolled back');
    expect(host.bones).toHaveLength(0); expect(host.project!.saved).toBe(true); expect(host.editing).toBe(false);
    host.failGroupAt = -1; expect(bones().head).toBeTruthy();
  });
  it('updates pivots, rotations, names and a valid inverted ancestor relationship', () => {
    const ids = bones();
    run('update_bones', { project_id:project, bones:[
      { bone_id:ids.root,parent_id:ids.head,name:'body',origin:[1,2,3],rotation:[0,15,0] },
      { bone_id:ids.head,parent_id:null },
    ] });
    expect(host.bones[0]).toMatchObject({ name:'body',origin:[1,2,3],rotation:[0,15,0],parent:{uuid:ids.head} });
    expect(host.bones[1]!.parent).toBe('root');
  });
  it('rejects a cycle or duplicate final name before any mutation', () => {
    const ids = bones(); host.calls=[];
    expect(() => run('update_bones', { project_id:project,bones:[{bone_id:ids.root,parent_id:ids.head}] })).toThrow('cycle');
    expect(() => run('update_bones', { project_id:project,bones:[{bone_id:ids.head,name:'root'}] })).toThrow('unique');
    expect(host.calls).toEqual([]);
  });
  it('restores existing bone data and parent relationships when an update fails', () => {
    const ids=bones(); const before=run('get_project_state',{}); host.failUpdate=true; host.project!.saved=true;
    expect(() => run('update_bones',{project_id:project,bones:[{bone_id:ids.head,origin:[1,2,3],parent_id:null}]})).toThrow('rolled back');
    expect(run('get_project_state',{}).bones).toEqual(before.bones); expect(host.project!.saved).toBe(true);
  });
  it('reparents a batch without changing cube coordinates and preflights missing IDs', () => {
    const ids=bones(); const created=run('create_cubes',{project_id:project,cubes:[cube,cube]});
    const before=run('get_project_state',{}).cubes;
    run('reparent_cubes',{project_id:project,cube_ids:created.cube_ids,parent_id:ids.head});
    expect(run('get_project_state',{}).cubes).toEqual(before.map(c => ({...c,parent_id:ids.head})));
    host.calls=[];
    expect(() => run('reparent_cubes',{project_id:project,cube_ids:[created.cube_ids[0],randomUUID()],parent_id:ids.root})).toThrow('does not exist');
    expect(host.calls).toEqual([]);
  });
});
