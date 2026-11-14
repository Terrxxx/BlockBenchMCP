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

const root=process.cwd(),dir='models/field_tent/final',W=1024,H=2048;
assert.equal(path.resolve(root).toLowerCase(),'d:\\desktop\\blockbenchmcp');
const materials=[
 ['canvas',[84,91,48]],['roof',[102,107,59]],['dark_canvas',[57,65,34]],['cream',[199,190,154]],
 ['wood',[123,83,46]],['dark_wood',[69,46,29]],['metal',[61,68,68]],['steel',[137,145,136]],
 ['rope',[185,158,106]],['lamp',[255,202,72]],['black',[27,32,30]],['blue',[37,83,113]],
 ['map_green',[102,137,70]],['red',[162,53,34]],['paper',[214,199,151]],['bedding',[104,114,63]],
];
const uv=Object.fromEntries(materials.map(([name],i)=>[name,[(i%2)*512,Math.floor(i/2)*256]]));
const pixels=Buffer.alloc(H*(W*4+1));
let seed=79281;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const mat=Math.floor(y/256)*2+Math.floor(x/512),[name,color]=materials[mat];
 let n=Math.floor(rnd()*9)-4;
 if(name.includes('wood'))n+=(y%9===0?-18:0)+(Math.floor(x/13)%3===0?5:0);
 if(['canvas','roof','dark_canvas','bedding'].includes(name))n+=(x%4===0?-4:0)+(y%4===0?3:0);
 if(['metal','steel'].includes(name))n=Math.floor(n/2)+(x%17===0?3:0);
 if(name==='lamp')n=Math.floor(n/3);
 const at=y*(W*4+1)+1+x*4;pixels.set([...color.map(v=>Math.max(0,Math.min(255,v+n))),255],at);
}
const header=Buffer.alloc(13);header.writeUInt32BE(W);header.writeUInt32BE(H,4);header[8]=8;header[9]=6;
const atlas=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(`${dir}/field_tent_atlas.png`,atlas,{flag:'wx'});

