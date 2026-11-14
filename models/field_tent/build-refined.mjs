import { refinedShell } from './refined-shell.mjs';
// Reproducible asset recipe. Host changes are exclusively allowlisted MCP calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inputSchemas, outputSchemas } from '../../src/shared/protocol.ts';
import { pngChunk } from '../../tests/helpers/png.ts';
import { beamGeometry } from '../../src/shared/beam-geometry.ts';

const root=process.cwd(),dir='models/field_tent/refined-final',W=2048,H=2048;
assert.equal(path.resolve(root).toLowerCase(),'d:\\desktop\\blockbenchmcp');
const materials=[
 ['canvas',[75,82,43]],['roof',[88,94,50]],['dark_canvas',[50,58,30]],['cream',[191,181,145]],
 ['wood',[123,83,46]],['dark_wood',[69,46,29]],['metal',[61,68,68]],['steel',[137,145,136]],
 ['rope',[185,158,106]],['lamp',[255,202,72]],['black',[27,32,30]],['blue',[37,83,113]],
 ['map_green',[102,137,70]],['red',[162,53,34]],['paper',[214,199,151]],['bedding',[104,114,63]],
 ['fold_light',[93,100,54]],['fold_dark',[62,70,35]],['patch',[89,91,46]],['mud',[54,49,30]],
 ['faded',[104,108,65]],['hem',[111,111,63]],['brass',[148,124,68]],['scuffed_metal',[83,89,79]],
];
while(materials.length<32)materials.push(['unused',[48,54,37]]);
// Keep degenerate/sub-unit Box UV faces away from neighbouring material tiles.
const uv=Object.fromEntries(materials.map(([name],i)=>[name,[(i%4)*512+4,Math.floor(i/4)*256+4]]));
const pixels=Buffer.alloc(H*(W*4+1));
let seed=79281;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const mat=Math.floor(y/256)*4+Math.floor(x/512),[name,color]=materials[mat],u=x%512,v=y%256;
 let n=Math.floor(rnd()*9)-4;
 if(name.includes('wood'))n+=(y%9===0?-18:0)+(Math.floor(x/13)%3===0?5:0);
 if(['canvas','roof','dark_canvas','fold_light','fold_dark','patch','faded','hem'].includes(name)){
  const crease=Math.sin(u*.43+Math.sin(v*.052)*.65);
  n+=Math.round(5*crease+3*Math.sin(u*.11+v*.023)+2*Math.sin(u*.027-v*.043));
  n+=(u%3===0?-2:0)+(v%3===0?2:0);
  if(u%61<2)n-=7;if(u%61===3&&v%4<2)n+=11;
  if((Math.floor(u/23)*13+Math.floor(v/17)*7)%19===0)n-=5;
 }
 if(name==='bedding')n+=(u%4===0?-4:0)+(v%4===0?3:0);
 if(['metal','steel'].includes(name))n=Math.floor(n/2)+(x%17===0?3:0);
 if(name==='lamp')n=Math.floor(n/3);
 const at=y*(W*4+1)+1+x*4;pixels.set([...color.map(v=>Math.max(0,Math.min(255,v+n))),255],at);
}
const header=Buffer.alloc(13);header.writeUInt32BE(W);header.writeUInt32BE(H,4);header[8]=8;header[9]=6;
const atlas=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);

