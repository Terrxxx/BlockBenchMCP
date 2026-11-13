import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, VERSION, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { pngFixture } from '../helpers/png.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('shared atlas and Box UV tools', () => {
  let host:FakeHost, adapter:BlockbenchAdapter, project:string, root:string;
  async function run<K extends Command>(command:K, params:unknown, deadline=Date.now()+1000):Promise<ToolOutput<K>> {
    return await adapter.execute(requestSchema.parse({version:VERSION,type:'request',request_id:randomUUID(),deadline_ms:deadline,command,params})) as ToolOutput<K>;
  }
  const cube={name:'body',from:[0,0,0],to:[4,8,4]};
  beforeEach(async()=>{
    root=tempWorkspace(); fs.writeFileSync(path.join(root,'atlas.png'),pngFixture());
    host=new FakeHost(); adapter=new BlockbenchAdapter(host,new Workspace(root,fs));
    project=(await run('create_project',{name:'textures',model_identifier:'textures'})).project.id; host.calls=[];
  });
  it('decodes before the Undo transaction and imports exactly one internal atlas',async()=>{
    const result=await run('import_texture',{project_id:project,path:'atlas.png'});
    expect(result.texture).toMatchObject({width:64,height:64,internal:true,name:'atlas.png'});
    expect(host.calls).toEqual(['Texture.decode','initEdit','Texture.add(false)','Canvas.updateAll','finishEdit']);
    expect((await run('get_project_state',{})).project?.texture_count).toBe(1);
    expect((await run('get_project_state',{})).textures).toEqual([result.texture]);
    await expect(run('import_texture',{project_id:project,path:'atlas.png'})).rejects.toMatchObject({code:'TEXTURE_LIMIT'});
  });
  it('rejects invalid dimensions, invalid bytes and escaped paths before decoding or editing',async()=>{
    fs.writeFileSync(path.join(root,'small.png'),pngFixture(16,16)); fs.writeFileSync(path.join(root,'bad.png'),'bad');
    await expect(run('import_texture',{project_id:project,path:'small.png'})).rejects.toMatchObject({code:'TEXTURE_SIZE_MISMATCH'});
    await expect(run('import_texture',{project_id:project,path:'bad.png'})).rejects.toMatchObject({code:'INVALID_TEXTURE'});
    await expect(run('import_texture',{project_id:project,path:'../atlas.png'})).rejects.toMatchObject({code:'PATH_FORBIDDEN'});
    expect(host.calls).toEqual([]);
  });
  it('rolls back a partial texture addition and restores saved state',async()=>{
    host.project!.saved=true; host.failAddTexture=true;
    await expect(run('import_texture',{project_id:project,path:'atlas.png'})).rejects.toThrow('rolled back');
    expect(host.atlases).toEqual([]); expect(host.project!.saved).toBe(true); expect(host.editing).toBe(false);
    expect(host.calls).toContain('Texture.dispose');
  });
  it.each(['project','editing','dimensions','atlas','expired'] as const)('rejects %s changes while decoding without starting an edit',async change=>{
    let release!:()=>void; host.decodeGate=new Promise<void>(resolve=>{release=resolve;});
    const pending=run('import_texture',{project_id:project,path:'atlas.png'},change==='expired'?Date.now()+15:Date.now()+1000);
    if(change==='project') host.project!.uuid=randomUUID();
    if(change==='editing') host.editing=true;
    if(change==='dimensions') host.project!.texture_width=32;
    if(change==='atlas') host.atlases.push({uuid:randomUUID(),name:'manual',width:64,height:64,internal:true});
    if(change==='expired') await new Promise(resolve=>setTimeout(resolve,25));
    release(); await expect(pending).rejects.toThrow();
    expect(host.calls).not.toContain('initEdit'); expect(host.calls).toContain('Texture.dispose');
  });
  it('assigns enabled faces, sets Box UV, preserves omitted mirror flags and exposes state',async()=>{
    const ids=(await run('create_cubes',{project_id:project,cubes:[cube,cube]})).cube_ids;
    const texture=(await run('import_texture',{project_id:project,path:'atlas.png'})).texture.id;
    host.elements[0]!.faces.north!.texture=null;
    await run('assign_texture',{project_id:project,texture_id:texture,cube_ids:ids});
    expect(host.elements[0]!.faces.north!.texture).toBeNull();
    await run('set_cube_uv',{project_id:project,cubes:ids.map((id,index)=>({cube_id:id,uv_offset:[16*index,16],mirror_uv:true}))});
    await run('set_cube_uv',{project_id:project,cubes:[{cube_id:ids[0],uv_offset:[0,0]}]});
    const state=await run('get_project_state',{});
    expect(state.cubes.map(c=>({uv:c.uv_offset,mirror:c.mirror_uv,ids:c.texture_ids}))).toEqual([
      {uv:[0,0],mirror:true,ids:[texture]},{uv:[16,16],mirror:true,ids:[texture]},
    ]);
  });
  it('preflights all UV rectangles and IDs; no partial assignment or UV edits',async()=>{
    const ids=(await run('create_cubes',{project_id:project,cubes:[cube,cube]})).cube_ids;
    const texture=(await run('import_texture',{project_id:project,path:'atlas.png'})).texture.id;
    host.calls=[];
    await expect(run('set_cube_uv',{project_id:project,cubes:[{cube_id:ids[0],uv_offset:[0,0]},{cube_id:ids[1],uv_offset:[63,0]}]})).rejects.toMatchObject({code:'UV_OUT_OF_BOUNDS'});
    await expect(run('assign_texture',{project_id:project,texture_id:texture,cube_ids:[ids[0],randomUUID()]})).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(host.calls).toEqual([]);
  });
  it('rolls back face assignments after a partially failed batch',async()=>{
    const ids=(await run('create_cubes',{project_id:project,cubes:[cube,cube]})).cube_ids;
    const texture=(await run('import_texture',{project_id:project,path:'atlas.png'})).texture.id;
    const before=(await run('get_project_state',{})).cubes; host.failApplyTexture=true;
    await expect(run('assign_texture',{project_id:project,texture_id:texture,cube_ids:ids})).rejects.toThrow('rolled back');
    expect((await run('get_project_state',{})).cubes).toEqual(before);
  });
});
