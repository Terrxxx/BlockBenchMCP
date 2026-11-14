import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, VERSION, outputSchemas, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { pngFixture } from '../helpers/png.js';
import { tempWorkspace } from '../helpers/temp.js';
import { BridgeError } from '../../src/shared/errors.js';

describe('render controller and boundaries',()=>{
  let host:FakeHost;let adapter:BlockbenchAdapter;let workspace:Workspace;let id:string;
  const camera={projection:'perspective',position:[32,24,40],target:[0,8,0]};
  function run<K extends Command>(command:K,params:unknown,deadline=Date.now()+1000):ToolOutput<K>{
    return outputSchemas[command].parse(adapter.execute(requestSchema.parse({version:VERSION,type:'request',request_id:randomUUID(),deadline_ms:deadline,command,params}))) as ToolOutput<K>;
  }
  const render=(extra={})=>run('render_project',{project_id:id,path:'render.png',width:64,height:64,camera,...extra});
  beforeEach(()=>{host=new FakeHost();workspace=new Workspace(tempWorkspace(),fs);adapter=new BlockbenchAdapter(host,workspace);id=run('create_project',{name:'render',model_identifier:'render'}).project.id;host.calls=[];});
  it('writes a bounded PNG and preserves project data without Undo',()=>{
    const before=structuredClone(host.project);expect(render()).toMatchObject({width:64,height:64,animation_id:null,time:null});
    expect(fs.readFileSync(path.join(workspace.root,'render.png'))).toEqual(pngFixture(64,64));expect(host.project).toEqual(before);
    expect(host.calls).toEqual(['Preview.render','Blockbench.writeFile']);
  });
  it.each([
    {width:2049},{height:0},{background:'https://example.com/background.png'},
    {camera:{...camera,position:[0,8,0]}},{camera:{...camera,up:[0,0,0]}},
    {camera:{...camera,position:[0,10,0],up:[0,1,0]}},
    {camera:{...camera,projection:'orthographic'}}, {path:'../escape.png'}, {path:'render.jpg'},
  ])('rejects invalid camera, size, background or path before rendering %j',extra=>{
    expect(()=>render(extra)).toThrow();expect(host.calls).toEqual([]);
  });
  it('permits top-view up vectors and orthographic framing',()=>{
    expect(render({camera:{projection:'orthographic',position:[0,64,0],target:[0,8,0],up:[0,0,-1],vertical_size:32},background:'#FF00ff'}).bytes).toBeGreaterThan(0);
  });
  it('preflights ownership, resources, internal textures, busy state and overwrite',()=>{
    host.editing=true;expect(()=>render()).toThrow('active Blockbench edit');host.editing=false;
    host.resources=[path.join(tempWorkspace(),'outside.png')];expect(()=>render()).toThrow('outside');host.resources=[];
    host.atlases=[{uuid:randomUUID(),name:'external',internal:false,width:64,height:64}];expect(()=>render()).toThrow('internal');host.atlases=[];
    fs.writeFileSync(path.join(workspace.root,'render.png'),'keep');expect(()=>render()).toThrow('Target exists');
    expect(host.calls).toEqual([]);render({overwrite:true});
    adapter=new BlockbenchAdapter(host,workspace);expect(()=>render({overwrite:true})).toThrow('connection session');
  });
  it('validates animation ID, supported data and time before render',()=>{
    const a=run('create_animation',{project_id:id,name:'animation.render.wave',length:1}).animation.id;
    expect(()=>render({animation:{animation_id:randomUUID(),time:0}})).toThrow('not found');
    expect(()=>render({animation:{animation_id:a,time:2}})).toThrow('exceeds');
    host.animationEditable=()=>false;expect(()=>render({animation:{animation_id:a,time:0}})).toThrow('numeric');
    host.animationEditable=()=>true;expect(render({animation:{animation_id:a,time:0.5}})).toMatchObject({animation_id:a,time:0.5});
  });
  it('rejects missing/invalid PNG and wrong dimensions before writing',()=>{
    host.renderPng=()=>'';expect(()=>render()).toThrow('data URL');
    host.renderPng=()=>`data:image/png;base64,${pngFixture(128,64).toString('base64')}`;expect(()=>render()).toThrow('dimensions');
    expect(fs.existsSync(path.join(workspace.root,'render.png'))).toBe(false);
  });
  it('does not write when time, project or target changed during capture',()=>{
    const original=host.renderPng.bind(host),now=Date.now();
    host.renderPng=input=>{vi.spyOn(Date,'now').mockReturnValue(now+2000);return original(input);};
    try{expect(()=>render()).toThrow('deadline');}finally{vi.restoreAllMocks();}
    host.renderPng=input=>{host.project!.uuid=randomUUID();return original(input);};expect(()=>render()).toThrow('active project changed');host.project!.uuid=id;
    host.renderPng=input=>{fs.writeFileSync(path.join(workspace.root,'render.png'),'keep');return original(input);};expect(()=>render()).toThrow('Target exists');
    expect(host.calls).not.toContain('Blockbench.writeFile');
  });
  it('keeps render errors certain, restoration and write errors uncertain',()=>{
    const original=host.renderPng.bind(host);
    host.renderPng=()=>{throw new Error('GPU failed');};expect(()=>render()).toThrow(expect.objectContaining({code:'RENDER_FAILED',outcomeUnknown:false}));
    host.renderPng=()=>{throw new BridgeError('RENDER_FAILED','Restore failed',true);};expect(()=>render()).toThrow(expect.objectContaining({outcomeUnknown:true}));
    host.renderPng=original;host.failWrite=true;expect(()=>render()).toThrow(expect.objectContaining({code:'RENDER_FAILED',outcomeUnknown:true}));
  });
});
