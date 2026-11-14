import * as path from 'node:path';
import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { PLUGIN_VERSION, commandNames, outputSchemas, type Command, type ToolOutput } from '../src/shared/protocol.js';
import { Workspace } from '../src/shared/workspace.js';
import { errorSchema } from '../src/shared/errors.js';

const { values } = parseArgs({ options: { workspace: {type:'string'}, 'wait-seconds':{type:'string',default:'120'} } });
if (!values.workspace || !path.isAbsolute(values.workspace)) throw new Error('Use --workspace <absolute authorized repository directory>. Stop the Codex MCP server first.');
const wait = Number(values['wait-seconds']);
if (!Number.isInteger(wait) || wait < 1 || wait > 600) throw new Error('wait-seconds must be 1–600');
const workspace = new Workspace(values.workspace,fs);
const prefix = `models/mcp_export_${Date.now().toString(36)}_${randomUUID().slice(0,8)}`;
workspace.exportTarget(`${prefix}.geo.json`,'bedrock_model',false);
const atlas = workspace.readPng('examples/atlas-64.png');
const evidence: unknown[] = [];
const client = new Client({name:'blockbench-export-smoke',version:PLUGIN_VERSION});
const transport = new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server/index.js'),'--workspace',workspace.root],stderr:'inherit'});
async function call<K extends Command>(name: K, args: Record<string,unknown>): Promise<ToolOutput<K>> {
  const result=await client.callTool({name,arguments:args});
  evidence.push({name,arguments:args,result:result.structuredContent,isError:result.isError??false});
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
  return outputSchemas[name].parse(result.structuredContent) as ToolOutput<K>;
}
async function fails(name: Command, args: Record<string,unknown>, code: string): Promise<void> {
  const result=await client.callTool({name,arguments:args});
  evidence.push({name,arguments:args,result:result.structuredContent,isError:result.isError??false});
  assert.equal(result.isError,true); assert.equal(z.object({error:errorSchema}).parse(result.structuredContent).error.code,code);
}
const vector = z.array(z.number()).length(3);
const geometry = z.object({'minecraft:geometry':z.array(z.object({description:z.object({identifier:z.string(),texture_width:z.number(),texture_height:z.number()}),
  bones:z.array(z.object({name:z.string(),parent:z.string().optional(),pivot:vector,cubes:z.array(z.object({origin:vector,size:vector,uv:z.array(z.number())})).optional()}))}))});
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),[...commandNames].sort());
  console.log(`${commandNames.length} tools ready; connect the v${PLUGIN_VERSION} desktop plugin to this workspace.`);
  const end=Date.now()+wait*1000;
  while(true) {
    const result=await client.callTool({name:'get_project_state',arguments:{}});
    if(!result.isError) break;
    const error=z.object({error:errorSchema}).parse(result.structuredContent).error;
    if(error.code!=='NOT_CONNECTED'||Date.now()>=end)throw new Error(error.message);
    await delay(1000);
  }
  const name=path.basename(prefix);
  const id=(await call('create_project',{name,model_identifier:name})).project.id;
  const bones=(await call('create_bones',{project_id:id,bones:[{key:'root',name:'root'},{key:'arm',name:'arm',parent_key:'root',origin:[2,8,0]}]})).bones;
  const arm=bones.find(b=>b.key==='arm')!.id;
  const cube=(await call('create_cubes',{project_id:id,parent_id:arm,cubes:[{name:'arm',from:[1,2,3],to:[5,8,7]}]})).cube_ids[0]!;
  const texture=(await call('import_texture',{project_id:id,path:'examples/atlas-64.png'})).texture.id;
  await call('assign_texture',{project_id:id,texture_id:texture,cube_ids:[cube]});
  const a=(await call('create_animation',{project_id:id,name:'animation.export.wave',length:1,loop:'hold'})).animation.id;
  const b=(await call('create_animation',{project_id:id,name:'animation.export.idle',length:1})).animation.id;
  await call('set_keyframes',{project_id:id,animation_id:a,keyframes:[
    {bone_id:arm,channel:'rotation',time:0,value:[10,20,30]}, {bone_id:arm,channel:'rotation',time:1,value:[20,30,40]},
    {bone_id:arm,channel:'position',time:0,value:[2,3,4],interpolation:'step'}, {bone_id:arm,channel:'position',time:1,value:[4,5,6]},
    {bone_id:arm,channel:'scale',time:0,value:[1,1.2,1]},
  ]});
  await call('save_project',{project_id:id,path:`${prefix}.bbmodel`});
  const baseline=await call('get_project_state',{});
  const frames=await call('get_animation_state',{project_id:id,animation_id:a});
  await call('export_bedrock_model',{project_id:id,path:`${prefix}.geo.json`});
  await call('export_bedrock_animations',{project_id:id,path:`${prefix}.animation.json`,animation_ids:[a,b]});
  await call('export_texture_png',{project_id:id,path:`${prefix}.png`,texture_id:texture});
  const model=geometry.parse(JSON.parse(fs.readFileSync(workspace.resolve(`${prefix}.geo.json`),'utf8')))['minecraft:geometry'][0]!;
  assert.equal(model.description.identifier,`geometry.${name}`); assert.equal(model.description.texture_width,64); assert.equal(model.description.texture_height,64);
  const exportedArm=model.bones.find(b=>b.name==='arm')!; assert.equal(exportedArm.parent,'root'); assert.deepEqual(exportedArm.pivot,[-2,8,0]);
  assert.deepEqual(exportedArm.cubes?.[0],{origin:[-5,2,3],size:[4,6,4],uv:[0,0]});
  const animationDoc=z.object({format_version:z.literal('1.8.0'),animations:z.record(z.string(),z.unknown())}).parse(JSON.parse(fs.readFileSync(workspace.resolve(`${prefix}.animation.json`),'utf8')));
  assert.deepEqual(Object.keys(animationDoc.animations),['animation.export.wave','animation.export.idle']);
  const wave=z.object({loop:z.literal('hold_on_last_frame'),animation_length:z.literal(1),bones:z.object({arm:z.object({rotation:z.record(z.string(),vector),position:z.record(z.string(),z.union([vector,z.object({pre:vector,post:vector})])),scale:vector})})}).parse(animationDoc.animations['animation.export.wave']);
  assert.deepEqual(wave.bones.arm.rotation['0.0'],[-10,-20,30]); assert.deepEqual(wave.bones.arm.rotation['1.0'],[-20,-30,40]);
  assert.deepEqual(wave.bones.arm.position['1.0'],{pre:[-2,3,4],post:[-4,5,6]}); assert.deepEqual(wave.bones.arm.scale,[1,1.2,1]);
  assert.equal(fs.readFileSync(workspace.resolve(`${prefix}.png`)).toString('base64'),atlas.dataUrl.split(',')[1]);
  const original=fs.readFileSync(workspace.resolve(`${prefix}.geo.json`));
  await fails('export_bedrock_model',{project_id:id,path:`${prefix}.geo.json`},'FILE_EXISTS');
  assert.deepEqual(fs.readFileSync(workspace.resolve(`${prefix}.geo.json`)),original);
  await fails('export_texture_png',{project_id:id,path:'../escape.png',texture_id:texture},'PATH_FORBIDDEN');
  await fails('export_bedrock_animations',{project_id:id,path:`${prefix}_missing.animation.json`,animation_ids:[a,randomUUID()]},'NOT_FOUND');
  await call('export_bedrock_model',{project_id:id,path:`${prefix}.geo.json`,overwrite:true});
  assert.deepEqual(await call('get_project_state',{}),baseline);
  assert.deepEqual(await call('get_animation_state',{project_id:id,animation_id:a}),frames);
  // The native exporter snaps these distinct frames into the same slot.
  await call('set_keyframes',{project_id:id,animation_id:b,keyframes:[
    {bone_id:arm,channel:'rotation',time:0.1,value:[0,0,0]}, {bone_id:arm,channel:'rotation',time:0.1001,value:[0,1,0]},
  ]});
  const beforeConflict=await call('get_animation_state',{project_id:id,animation_id:b});
  await fails('export_bedrock_animations',{project_id:id,path:`${prefix}_conflict.animation.json`,animation_ids:[a,b]},'KEYFRAME_CONFLICT');
  assert.equal(fs.existsSync(workspace.resolve(`${prefix}_conflict.animation.json`,true)),false);
  assert.deepEqual(await call('get_animation_state',{project_id:id,animation_id:b}),beforeConflict);
  const files=['geo.json','animation.json','png'].map(suffix=>{
    const file=`${prefix}.${suffix}`; const content=fs.readFileSync(workspace.resolve(file));
    return {path:file,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
  });
  fs.writeFileSync(workspace.resolve(`${prefix}.evidence.json`,true),JSON.stringify({date:new Date().toISOString(),version:PLUGIN_VERSION,transport:'official SDK -> stdio -> real desktop plugin',files,calls:evidence},null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:true,files,evidence:`${prefix}.evidence.json`},null,2));
} finally { await client.close(); }