const groups=new Map();let serial=0;
function box(group,name,from,to,material='canvas',rotation=[0,0,0],origin=[0,0,0]){
 const size=to.map((v,i)=>v-from[i]);assert.ok(size.every(v=>v>=0),name);
 assert.ok(2*(Math.floor(size[0])+Math.floor(size[2]))<=504&&Math.floor(size[1])+Math.floor(size[2])<=248,`tile overflow ${name}`);
 // Mirror across X so the entrance view matches the reference: desk left, beds right.
 const spec={name:`${name}_${++serial}`,from:[-to[0],from[1],from[2]],to:[-from[0],to[1],to[2]],rotation:[rotation[0],-rotation[1],-rotation[2]],origin:[-origin[0],origin[1],origin[2]],uv_offset:uv[material]};
 if(!groups.has(group))groups.set(group,[]);groups.get(group).push(spec);return spec;
}
function slopePanel(group,name,x1,y1,x2,y2,z0,z1,thickness,material){
 if(x1>x2){[x1,x2]=[x2,x1];[y1,y2]=[y2,y1];}
 const width=Math.hypot(x2-x1,y2-y1),c=[(x1+x2)/2,(y1+y2)/2,(z0+z1)/2];
 box(group,name,[c[0]-width/2-.12,c[1]-thickness/2,z0],[c[0]+width/2+.12,c[1]+thickness/2,z1],material,[0,0,Math.atan2(y2-y1,x2-x1)*180/Math.PI],c);
}
function beam(group,name,a,b,width,material='metal'){
 const g=beamGeometry(a,b,width);
 return box(group,name,g.from,g.to,material,g.rotation,g.origin);
}
function chest(group,x,y,z,w=14,h=10,d=12,material='wood'){
 box(group,'crate_body',[x,y,z],[x+w,y+h,z+d],material);
 box(group,'crate_lid',[x-.4,y+h,z-.4],[x+w+.4,y+h+1.5,z+d+.4],material);
 for(const a of [x+1,x+w-3])box(group,'crate_band',[a,y-.2,z-.5],[a+2,y+h+1.8,z+d+.5],'metal');
 box(group,'crate_latch',[x+w/2-1,y+h-3,z-1],[x+w/2+1,y+h+.4,z-.4],'steel');
}
function lantern(group,x,y,z,scale=1){
 const s=scale;beam(group,'lamp_chain',[x,y+7*s,z],[x,y+12*s,z],s,'metal');
 box(group,'lantern_light',[x-2*s,y,z-2*s],[x+2*s,y+5*s,z+2*s],'lamp');
 for(const h of [-s,5*s])box(group,'lantern_cap',[x-3*s,y+h,z-3*s],[x+3*s,y+h+s,z+3*s],'metal');
 for(const a of [-2.5,1.5])for(const b of [-2.5,1.5])box(group,'lantern_cage',[x+a*s,y,z+b*s],[x+(a+1)*s,y+5*s,z+(b+1)*s],'metal');
}

// Raised plank deck; model axes: front is -Z, width X, height Y.
for(let x=-48;x<48;x+=6)for(let z=-72;z<72;z+=24)box('floor','deck_plank',[x+.12,1,z+.12],[x+5.88,3.8,z+23.88],'wood');
for(const x of [-46,44])box('floor','deck_joist',[x,0,-72],[x+2,1,72],'dark_wood');
box('floor','entry_step',[-20,0,-80],[20,2,-72],'wood');
box('floor','entry_threshold',[-20,3.8,-74],[20,5,-70],'dark_wood');
box('rug','rug_border',[-18,3.85,-43],[18,4.25,49],'dark_canvas');
box('rug','woven_rug',[-16,4.25,-41],[16,4.45,47],'bedding');
for(let z=-40;z<48;z+=6)for(const x of [-17,16])box('rug','rug_stitch',[x,4.45,z],[x+1,4.6,z+3],'cream');

const {tilt}=refinedShell({box,beam,slopePanel});

