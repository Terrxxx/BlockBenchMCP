import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectRenderPixels } from '../../scripts/render-smoke-check.ts';
const base='models/field_tent',dir=`${base}/aligned`;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result=read(`${dir}/result.json`),model=read(`${dir}/ranger_field_tent_aligned.bbmodel`);
const geo=read(`${dir}/ranger_field_tent_aligned.geo.json`)['minecraft:geometry'][0];
assert.equal(model.elements.length,1218);assert.equal(model.groups.length,21);assert.equal(model.textures.length,1);
assert.equal(geo.bones.reduce((n,b)=>n+(b.cubes?.length??0),0),1218);
assert.equal(hash(`${dir}/field_tent_atlas.png`),hash(`${base}/refined-final/field_tent_atlas.png`));
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
// Independent sequential axis rotations of saved geometry, not the beam solver.
function endpoint(c,y){
 let [x,v,z]=[(c.from[0]+c.to[0])/2-c.origin[0],y-c.origin[1],(c.from[2]+c.to[2])/2-c.origin[2]];
 const [rx,ry,rz]=(c.rotation??[0,0,0]).map(a=>a*Math.PI/180);
 [v,z]=[v*Math.cos(rx)-z*Math.sin(rx),v*Math.sin(rx)+z*Math.cos(rx)];
 [x,z]=[x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];
 [x,v]=[x*Math.cos(rz)-v*Math.sin(rz),x*Math.sin(rz)+v*Math.cos(rz)];
 return [x+c.origin[0],v+c.origin[1],z+c.origin[2]];
}
const nativeByName=new Map(model.elements.map(c=>[c.name,c]));
const savedErrors=result.targets.map(t=>{
 const c=nativeByName.get(t.name);assert.ok(c);
 const error=Math.max(distance(endpoint(c,c.from[1]),t.start),distance(endpoint(c,c.to[1]),t.end));
 assert.ok(error<1e-4,`${t.name}: ${error}`);return error;
});
for(const entry of read(`${base}/refinement-verification.json`).files)assert.equal(hash(`${base}/refined-final/${entry.file}`),entry.sha256,`Refined baseline changed: ${entry.file}`);
const targetIds=new Set(result.aligned.map(b=>b.cube_id));
const original=new Map(result.before.cubes.map(c=>[c.id,c]));
for(const c of result.after.cubes){
 const old=original.get(c.id);assert.ok(old);
 if(!targetIds.has(c.id))assert.deepEqual(c,old);
 else for(const key of ['id','name','parent_id','box_uv','uv_offset','mirror_uv','texture_ids'])assert.deepEqual(c[key],old[key]);
}
assert.deepEqual(result.before.bones,result.after.bones);assert.deepEqual(result.before.textures,result.after.textures);
const views=read(`${base}/refined-final/result.json`).views.filter(([name])=>['exterior','side','front','entrance_detail','interior'].includes(name));
const comparisons=views.map(([name,camera])=>{
 const before=inspectRenderPixels(fs.readFileSync(`${dir}/before_${name}.png`)),after=inspectRenderPixels(fs.readFileSync(`${dir}/${name}.png`));
 assert.equal(before.width,1200);assert.equal(after.width,1200);assert.equal(before.height,900);assert.equal(after.height,900);
 return {name,camera,before_pixel_sha256:before.pixel_sha256,after_pixel_sha256:after.pixel_sha256,changed:before.pixel_sha256!==after.pixel_sha256};
});
assert.ok(comparisons.find(v=>v.name==='side').changed);
const history=['undo','redo'].map(mode=>read(`${dir}/${mode}-verification.json`));
for(const h of history)assert.equal(h.passed,true);
const files=['ranger_field_tent_aligned.bbmodel','ranger_field_tent_aligned.geo.json','ranger_field_tent_aligned.animation.json','field_tent_atlas.png',...comparisons.flatMap(c=>[`${c.name}.png`,`before_${c.name}.png`])].map(file=>({file,bytes:fs.statSync(`${dir}/${file}`).size,sha256:hash(`${dir}/${file}`)}));
const evidence={date_local:'2026-11-14',timezone:'America/Chicago',host:'Blockbench 5.2.2',mcp_version:'0.6.0',transport:'official SDK -> stdio -> desktop plugin',cube_count:1218,bone_count:21,aligned_count:79,untouched_cubes:1139,original_interior_components_preserved:440,max_native_endpoint_error:result.max_endpoint_error,max_saved_endpoint_error:Math.max(...savedErrors),saved_endpoint_tolerance:1e-4,native_probe_directions:9,rotated_parent_probe:true,baseline_files_unchanged:true,computer_use:false,history,gui_reopen_tested:false,in_game_tested:false,comparisons,files};
fs.writeFileSync(`${base}/alignment-verification.json`,JSON.stringify(evidence,null,2));
const labels={exterior:'整体外观',side:'侧面锚点',front:'正面轮廓',entrance_detail:'门口支架',interior:'完整内饰'};
const sections=comparisons.map(({name})=>`<section><h2>${labels[name]}</h2><div class="pair"><figure><img src="before_${name}.png" alt="修复前：${labels[name]}"><figcaption>修复前</figcaption></figure><figure><img src="${name}.png" alt="修复后：${labels[name]}"><figcaption>修复后</figcaption></figure></div></section>`).join('');
fs.writeFileSync(`${dir}/comparison.html`,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>帐篷杆件端点修复</title><style>body{margin:0;background:#202927;color:#eee8d7;font-family:system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:24px}h1{font-size:28px}h2{font-size:20px}p{line-height:1.7}a{color:#d9dca4}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{text-align:center;padding:8px}section{margin:30px 0}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main><h1>帐篷杆件 · 两点对齐修复</h1><p>79 根杆件按端面中心定位，1218 个方块与完整内饰保留。以下为同相机、同尺寸、同背景的 Blockbench 原始渲染。实测整批 Undo/Redo 通过。</p><p><a href="ranger_field_tent_aligned.bbmodel">可编辑工程</a> · <a href="ranger_field_tent_aligned.geo.json">Bedrock 几何</a></p>${sections}</main></html>`);
console.log(JSON.stringify({passed:true,aligned:79,max_native_error:result.max_endpoint_error,max_saved_error:evidence.max_saved_endpoint_error,history:true,views:comparisons.length}));
