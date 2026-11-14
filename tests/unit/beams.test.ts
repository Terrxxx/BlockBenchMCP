import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beamGeometry } from '../../src/shared/beam-geometry.js';
import { beamInputs } from '../../src/shared/schemas/beams.js';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, VERSION, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import type { Vector3 } from '../../src/shared/schemas/common.js';
import { FakeHost } from '../helpers/fake-host.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('beam endpoint solver against independent ZYX matrix rotations',()=>{
  const directions:Vector3[]=[[0,20,0],[0,-20,0],[20,0,0],[-20,0,0],[0,0,20],[0,0,-20],[9,-49,13],[-9,-49,-13],[1,1,1],[-20,4,7],[.00000001,.00000001,20]];
  it.each(directions)('aligns direction %j',(x,y,z)=>{
    const start:Vector3=[31,-27,15],end:Vector3=[31+x,-27+y,15+z];
    const host=new FakeHost();const cube=host.makeCube({name:'test',...beamGeometry(start,end,.75),uv_offset:[0,0],mirror_uv:false});
    const endpoints=host.beamEndpoints(cube);
    for(const [i,want] of [start,end].entries())expect(Math.hypot(...endpoints[i]!.map((v,j)=>v-want[j]!))).toBeLessThan(1e-9);
  });
  it('covers 500 seeded directions and translations including mirrored/reversed endpoints',()=>{
    let seed=713;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const host=new FakeHost();
    for(let i=0;i<500;i++){
      const start=[rnd()*100-50,rnd()*100-50,rnd()*100-50] as Vector3;
      const end=[rnd()*100-50,rnd()*100-50,rnd()*100-50] as Vector3;
      const cube=host.makeCube({name:'test',...beamGeometry(start,end,1,2),uv_offset:[0,0],mirror_uv:false});
      host.beamEndpoints(cube).forEach((got,j)=>expect(Math.hypot(...got.map((v,k)=>v-[start,end][j]![k]!))).toBeLessThan(1e-9));
    }
  });
  it('reproduces the old XYZ bug on an actual tent guy rope',()=>{
    const start:Vector3=[49,50,65],end:Vector3=[58,1,78];
    const host=new FakeHost(),cube=host.makeCube({name:'bad',...beamGeometry(start,end,.75),uv_offset:[0,0],mirror_uv:false});
    cube.rotation=[Math.atan2(13,-49)*180/Math.PI,0,-Math.asin(9/Math.hypot(9,-49,13))*180/Math.PI];
    expect(Math.hypot(...host.beamEndpoints(cube)[1].map((v,i)=>v-end[i]!))).toBeGreaterThan(8);
  });
  it('rejects zero/oversized lengths, thickness and generated out-of-range coordinates',()=>{
    expect(()=>beamGeometry([0,0,0],[0,0,0],1)).toThrow();
    expect(()=>beamGeometry([0,0,0],[0,4097,0],1)).toThrow();
    expect(()=>beamGeometry([0,0,0],[1,1,1],0)).toThrow();
    expect(()=>beamGeometry([32768,0,0],[32768,5,0],1)).toThrow();
  });
});