// Left command station with cupboards, map screen, pinboard and radio.
box('workbench','worktop',[-44,21,-54],[-24,23,5],'wood');
for(const z of [-52,-5])chest('workbench',-43,4,z,17,15,10,'dark_wood');
for(const z of [-34,-18]){
 box('workbench','drawer_carcass',[-43,4,z],[-26,20,z+13],'dark_wood');
 for(const y of [5,10,15]){box('workbench','drawer_front',[-25.9,y,z+.4],[-25.1,y+4,z+12.6],'wood');box('workbench','drawer_handle',[-25,y+1.3,z+5],[-24.2,y+2.5,z+8],'steel');}
}
box('workbench','map_frame',[-43,25,-37],[-41,43,-10],'dark_wood');
box('workbench','map_blue',[-40.9,26,-36],[-40.5,42,-11],'blue');
for(let i=0;i<42;i++){
 const z=-34+(i*7%22),y=28+(i*3%12);
 if((i*13)%9<6)box('workbench','map_land',[-40.45,y,z],[-40.1,y+2,z+2],'map_green');
}
box('workbench','map_stand',[-43,23,-25],[-37,25,-21],'metal');
box('workbench','keyboard',[-36,23,-32],[-27,24,-16],'black');
for(let z=-31;z<-16;z+=3)for(let x=-35;x<-27;x+=3)box('workbench','key',[x,24,z],[x+1.7,24.5,z+1.7],'steel');
box('workbench','radio',[-41,23,-7],[-29,31,2],'dark_canvas');
for(let z=-6;z<0;z+=2)box('workbench','radio_grille',[-28.9,25,z],[-28.5,29,z+.6],'black');
box('workbench','radio_dial',[-28.5,24,0],[-27.5,26,2],'steel');
beam('workbench','radio_aerial',[-40,31,1],[-40,45,1],.7,'metal');
box('workbench','paper_on_desk',[-36,23.1,-49],[-26,23.4,-40],'paper');
lantern('lights',-34,24,-49,.75);
box('noticeboard','pinboard',[-45,25,10],[-43,46,40],'wood');
for(const [y,z]of [[28,12],[36,14],[30,24],[37,29]]){
 box('noticeboard','notice_paper',[-42.9,y,z],[-42.5,y+6,z+8],'paper');
 box('noticeboard','red_pin',[-42.4,y+5,z+3],[-42,y+5.7,z+3.7],'red');
 for(let yy=y+1;yy<y+5;yy+=1.5)box('noticeboard','notice_ink',[-42.4,yy,z+1],[-42.2,yy+.3,z+6],'dark_wood');
}
// Right-hand two bunk-bed units, each with two mattresses and a ladder.
for(const z of [-50,10]){
 const g=z<0?'bunks_front':'bunks_back';
 for(const x of [25,44])for(const zz of [z,z+46]){
  box(g,'bed_post',[x,4,zz],[x+2,47,zz+2],'wood');
  for(const y of [10,35])box(g,'bed_bracket',[x-.3,y,zz-.3],[x+2.3,y+2,zz+2.3],'steel');
 }
 for(const y of [12,35]){
  box(g,'bed_slat',[25,y,z],[46,y+2,z+48],'dark_wood');
  box(g,'mattress',[26,y+2,z+1],[45,y+5,z+47],'cream');
  box(g,'olive_blanket',[26,y+5,z+12],[45,y+6,z+46],'bedding');
  box(g,'pillow',[28,y+5,z+3],[43,y+7,z+10],'paper');
  for(const zz of [z,z+46])box(g,'bed_endrail',[25,y+4,zz],[46,y+6,zz+2],'wood');
 }
 for(const zz of [z+31,z+41])box(g,'ladder_rail',[22.5,4,zz],[24,39,zz+1.4],'wood');
 for(let y=7;y<38;y+=6)box(g,'ladder_rung',[22,y,z+31],[24.5,y+1.4,z+42.5],'wood');
 box(g,'top_guardrail',[24,42,z+2],[25.3,43.5,z+26],'wood');
 chest(g,29,4,z+7,12,5,16,'dark_canvas');
}
// Back supply shelves, books, cans, crates and a first-aid case.
for(const x of [-42,-9,24]){
 const w=27;
 for(const xx of [x,x+w-2])for(const z of [58,68])box('storage','shelf_post',[xx,4,z],[xx+2,48,z+2],'wood');
 for(const y of [5,20,35,47])box('storage','shelf_board',[x,y,57],[x+w,y+1.5,71],'wood');
 chest('storage',x+4,6,59,18,10,10,x===-9?'cream':'dark_wood');
 if(x===-9){box('storage','medical_cross_vertical',[x+11,9,58.4],[x+13,16,58.9],'red');box('storage','medical_cross_horizontal',[x+8.5,11.5,58.3],[x+15.5,13.5,58.8],'red');}
 for(let i=0;i<5;i++)box('storage','supply_tin',[x+3+i*4,22,61],[x+6+i*4,29+(i%2)*3,67],i%2?'dark_canvas':'bedding');
 for(let i=0;i<6;i++){
  box('storage','field_manual',[x+3+i*3,36,61],[x+5+i*3,44,68],i%3===0?'red':i%3===1?'dark_canvas':'paper');
  box('storage','book_spine_mark',[x+3+i*3,40,60.7],[x+5+i*3,41,61],'cream');
 }
}
chest('loose_supplies',-43,4,42,17,11,13,'dark_canvas');
chest('loose_supplies',-20,4,52,13,9,13,'wood');
// Folding stool in front of the command table.
box('workbench','stool_seat',[-21,12,-22],[-9,14,-10],'dark_canvas');
for(const z of [-20,-12]){beam('workbench','stool_cross',[-21,4,z],[-9,12,z],1.3,'wood');beam('workbench','stool_cross',[-9,4,z],[-21,12,z],1.3,'wood');}
lantern('lights',0,61,-49,1);lantern('lights',0,61,32,1);
beam('lights','lantern_wire',[0,76,-66],[0,76,65],.5,'black');

