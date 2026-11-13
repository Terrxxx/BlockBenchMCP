import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, VERSION, outputSchemas, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('numeric Bedrock animation tools', () => {
  let host: FakeHost; let adapter: BlockbenchAdapter; let project: string; let bone: string; let animation: string;
  function run<K extends Command>(command: K, params: unknown): ToolOutput<K> {
    return outputSchemas[command].parse(adapter.execute(requestSchema.parse({ version: VERSION, type: 'request', request_id: randomUUID(), deadline_ms: Date.now()+1000, command, params }))) as ToolOutput<K>;
  }
  const frame = (time: number) => ({ bone_id: bone, channel: 'rotation', time, value: [0,45,0] });
  const set = (frames: unknown[]) => run('set_keyframes', { project_id:project, animation_id:animation, keyframes:frames });
  const state = () => run('get_animation_state', { project_id:project, animation_id:animation });
  beforeEach(() => {
    host = new FakeHost(); adapter = new BlockbenchAdapter(host, new Workspace(tempWorkspace(),fs));
    project = run('create_project',{name:'anim',model_identifier:'anim'}).project.id;
    bone = run('create_bones',{project_id:project,bones:[{key:'root',name:'root'}]}).bones[0]!.id;
    animation = run('create_animation',{project_id:project,name:'animation.test.wave',length:2}).animation.id;
    host.calls=[];
  });
  it('upserts all channels atomically without snapping; preserves updated UUIDs', () => {
    const result=set([frame(0),{...frame(0.12345),channel:'position',value:[1,2,3]}, {...frame(1),channel:'scale',value:[1,1.2,1]}]);
    expect(result).toMatchObject({created:3,updated:0});
    expect(host.calls.filter(c=>c==='initEdit')).toHaveLength(1);
    expect(host.calls.indexOf('Animation.select')).toBeLessThan(host.calls.indexOf('initEdit'));
    expect(set([{...frame(0),value:[0,-45,0]}])).toMatchObject({created:0,updated:1,keyframe_ids:[result.keyframe_ids[0]]});
    expect(state().keyframes[1]!.time).toBe(0.12345);
  });
  it('captures tracks along with frames so native Redo can reconstruct a removed clip',()=> {
    const result=set([frame(0),frame(1)]);
    expect(host.lastBeforeScope?.animations?.map(a=>a.uuid)).toEqual([animation]);
    expect(host.lastAfterScope?.animations?.map(a=>a.uuid)).toEqual([animation]);
    expect(host.lastBeforeScope?.keyframes).toHaveLength(0);
    expect(host.lastAfterScope?.keyframes?.map(f=>f.uuid)).toEqual(result.keyframe_ids);
    run('delete_keyframes',{project_id:project,animation_id:animation,keyframe_ids:[result.keyframe_ids[0]]});
    expect(host.lastBeforeScope?.animations?.map(a=>a.uuid)).toEqual([animation]);
    expect(host.lastAfterScope?.animations?.map(a=>a.uuid)).toEqual([animation]);
    expect(host.lastBeforeScope?.keyframes).toHaveLength(2);
    expect(host.lastAfterScope?.keyframes).toHaveLength(1);
  });
  it('paginates clips and keyframes; reads reopened unmanaged projects', () => {
    set([frame(0),frame(1),frame(2)]);
    expect(run('get_animation_state',{project_id:project,animation_id:animation,limit:2})).toMatchObject({total:3,next_offset:2});
    expect(run('get_animation_state',{project_id:project,animation_id:animation,offset:2})).toMatchObject({next_offset:null,keyframes:[{time:2}]});
    adapter=new BlockbenchAdapter(host,new Workspace(tempWorkspace(),fs));
    expect(state().total).toBe(3);
    expect(()=>set([frame(1)])).toThrow('connection session');
    expect(()=>run('preview_animation',{project_id:project,animation_id:animation,time:0})).toThrow('connection session');
  });
  it.each([
    () => [frame(0),{...frame(1),bone_id:randomUUID()}],
    () => [frame(0),frame(3)],
    () => [frame(0),frame(0)],
    () => [frame(1),frame(1+1e-8)],
    () => [{...frame(0),value:['query.anim_time',0,0]}],
    () => [{...frame(0),channel:'timeline'}],
  ])('rejects invalid batches before selection or Undo', specs => {
    expect(()=>set(specs())).toThrow(); expect(host.calls).toEqual([]); expect(state().total).toBe(0);
  });
  it('rejects near-existing collisions and oversized batches', () => {
    set([frame(1)]); host.calls=[];
    expect(()=>set([frame(1+1e-8)])).toThrow('coincident');
    expect(()=>set(Array.from({length:257},(_,i)=>frame(i/256)))).toThrow();
    expect(host.calls).toEqual([]);
  });
  it('rolls back partial add and update, restores saved flag, permits recovery', () => {
    const first=set([frame(0)]); host.project!.saved=true; host.failKeyframeAt=2;
    expect(()=>set([{...frame(0),value:[9,9,9]},frame(1),frame(2)])).toThrow('rolled back');
    expect(state()).toMatchObject({total:1,keyframes:[{id:first.keyframe_ids[0],values:[[0,45,0]]}]});
    expect(host.project!.saved).toBe(true); expect(host.editing).toBe(false);
    host.failKeyframeAt=-1; expect(set([frame(1)]).created).toBe(1);
  });
  it('deletes only complete validated batches and rolls back partial failures', () => {
    const {keyframe_ids}=set([frame(0),frame(1),frame(2)]);
    const del=(ids:string[])=>run('delete_keyframes',{project_id:project,animation_id:animation,keyframe_ids:ids});
    expect(()=>del([keyframe_ids[0]!,randomUUID()])).toThrow('not found'); expect(state().total).toBe(3);
    host.failRemoveAt=2; expect(()=>del(keyframe_ids)).toThrow('rolled back'); expect(state().total).toBe(3);
    host.failRemoveAt=-1; expect(del(keyframe_ids).count).toBe(3); expect(state().total).toBe(0);
  });
  it('validates metadata conflicts and length against final frame', () => {
    set([frame(2)]);
    expect(()=>run('update_animation',{project_id:project,animation_id:animation,length:1})).toThrow('final keyframe');
    expect(()=>run('create_animation',{project_id:project,name:'animation.test.wave',length:2})).toThrow('already exists');
    expect(()=>run('update_animation',{project_id:project,animation_id:animation})).toThrow();
    expect(run('update_animation',{project_id:project,animation_id:animation,length:3,loop:'loop',snapping:30}).animation).toMatchObject({length:3,loop:'loop',snapping:30});
  });
  it('previews without adding an Undo transaction or dirtying the project', () => {
    host.project!.saved=true;
    expect(run('preview_animation',{project_id:project,animation_id:animation,time:0.5})).toMatchObject({time:0.5,playing:false});
    expect(host.calls).toEqual(['Animator.preview']); expect(host.project!.saved).toBe(true);
    expect(()=>run('preview_animation',{project_id:project,animation_id:animation,time:3})).toThrow('exceeds');
  });
  it('rejects busy, wrong project, missing clip and expression-bearing clip mutations', () => {
    expect(()=>run('get_animation_state',{project_id:randomUUID()})).toThrow('changed');
    expect(()=>run('get_animation_state',{project_id:project,animation_id:randomUUID()})).toThrow('not found');
    host.editing=true; expect(()=>set([frame(0)])).toThrow('active Blockbench edit'); host.editing=false;
    set([frame(0)]); host.frames[animation]![0]!.data_points[0]!.x='query.anim_time';
    expect(state().animations[0]!.editable).toBe(false);
    expect(()=>set([frame(1)])).toThrow('numeric');
  });
});
