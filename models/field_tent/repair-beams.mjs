import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inputSchemas,outputSchemas,commandNames } from '../../src/shared/protocol.ts';
import { beamGeometry } from '../../src/shared/beam-geometry.ts';
import { refinedShell } from './refined-shell.mjs';
const root=process.cwd(),source='models/field_tent/refined-final',dir='models/field_tent/aligned';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const recipe=read(`${source}/recipe.json`),model=read(`${source}/ranger_field_tent.bbmodel`),previous=read(`${source}/result.json`);
const targets=[],counts=new Map();
refinedShell({box(){},slopePanel(){},beam(group,name,a,b,thickness){
 const key=`${group}/${name}`,index=counts.get(key)??0;counts.set(key,index+1);
 const cube=recipe.groups[group].filter(c=>c.name.replace(/_\d+$/,'')===name)[index];assert.ok(cube,key);
 targets.push({group,name:cube.name,start:[-a[0],a[1],a[2]],end:[-b[0],b[1],b[2]],thickness});
}});
for(const b of targets)beamGeometry(b.start,b.end,b.thickness);
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(`${dir}/targets.json`,JSON.stringify(targets,null,2),{flag:'wx'});
fs.copyFileSync(`${source}/field_tent_atlas.png`,`${dir}/field_tent_atlas.png`,fs.constants.COPYFILE_EXCL);
const client=new Client({name:'beam-repair-live',version:'0.6.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server/index.js'),'--workspace',root],stderr:'inherit'});
const calls=[];
async function call(name,args){
 const reply=await client.callTool({name,arguments:inputSchemas[name].parse(args)});
 calls.push({name,arguments:args,result:reply.structuredContent,isError:reply.isError??false});
 fs.writeFileSync(`${dir}/session.json`,JSON.stringify({calls},null,2));
 if(reply.isError)throw new Error(`${name}: ${JSON.stringify(reply.structuredContent)}`);
 return outputSchemas[name].parse(reply.structuredContent);
}
async function snapshot(){const cubes=[];let first;for(let offset=0;;){const s=await call('get_project_state',{offset,limit:200});first??=s;cubes.push(...s.cubes);if(s.next_offset===null)break;offset=s.next_offset;}return {...first,cubes};}
try{
 await client.connect(transport);assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),[...commandNames].sort());
 for(let i=0;;i++){const s=await client.callTool({name:'get_project_state',arguments:{limit:1}});if(!s.isError)break;if(s.structuredContent?.error?.code!=='NOT_CONNECTED'||i>120)throw new Error(JSON.stringify(s.structuredContent));await delay(1000);}
 // Exercise actual native matrices with rotated/nonzero parent pivots first.
 const probe=(await call('create_project',{name:'beam_endpoint_probe',model_identifier:'beam_endpoint_probe',texture_width:2048,texture_height:2048})).project.id;
 const probeParent=(await call('create_bones',{project_id:probe,bones:[{key:'rotated_parent',name:'rotated_parent',origin:[7,11,-9],rotation:[20,30,40]}]})).bones[0].id;
 const directions=[[0,20,0],[0,-20,0],[20,0,0],[-20,0,0],[0,0,20],[0,0,-20],[9,-49,13],[-9,-49,-13],[1,1,1]];
 const probeCreated=await call('create_beams',{project_id:probe,parent_id:probeParent,beams:directions.map((d,i)=>({name:`axis_probe_${i}`,start:[3,5,7],end:d.map((v,j)=>v+[3,5,7][j]),thickness:.75,uv_offset:[4,4]}))});
 const probeAligned=await call('align_beams',{project_id:probe,beams:probeCreated.beams.map((b,i)=>({cube_id:b.cube_id,start:directions[i],end:[2,4,6]}))});
 assert.deepEqual(probeAligned.beams.map(b=>b.cube_id),probeCreated.beams.map(b=>b.cube_id));
 console.log('Native create/align probes passed, including downward rods and rotated parent.');

 const project=(await call('create_project',{name:'ranger_field_tent_aligned',model_identifier:'ranger_field_tent_aligned',texture_width:2048,texture_height:2048})).project.id;
 const parents=new Map();function visit(items,parent=null){for(const item of items){if(typeof item==='object'){parents.set(item.uuid,parent);visit(item.children??[],item.uuid);}}}visit(model.outliner);
 const byOldId=new Map(model.groups.map(g=>[g.uuid,g]));
 const specs=model.groups.map(g=>({key:g.name,name:g.name,origin:g.origin,rotation:g.rotation,...(parents.get(g.uuid)?{parent_key:byOldId.get(parents.get(g.uuid)).name}:{})}));
 const boneList=(await call('create_bones',{project_id:project,bones:specs})).bones,bones=Object.fromEntries(boneList.map(b=>[b.key,b.id]));
 const all=[],names=new Map();
 for(const [group,cubes] of Object.entries(recipe.groups))for(let i=0;i<cubes.length;i+=128){
  const batch=cubes.slice(i,i+128),made=await call('create_cubes',{project_id:project,parent_id:bones[group],cubes:batch});
  made.cube_ids.forEach((id,j)=>names.set(batch[j].name,id));all.push(...made.cube_ids);
 }
 const texture=(await call('import_texture',{project_id:project,path:`${dir}/field_tent_atlas.png`,name:'field_tent_atlas'})).texture.id;
 for(let i=0;i<all.length;i+=128)await call('assign_texture',{project_id:project,texture_id:texture,cube_ids:all.slice(i,i+128)});
 const animation=(await call('create_animation',{project_id:project,name:'animation.field_tent.cutaway',length:1,loop:'hold'})).animation.id;
 await call('set_keyframes',{project_id:project,animation_id:animation,keyframes:[{bone_id:bones.outer_shell,channel:'scale',time:0,value:[1,1,1]},{bone_id:bones.outer_shell,channel:'scale',time:1,value:[.001,.001,.001]}]});
 const before=await snapshot();
 const views=previous.views.filter(([name])=>['exterior','side','front','entrance_detail','interior'].includes(name));
 for(const [name,camera]of views)await call('render_project',{project_id:project,path:`${dir}/before_${name}.png`,width:1200,height:900,camera,background:'#252d2c'});
 const aligned=await call('align_beams',{project_id:project,beams:targets.map(t=>({cube_id:names.get(t.name),start:t.start,end:t.end,thickness:t.thickness}))});
 const after=await snapshot(),targetIds=new Set(aligned.beams.map(b=>b.cube_id));
 assert.equal(after.project.cube_count,1218);assert.deepEqual(after.bones,before.bones);assert.deepEqual(after.textures,before.textures);
 for(let i=0;i<before.cubes.length;i++){
  const a=before.cubes[i],b=after.cubes[i];
  if(!targetIds.has(a.id))assert.deepEqual(b,a);
  else for(const key of ['id','name','parent_id','box_uv','uv_offset','mirror_uv','texture_ids'])assert.deepEqual(b[key],a[key]);
 }
 await call('save_project',{project_id:project,path:`${dir}/ranger_field_tent_aligned.bbmodel`});
 await call('export_bedrock_model',{project_id:project,path:`${dir}/ranger_field_tent_aligned.geo.json`});
 await call('export_bedrock_animations',{project_id:project,path:`${dir}/ranger_field_tent_aligned.animation.json`,animation_ids:[animation]});
 for(const [name,camera]of views)await call('render_project',{project_id:project,path:`${dir}/${name}.png`,width:1200,height:900,camera,background:'#252d2c'});
 const evidence={project,texture,animation,bones,cubes:1218,aligned_count:aligned.count,max_endpoint_error:Math.max(...aligned.beams.map(b=>b.endpoint_error)),aligned:aligned.beams,targets,probeCreated,probeAligned,before,after,passed:true};
 fs.writeFileSync(`${dir}/result.json`,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({passed:true,project,aligned_count:aligned.count,max_endpoint_error:evidence.max_endpoint_error,undo_steps:1}));
}finally{await client.close();}