// A rigid 3.5-unit move keeps the entire rear shelf assembly inside the leaning wall.
for(const c of groups.get('storage'))for(const k of ['from','to','origin'])c[k][0]+=3.5;
const original=JSON.parse(fs.readFileSync('models/field_tent/final/recipe.json','utf8'));
const interiorGroups=['floor','rug','workbench','lights','noticeboard','bunks_front','bunks_back','storage','loose_supplies'];
const rounded=a=>a.map(v=>Math.round(v*1e8)/1e8+0);
const normalize=(c,shift=0)=>({name:c.name.replace(/_\d+$/,''),from:rounded(c.from.map((v,i)=>v+(i===0?shift:0))),to:rounded(c.to.map((v,i)=>v+(i===0?shift:0))),origin:rounded(c.origin.map((v,i)=>v+(i===0?shift:0))),rotation:rounded(c.rotation)});
for(const g of interiorGroups)assert.deepEqual(groups.get(g).map(c=>normalize(c)),original.groups[g].map(c=>normalize(c,g==='storage'?3.5:0)),`Interior preservation: ${g}`);
const plan={name:'Ranger Field Tent Refined',dimensions_blocks:[10,7,5],axis:'X width, Y up, front -Z',texture:[W,H],cubes:serial,wall_tilt:tilt,interior_groups_preserved:interiorGroups,groups:Object.fromEntries(groups)};
for(const cubes of groups.values())for(const cube of cubes)inputSchemas.create_cubes.shape.cubes.element.parse(cube);
fs.writeFileSync(`${dir}/field_tent_atlas.png`,atlas,{flag:'wx'});
fs.writeFileSync(`${dir}/recipe.json`,JSON.stringify(plan,null,2),{flag:'wx'});
console.log(`Prepared ${serial} cubes in ${groups.size} groups; atlas ${atlas.length} bytes.`);
if(process.argv.includes('--prepare-only'))process.exit(0);

const views=[
 ['exterior',{projection:'perspective',position:[175,104,-224],target:[0,33,0],fov:42}],
 ['interior',{projection:'perspective',position:[0,38,-65],target:[0,33,48],fov:78}],
 ['cutaway',{projection:'orthographic',position:[170,180,-210],target:[0,27,0],vertical_size:200},true],
 ['front',{projection:'orthographic',position:[0,36,-240],target:[0,36,0],vertical_size:100}],
 ['back',{projection:'orthographic',position:[0,38,240],target:[0,38,0],vertical_size:100}],
 ['side',{projection:'orthographic',position:[240,40,0],target:[0,40,0],vertical_size:130}],
 ['entrance_detail',{projection:'perspective',position:[63,44,-128],target:[0,32,-72],fov:48}],
];

