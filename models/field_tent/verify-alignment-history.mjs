import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inputSchemas, outputSchemas } from '../../src/shared/protocol.ts';
const mode=process.argv[2];assert.ok(['undo','redo','inspect'].includes(mode));
const dir='models/field_tent/aligned',evidence=JSON.parse(fs.readFileSync(`${dir}/result.json`,'utf8'));
const expected=mode==='undo'?evidence.before:evidence.after;
const client=new Client({name:'beam-history-verification',version:'0.6.0'});
async function call(name,args){
 const result=await client.callTool({name,arguments:inputSchemas[name].parse(args)});
 if(result.isError)throw new Error(JSON.stringify(result.structuredContent));
 return outputSchemas[name].parse(result.structuredContent);
}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server/index.js'),'--workspace',process.cwd()],stderr:'inherit'}));
 for(let i=0;;i++){
  const r=await client.callTool({name:'get_project_state',arguments:{limit:1}});
  if(!r.isError)break;
  if(r.structuredContent?.error?.code!=='NOT_CONNECTED'||i>=60)throw new Error(JSON.stringify(r.structuredContent));
  await delay(1000);
 }
 const cubes=[];let first;
 for(let offset=0;;){const s=await call('get_project_state',{offset,limit:200});first??=s;cubes.push(...s.cubes);if(s.next_offset===null)break;offset=s.next_offset;}
 assert.equal(first.project.id,evidence.project);
 assert.deepEqual(cubes,expected.cubes);assert.deepEqual(first.bones,expected.bones);assert.deepEqual(first.textures,expected.textures);
 if(mode==='redo')await call('save_project',{project_id:evidence.project,path:`${dir}/ranger_field_tent_aligned.bbmodel`,overwrite:true});
 const result={mode,passed:true,time:new Date().toISOString(),cube_count:cubes.length,bone_count:first.bones.length,texture_count:first.textures.length,aligned_count:evidence.aligned_count,ids_preserved:true,saved_after_redo:mode==='redo'};
 fs.writeFileSync(`${dir}/${mode}-verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await client.close();}