const groups=new Map();let serial=0;
function box(group,name,from,to,material='canvas',rotation=[0,0,0],origin=[0,0,0]){
 const size=to.map((v,i)=>v-from[i]);assert.ok(size.every(v=>v>=0),name);
 assert.ok(2*(Math.floor(size[0])+Math.floor(size[2]))<=512&&Math.floor(size[1])+Math.floor(size[2])<=256,`tile overflow ${name}`);
 // Mirror across X so the entrance view matches the reference: desk left, beds right.
 const spec={name:`${name}_${++serial}`,from:[-to[0],from[1],from[2]],to:[-from[0],to[1],to[2]],rotation:[rotation[0],-rotation[1],-rotation[2]],origin:[-origin[0],origin[1],origin[2]],uv_offset:uv[material]};
 if(!groups.has(group))groups.set(group,[]);groups.get(group).push(spec);return spec;
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

// Fabric wall sections with real window openings and strap borders.
for(const side of [-1,1]){
 const x=side*48;const g=side<0?'wall_left':'wall_right';
 box(g,'lower_canvas',[x-.7,4,-72],[x+.7,26,72],'canvas');
 box(g,'upper_canvas',[x-.7,44,-72],[x+.7,51,72],'canvas');
 for(const [a,b]of [[-72,-57],[-31,-13],[13,31],[57,72]])box(g,'canvas_pier',[x-.7,26,a],[x+.7,44,b],'canvas');
 for(const z of [-44,0,44]){
  for(const h of [25,43])box(g,'window_horizontal',[x-1.1,h,z-14],[x+1.1,h+2,z+14],'dark_canvas');
  for(const zz of [z-14,z+12])box(g,'window_vertical',[x-1.1,25,zz],[x+1.1,45,zz+2],'dark_canvas');
  // Open apertures with thin lattice, no opaque fake glass.
  for(const zz of [z-7,z,z+7])box(g,'window_mesh',[x-.25,27,zz],[x+.25,43,zz+.5],'metal');
  for(const h of [31,37])box(g,'window_mesh',[x-.25,h,z-12],[x+.25,h+.5,z+12],'metal');
  box(g,'rolled_window_flap',[x-2,45,z-14],[x+2,48,z+14],'roof');
 }
 box(g,'recognition_band',[x-1,16,-72],[x+1,19,72],'cream');
 for(const z of [-71,-24,24,70]){
  box(g,'wall_seam',[x-1,4,z],[x+1,51,z+1],'dark_canvas');
  for(const h of [8,48])box(g,'seam_buckle',[x-1.4,h,z-.4],[x+1.4,h+2,z+1.4],'steel');
 }
}
// Roof sheets are genuinely sloped cuboids with a pitched ridge.
const angle=Math.atan2(27,48)*180/Math.PI,roofLength=Math.hypot(48,27);
for(const side of [-1,1]){
 const center=[side*24,64.5,0];
 for(let z=-76;z<76;z+=38)box('roof','canvas_roof_panel',[center[0]-roofLength/2,63.7,z],[center[0]+roofLength/2,65.3,z+38],side<0?'roof':'canvas',[0,0,-side*angle],center);
 for(const z of [-75,-38,0,38,74])beam('roof','roof_cross_strap',[side*49,50.8,z],[0,78.4,z],1.2,'dark_canvas');
 beam('roof','eave_hem',[side*49,50.5,-77],[side*49,50.5,77],2,'roof');
}
beam('roof','ridge_cap',[0,78.5,-77],[0,78.5,77],2.4,'dark_canvas');
// Front/back gables in thin voxel courses; open entrance under a rolled door.
for(const z of [-72,72]){
 const g=z<0?'front_canvas':'rear_canvas';
 for(let y=51;y<78;y+=1.5){const half=Math.max(.5,(78-y)*48/27);box(g,'gable_canvas',[-half,y,z-.7],[half,y+1.5,z+.7],z<0?'roof':'canvas');}
 if(z<0){
  for(const x of [-48,20])box(g,'front_panel',[x,4,z-.7],[x+28,51,z+.7],'canvas');
  for(const x of [-48,20])box(g,'front_band',[x,16,z-1],[x+28,19,z+1],'cream');
  box(g,'door_header',[-20,49,z-1],[20,53,z+1],'dark_canvas');
  box(g,'rolled_door',[-21,49,z-4],[21,54,z+1],'roof');
  for(const x of [-17,15])box(g,'door_roll_tie',[x,48.5,z-4.4],[x+2,54.5,z+1.4],'rope');
  for(const side of [-1,1])beam(g,'folded_door_edge',[side*20,4,z-2],[side*16,49,z-2],3,'roof');
 }else{
  box(g,'back_lower',[-48,4,z-.7],[48,26,z+.7],'canvas');
  box(g,'back_upper',[-48,42,z-.7],[48,51,z+.7],'canvas');
  for(const [a,b]of [[-48,-33],[-17,17],[33,48]])box(g,'back_pier',[a,26,z-.7],[b,42,z+.7],'canvas');
  for(const x of [-25,25]){
   for(const h of [26,40])box(g,'back_window_frame',[x-9,h,z-1],[x+9,h+2,z+1],'dark_canvas');
   for(const xx of [x-9,x+7])box(g,'back_window_frame',[xx,26,z-1],[xx+2,42,z+1],'dark_canvas');
   beam(g,'window_cross',[x-7,28,z],[x+7,40,z],.8,'metal');beam(g,'window_cross',[x+7,28,z],[x-7,40,z],.8,'metal');
  }
  box(g,'back_center_seam',[-.6,4,z-1],[.6,75,z+1],'dark_canvas');
 }
}
// Tubular support ribs, collars, stakes and diagonal guy ropes.
for(const z of [-70,-24,24,70]){
 for(const side of [-1,1]){
  beam('frame','upright',[side*46,4,z],[side*46,50,z],1.8,'metal');
  beam('roof_frame','rafter',[side*46,50,z],[0,76,z],1.8,'metal');
  box('frame','upright_foot',[side*46-2,3.8,z-2],[side*46+2,6,z+2],'steel');
  box('frame','eave_collar',[side*46-1.6,47,z-1.6],[side*46+1.6,51,z+1.6],'steel');
 }
 box('roof_frame','ridge_connector',[-2,74,z-2],[2,78,z+2],'steel');
}
for(const x of [-46,46])beam('frame','long_eave_rail',[x,49,-71],[x,49,71],1.6,'metal');
beam('roof_frame','ridge_pole',[0,76,-71],[0,76,71],1.8,'metal');
for(const side of [-1,1])for(const z of [-65,0,65]){
 const end=[side*55,1,z===0?8:Math.sign(z)*78];
 beam('guy_ropes','tension_rope',[side*49,50,z],end,.8,'rope');
 box('guy_ropes','stone_anchor',[end[0]-1.5,0,end[2]-1.5],[end[0]+1.5,3,end[2]+1.5],'steel');
 beam('guy_ropes','anchor_peg',[end[0],0,end[2]],[end[0]+side,5,end[2]+1],1,'metal');
 const a=[side*50.5,36,z+(end[2]-z)*.28],b=[side*51.2,32,z+(end[2]-z)*.36];beam('guy_ropes','rope_tensioner',a,b,1.6,'wood');
}
// Distinctive cream wing insignia on both side walls, below the windows.
for(const side of [-1,1]){
 const x=side*49.3,g=side<0?'wall_left':'wall_right';
 for(const [zz,yy,ww]of [[-10,23,7],[-8,21,5],[-6,19,3],[3,23,7],[3,21,5],[3,19,3]])box(g,'wing_emblem',[x-.3,yy,zz],[x+.3,yy+1.5,zz+ww],'cream');
 box(g,'insignia_spine',[x-.3,19,-1],[x+.3,28,1],'cream');
 box(g,'insignia_head',[x-.3,28,-2],[x+.3,30,2],'cream');
}

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

const plan={name:'Ranger Field Tent',dimensions_blocks:[10,7,5],axis:'X width, Y up, front -Z',texture:[W,H],cubes:serial,groups:Object.fromEntries(groups)};
for(const cubes of groups.values())for(const cube of cubes)inputSchemas.create_cubes.shape.cubes.element.parse(cube);
fs.writeFileSync(`${dir}/recipe.json`,JSON.stringify(plan,null,2),{flag:'wx'});
console.log(`Prepared ${serial} cubes in ${groups.size} groups; atlas ${atlas.length} bytes.`);
if(process.argv.includes('--prepare-only'))process.exit(0);

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
 const project=(await call('create_project',{name:'ranger_field_tent',model_identifier:'ranger_field_tent',texture_width:W,texture_height:H})).project.id;
 const shell=['roof','wall_left','wall_right','front_canvas','rear_canvas','guy_ropes'];
 const specs=[{key:'root',name:'root'},{key:'outer_shell',name:'outer_shell',parent_key:'root'},...Array.from(groups.keys()).map(key=>({key,name:key,parent_key:shell.includes(key)?'outer_shell':'root'}))];
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
 const views=[
  ['exterior',{projection:'perspective',position:[175,104,-224],target:[0,33,0],fov:42}],
  ['interior',{projection:'perspective',position:[0,38,-65],target:[0,33,48],fov:78}],
  ['cutaway',{projection:'orthographic',position:[170,180,-210],target:[0,27,0],vertical_size:200},{animation_id:animation,time:1}],
  ['front',{projection:'orthographic',position:[0,36,-240],target:[0,36,0],vertical_size:100}],
  ['back',{projection:'orthographic',position:[0,38,240],target:[0,38,0],vertical_size:100}],
 ];
 for(const [name,camera,anim]of views){
  await call('render_project',{project_id:project,path:`${dir}/${name}.png`,width:1200,height:900,camera,background:'#252d2c',...(anim?{animation:anim}:{})});console.log(`Rendered ${name}`);
 }
 let total=0;for(let offset=0;;){const state=await call('get_project_state',{offset,limit:200});assert.equal(state.project.id,project);assert.equal(state.project.saved,true);assert.equal(state.project.cube_count,serial);assert.ok(state.cubes.every(c=>c.texture_ids.includes(texture)));total+=state.cubes.length;if(state.next_offset===null)break;offset=state.next_offset;}
 assert.equal(total,serial);
 fs.writeFileSync(`${dir}/result.json`,JSON.stringify({project,texture,animation,bones:ids,cubes:serial,passed:true},null,2));
 console.log(JSON.stringify({passed:true,project,cubes:serial,bones:bones.length,path:`${dir}/ranger_field_tent.bbmodel`}));
}finally{await client.close();}