const client=new Client({name:'field-tent-model-builder',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server/index.js'),'--workspace',root],stderr:'inherit'});
const calls=[];
async function call(name,args){
 const validated=inputSchemas[name].parse(args);const reply=await client.callTool({name,arguments:validated});
 calls.push({name,result:reply.structuredContent,isError:reply.isError??false});
 fs.writeFileSync(`${dir}/session.json`,JSON.stringify({calls},null,2));
 if(reply.isError)throw new Error(`${name}: ${JSON.stringify(reply.structuredContent)}`);
 return outputSchemas[name].parse(reply.structuredContent);
}
try{
 await client.connect(transport);
 for(let i=0;;i++){
  const r=await client.callTool({name:'get_project_state',arguments:{}});
  if(!r.isError)break;if(r.structuredContent?.error?.code!=='NOT_CONNECTED'||i>=120)throw new Error(JSON.stringify(r.structuredContent));await delay(1000);
 }
 const baseline=JSON.parse(fs.readFileSync('models/field_tent/final/result.json','utf8'));
 if(process.argv.includes('--reuse-baseline')){
  const capture=JSON.parse(fs.readFileSync('models/field_tent/refined/session.json','utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync('models/field_tent/refined/result.json','utf8')).views,views,'Baseline camera settings must match.');
  for(const [name,camera,cutaway]of views){
   assert.ok(capture.calls.some(c=>c.name==='render_project'&&!c.isError&&c.result.project_id===baseline.project&&c.result.path===`models/field_tent/refined/before_${name}.png`));
   fs.copyFileSync(`models/field_tent/refined/before_${name}.png`,`${dir}/before_${name}.png`,fs.constants.COPYFILE_EXCL);
  }
 }else{
  const current=await call('get_project_state',{limit:1});assert.equal(current.project.id,baseline.project,'Select the saved baseline before rebuilding.');assert.equal(current.project.saved,true);
  for(const [name,camera,cutaway]of views)await call('render_project',{project_id:baseline.project,path:`${dir}/before_${name}.png`,width:1200,height:900,camera,background:'#252d2c',...(cutaway?{animation:{animation_id:baseline.animation,time:1}}:{})});
 }
 const project=(await call('create_project',{name:'ranger_field_tent_refined',model_identifier:'ranger_field_tent_refined',texture_width:W,texture_height:H})).project.id;
 const shell=['roof','wall_left','wall_right','front_canvas','rear_canvas','guy_ropes','entrance_frame'];
 const specs=[{key:'root',name:'root'},{key:'outer_shell',name:'outer_shell',parent_key:'root'},...Array.from(groups.keys()).map(key=>({key,name:key,parent_key:shell.includes(key)?'outer_shell':'root',...(key==='wall_left'?{origin:[54,4,0],rotation:[0,0,tilt]}:key==='wall_right'?{origin:[-54,4,0],rotation:[0,0,-tilt]}:{})}))];
 const bones=(await call('create_bones',{project_id:project,bones:specs})).bones;
 const ids=Object.fromEntries(bones.map(b=>[b.key,b.id]));const all=[];
 for(const [group,cubes]of groups){
  for(let i=0;i<cubes.length;i+=128){const r=await call('create_cubes',{project_id:project,parent_id:ids[group],cubes:cubes.slice(i,i+128)});all.push(...r.cube_ids);}
  console.log(`Created ${group}: ${cubes.length}`);
 }
 const texture=(await call('import_texture',{project_id:project,path:`${dir}/field_tent_atlas.png`,name:'field_tent_atlas'})).texture.id;
 for(let i=0;i<all.length;i+=128)await call('assign_texture',{project_id:project,texture_id:texture,cube_ids:all.slice(i,i+128)});
 const animation=(await call('create_animation',{project_id:project,name:'animation.field_tent.cutaway',length:1,loop:'hold'})).animation.id;
 await call('set_keyframes',{project_id:project,animation_id:animation,keyframes:[{bone_id:ids.outer_shell,channel:'scale',time:0,value:[1,1,1]},{bone_id:ids.outer_shell,channel:'scale',time:1,value:[.001,.001,.001]}]});
 await call('save_project',{project_id:project,path:`${dir}/ranger_field_tent.bbmodel`});
 await call('export_bedrock_model',{project_id:project,path:`${dir}/ranger_field_tent.geo.json`});
 await call('export_bedrock_animations',{project_id:project,path:`${dir}/ranger_field_tent.animation.json`,animation_ids:[animation]});
 for(const [name,camera,cutaway]of views){
  await call('render_project',{project_id:project,path:`${dir}/${name}.png`,width:1200,height:900,camera,background:'#252d2c',...(cutaway?{animation:{animation_id:animation,time:1}}:{})});console.log(`Rendered ${name}`);
 }
 let total=0;for(let offset=0;;){const state=await call('get_project_state',{offset,limit:200});assert.equal(state.project.id,project);assert.equal(state.project.saved,true);assert.equal(state.project.cube_count,serial);assert.ok(state.cubes.every(c=>c.texture_ids.includes(texture)));total+=state.cubes.length;if(state.next_offset===null)break;offset=state.next_offset;}
 assert.equal(total,serial);
 fs.writeFileSync(`${dir}/result.json`,JSON.stringify({project,texture,animation,bones:ids,cubes:serial,passed:true,interior_preserved:interiorGroups,wall_tilt:tilt,views},null,2));
 console.log(JSON.stringify({passed:true,project,cubes:serial,bones:bones.length,path:`${dir}/ranger_field_tent.bbmodel`}));
}finally{await client.close();}
