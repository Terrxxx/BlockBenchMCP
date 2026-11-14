import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID,createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { PLUGIN_VERSION, commandNames, outputSchemas, type Command, type ToolOutput } from '../src/shared/protocol.js';
import { errorSchema } from '../src/shared/errors.js';
import { Workspace } from '../src/shared/workspace.js';
import { inspectRenderPixels } from './render-smoke-check.js';

const {values}=parseArgs({options:{workspace:{type:'string'},'wait-seconds':{type:'string',default:'120'}}});
if(!values.workspace||!path.isAbsolute(values.workspace))throw new Error('Use --workspace <absolute authorized repository directory>. Stop the same-port Codex MCP first.');
const wait=Number(values['wait-seconds']);if(!Number.isInteger(wait)||wait<1||wait>600)throw new Error('wait-seconds must be 1–600');
const workspace=new Workspace(values.workspace,fs);
workspace.pngTarget('examples/atlas-64.png');
const prefix=`models/mcp_render_${Date.now().toString(36)}_${randomUUID().slice(0,8)}`;
workspace.exportTarget(`${prefix}_static.png`,'texture_png',false);
const client=new Client({name:'blockbench-render-smoke',version:PLUGIN_VERSION});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server/index.js'),'--workspace',workspace.root],stderr:'inherit'});
const evidence:unknown[]=[];
async function call<K extends Command>(name:K,args:Record<string,unknown>):Promise<ToolOutput<K>>{
  const result=await client.callTool({name,arguments:args});evidence.push({name,arguments:args,result:result.structuredContent,isError:result.isError??false});
  if(result.isError)throw new Error(JSON.stringify(result.structuredContent));
  return outputSchemas[name].parse(result.structuredContent) as ToolOutput<K>;
}
async function fails(args:Record<string,unknown>,code:string){const r=await client.callTool({name:'render_project',arguments:args});evidence.push({name:'render_project',arguments:args,result:r.structuredContent,isError:r.isError??false});assert.equal(r.isError,true);assert.equal(z.object({error:errorSchema}).parse(r.structuredContent).error.code,code);}
try {
  await client.connect(transport);assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),[...commandNames].sort());
  console.log(`${commandNames.length} tools ready; connect the v${PLUGIN_VERSION} desktop plugin.`);
  const end=Date.now()+wait*1000;
  while(true){const r=await client.callTool({name:'get_project_state',arguments:{}});if(!r.isError)break;const e=z.object({error:errorSchema}).parse(r.structuredContent).error;if(e.code!=='NOT_CONNECTED'||Date.now()>=end)throw new Error(e.message);await delay(1000);}
  const name=path.basename(prefix),id=(await call('create_project',{name,model_identifier:name})).project.id;
  const bones=(await call('create_bones',{project_id:id,bones:[{key:'root',name:'root'},{key:'arm',name:'arm',parent_key:'root',origin:[4,10,0]}]})).bones;
  const root=bones.find(b=>b.key==='root')!.id,arm=bones.find(b=>b.key==='arm')!.id;
  const body=(await call('create_cubes',{project_id:id,parent_id:root,cubes:[{name:'body',from:[-4,0,-2],to:[4,12,2]}]})).cube_ids;
  const limb=(await call('create_cubes',{project_id:id,parent_id:arm,cubes:[{name:'arm',from:[4,2,-2],to:[7,12,2],origin:[4,10,0]}]})).cube_ids;
  const texture=(await call('import_texture',{project_id:id,path:'examples/atlas-64.png'})).texture.id;
  await call('assign_texture',{project_id:id,texture_id:texture,cube_ids:[...body,...limb]});
  const animation=(await call('create_animation',{project_id:id,name:'animation.render.wave',length:1})).animation.id;
  await call('set_keyframes',{project_id:id,animation_id:animation,keyframes:[{bone_id:arm,channel:'rotation',time:0,value:[0,0,0]},{bone_id:arm,channel:'rotation',time:1,value:[0,0,-80]}]});
  await call('save_project',{project_id:id,path:`${prefix}.bbmodel`});
  const baseline=await call('get_project_state',{}),frames=await call('get_animation_state',{project_id:id,animation_id:animation});
  const camera={projection:'perspective',position:[40,28,48],target:[0,8,0],fov:40};
  const base={project_id:id,width:256,height:256,camera};
  const files:({path:string;bytes:number;sha256:string}&ReturnType<typeof inspectRenderPixels>)[]=[];
  const render=async(label:string,options:Record<string,unknown>={})=>{
    const target=`${prefix}_${label}.png`;await call('render_project',{...base,path:target,...options});
    const bytes=fs.readFileSync(workspace.resolve(target)),pixels=inspectRenderPixels(bytes);
    assert.equal(pixels.width,256);assert.equal(pixels.height,256);assert.ok(pixels.visible>100,'Rendered image must contain visible pixels.');
    const item={path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...pixels};files.push(item);return item;
  };
  const rest=await render('static');assert.ok(rest.transparent>100,'Transparent background missing.');
  const start=await render('time0',{animation:{animation_id:animation,time:0}});
  const endFrame=await render('time1',{animation:{animation_id:animation,time:1}});
  assert.equal(start.pixel_sha256,rest.pixel_sha256);assert.notEqual(start.pixel_sha256,endFrame.pixel_sha256,'Animation time must change rendered pixels.');
  const side=await render('side',{camera:{projection:'orthographic',position:[64,8,0],target:[0,8,0],vertical_size:32}});
  assert.notEqual(side.pixel_sha256,rest.pixel_sha256);
  const top=await render('top',{camera:{projection:'orthographic',position:[0,64,0],target:[0,8,0],up:[0,0,-1],vertical_size:32}});
  assert.notEqual(top.pixel_sha256,side.pixel_sha256);
  const solid=await render('solid',{background:'#102030'});assert.equal(solid.transparent,0);assert.deepEqual(solid.corner.slice(0,3),[16,32,48]);
  const repeat=await render('repeat');assert.equal(repeat.pixel_sha256,rest.pixel_sha256,'Temporary pose must be restored.');
  await fails({...base,path:rest.path},'FILE_EXISTS');
  await fails({...base,path:'../escape.png'},'PATH_FORBIDDEN');
  await fails({...base,path:`${prefix}_bad.png`,animation:{animation_id:animation,time:2}},'KEYFRAME_OUT_OF_BOUNDS');
  assert.equal(fs.existsSync(workspace.resolve(`${prefix}_bad.png`,true)),false);
  await call('render_project',{...base,path:rest.path,overwrite:true});
  assert.equal(inspectRenderPixels(fs.readFileSync(workspace.resolve(rest.path))).pixel_sha256,rest.pixel_sha256);
  assert.deepEqual(await call('get_project_state',{}),baseline);assert.deepEqual(await call('get_animation_state',{project_id:id,animation_id:animation}),frames);
  const record={date:new Date().toISOString(),version:PLUGIN_VERSION,transport:'official SDK -> stdio -> real desktop plugin',files,calls:evidence};
  fs.writeFileSync(workspace.resolve(`${prefix}.evidence.json`,true),JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:true,files,evidence:`${prefix}.evidence.json`},null,2));
} catch(error) {
  fs.writeFileSync(workspace.resolve(`${prefix}.failure.json`,true),JSON.stringify({date:new Date().toISOString(),error:String(error),calls:evidence},null,2),{flag:'wx'});
  throw error;
} finally {await client.close();}