describe('beam tools preflight, identity and Undo recovery',()=>{
  let host:FakeHost,adapter:BlockbenchAdapter,id:string,parent:string;
  function run<K extends Command>(command:K,params:unknown):ToolOutput<K>{return adapter.execute(requestSchema.parse({version:VERSION,type:'request',request_id:randomUUID(),deadline_ms:Date.now()+5000,command,params})) as ToolOutput<K>;}
  beforeEach(()=>{
    host=new FakeHost();adapter=new BlockbenchAdapter(host,new Workspace(tempWorkspace(),fs));
    id=run('create_project',{name:'beam',model_identifier:'beam'}).project.id;
    parent=run('create_bones',{project_id:id,bones:[{key:'frame',name:'frame',origin:[2,4,8],rotation:[20,30,40]}]}).bones[0]!.id;
    host.calls=[];
  });
  const spec={name:'rod',start:[0,0,0],end:[9,-20,13],thickness:.75,uv_offset:[4,4]};
  const create=()=>run('create_beams',{project_id:id,parent_id:parent,beams:[spec]});
  it('creates a verified rod under an explicit rotated parent in pre-parent coordinates',()=>{
    const result=create();expect(result.beams[0]!.endpoint_error).toBeLessThan(1e-9);
    expect(host.elements[0]!.parent).toEqual(host.bones[0]);
    expect(host.calls.filter(v=>v==='initEdit')).toHaveLength(1);expect(host.calls.filter(v=>v==='finishEdit')).toHaveLength(1);
  });
  it('aligns in place while preserving IDs, parent, face textures, UV and name',()=>{
    const cubeId=create().beams[0]!.cube_id,cube=host.elements[0]!;
    cube.faces.north!.texture='test_texture';cube.mirror_uv=true;const before=structuredClone(cube);
    const result=run('align_beams',{project_id:id,beams:[{cube_id:cubeId,start:[-5,1,2],end:[5,20,-8]}]});
    expect(result.beams[0]!.cube_id).toBe(cubeId);
    for(const key of ['uuid','parent','faces','uv_offset','mirror_uv','name'] as const)expect(cube[key]).toEqual(before[key]);
    expect(cube.to[0]-cube.from[0]).toBeCloseTo(.75);
  });
  it('preflights the last UV-invalid creation before any Undo or cube creation',()=>{
    expect(()=>run('create_beams',{project_id:id,parent_id:parent,beams:[spec,{...spec,uv_offset:[63,63]}]})).toThrow('Box UV');
    expect(host.elements).toHaveLength(0);expect(host.calls).not.toContain('initEdit');
  });
  it('preflights all alignment IDs and UVs before changing any cube',()=>{
    const cubeId=create().beams[0]!.cube_id,before=structuredClone(host.elements);host.calls=[];
    expect(()=>run('align_beams',{project_id:id,beams:[{cube_id:cubeId,start:[1,1,1],end:[4,4,4]},{cube_id:randomUUID(),start:[0,0,0],end:[1,1,1]}]})).toThrow('does not exist');
    expect(()=>run('align_beams',{project_id:id,beams:[{cube_id:cubeId,start:[0,0,0],end:[0,100,0]}]})).toThrow('Box UV');
    expect(host.elements).toEqual(before);expect(host.calls).not.toContain('initEdit');
  });
  it('rejects duplicate IDs, unknown fields, nonfinite endpoints and empty batches',()=>{
    const b={cube_id:randomUUID(),start:[0,0,0],end:[1,1,1]};
    expect(beamInputs.align_beams.safeParse({project_id:id,beams:[b,b]}).success).toBe(false);
    expect(beamInputs.align_beams.safeParse({project_id:id,beams:[{...b,eval:'no'}]}).success).toBe(false);
    expect(beamInputs.align_beams.safeParse({project_id:id,beams:[{...b,end:[Infinity,0,0]}]}).success).toBe(false);
    expect(beamInputs.create_beams.safeParse({project_id:id,parent_id:parent,beams:[]}).success).toBe(false);
  });
  it('rolls back partial updates and preserves saved state',()=>{
    const cubeId=create().beams[0]!.cube_id,before=structuredClone(host.elements);host.project!.saved=true;host.failUpdate=true;
    expect(()=>run('align_beams',{project_id:id,beams:[{cube_id:cubeId,start:[0,0,0],end:[4,4,4]}]})).toThrow('rolled back');
    expect(host.elements).toEqual(before);expect(host.project!.saved).toBe(true);
  });
  it('rolls back native endpoint verification failure',()=>{
    host.beamEndpoints=()=>[[0,0,0],[1,1,1]];expect(create).toThrow('rolled back');expect(host.elements).toHaveLength(0);
  });
  it('rejects unsupported rotation orders and ownership/busy changes',()=>{
    host.eulerOrder=()=>'XYZ';expect(create).toThrow('ZYX');host.eulerOrder=()=>'ZYX';
    host.editing=true;expect(create).toThrow('edit');host.editing=false;
    const foreign=new BlockbenchAdapter(host,new Workspace(tempWorkspace(),fs));
    expect(()=>foreign.execute(requestSchema.parse({version:VERSION,type:'request',request_id:randomUUID(),deadline_ms:Date.now()+1000,command:'create_beams',params:{project_id:id,parent_id:parent,beams:[spec]}}))).toThrow('created');
  });
});
