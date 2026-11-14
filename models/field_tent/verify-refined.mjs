import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectPng } from '../../src/shared/png.ts';
import { inspectRenderPixels } from '../../scripts/render-smoke-check.ts';
const base='models/field_tent',dir=`${base}/refined-final`;
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const plan=json(`${dir}/recipe.json`),result=json(`${dir}/result.json`),model=json(`${dir}/ranger_field_tent.bbmodel`);
const geo=json(`${dir}/ranger_field_tent.geo.json`)['minecraft:geometry'][0];
assert.equal(model.elements.length,1218);assert.equal(model.groups.length,21);
assert.equal(geo.bones.reduce((n,b)=>n+(b.cubes?.length??0),0),1218);
assert.equal(model.textures.length,1);assert.deepEqual(inspectPng(fs.readFileSync(`${dir}/field_tent_atlas.png`)),{width:2048,height:2048});
const rounded=a=>a.map(v=>Math.round(v*1e8)/1e8);
const byName=new Map(model.elements.map(c=>[c.name,c]));
for(const cubes of Object.values(plan.groups))for(const c of cubes){
 const native=byName.get(c.name);assert.ok(native,c.name);
 for(const field of ['from','to','origin','rotation','uv_offset']){
  const actual=native[field]??[0,0,0];assert.equal(actual.length,c[field].length);
  assert.ok(actual.every((v,i)=>Math.abs(v-c[field][i])<=1e-5),`${c.name}.${field}: official save precision`);
 }
 assert.ok(c.uv_offset[0]%512>=4&&c.uv_offset[1]%256>=4);
}
for(const [name,sign]of [['wall_left',1],['wall_right',-1]]){
 const bone=model.groups.find(g=>g.name===name);assert.ok(bone);
 assert.ok(Math.abs(bone.rotation[2]-sign*result.wall_tilt)<1e-5);
}
const baselineVerification=json(`${base}/verification.json`);
for(const entry of baselineVerification.files)assert.equal(hash(`${base}/final/${entry.file}`),entry.sha256,`Baseline changed: ${entry.file}`);
const source=json(`${base}/final/recipe.json`);
const normalized=(c,shift=0)=>({name:c.name.replace(/_\d+$/,''),from:rounded(c.from.map((v,i)=>v+(i===0?shift:0))),to:rounded(c.to.map((v,i)=>v+(i===0?shift:0))),origin:rounded(c.origin.map((v,i)=>v+(i===0?shift:0))),rotation:rounded(c.rotation)});
const interior=result.interior_preserved.map(group=>{
 assert.deepEqual(plan.groups[group].map(c=>normalized(c)),source.groups[group].map(c=>normalized(c,group==='storage'?3.5:0)));
 return {group,cubes:plan.groups[group].length,translation:group==='storage'?[3.5,0,0]:[0,0,0]};
});
const comparisons=result.views.map(([name,camera,cutaway])=>{
 const before=inspectRenderPixels(fs.readFileSync(`${dir}/before_${name}.png`)),after=inspectRenderPixels(fs.readFileSync(`${dir}/${name}.png`));
 assert.equal(before.width,1200);assert.equal(after.width,1200);assert.equal(before.height,900);assert.equal(after.height,900);
 assert.notEqual(before.pixel_sha256,after.pixel_sha256);
 return {name,camera,cutaway:!!cutaway,before_pixel_sha256:before.pixel_sha256,after_pixel_sha256:after.pixel_sha256};
});
const files=['ranger_field_tent.bbmodel','ranger_field_tent.geo.json','ranger_field_tent.animation.json','field_tent_atlas.png',...comparisons.flatMap(c=>[`${c.name}.png`,`before_${c.name}.png`])].map(file=>({file,bytes:fs.statSync(`${dir}/${file}`).size,sha256:hash(`${dir}/${file}`)}));
const evidence={date_local:'2026-11-14',timezone:'America/Chicago',host:'Blockbench 5.2.2',mcp_version:'0.5.0',cube_count:1218,bone_count:21,wall_tilt_degrees:result.wall_tilt,interior,interior_cube_count:interior.reduce((n,g)=>n+g.cubes,0),original_files_unchanged:true,native_geometry_matches_recipe:true,official_save_numeric_tolerance:1e-5,computer_use:false,gui_undo_redo_reopen_tested:false,in_game_tested:false,comparisons,files};
fs.writeFileSync(`${base}/refinement-verification.json`,JSON.stringify(evidence,null,2));
const labels={exterior:'整体外观',front:'正面轮廓',side:'侧面帆布',entrance_detail:'门口支架',interior:'完整内饰',cutaway:'剖视布局',back:'后视'};
const buttons=Object.entries(labels).map(([key,label])=>`<button data-view="${key}" ${key==='exterior'?'aria-pressed="true"':'aria-pressed="false"'}>${label}</button>`).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>帐篷细化 · 同机位对比</title>
<style>*{box-sizing:border-box}body{margin:0;background:#18201e;color:#ececdb;font-family:system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:28px}h1{font-size:28px;margin:0 0 8px}p{color:#bdc7b8;line-height:1.6}nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button{border:1px solid #5e6b54;border-radius:7px;background:#28322a;color:inherit;padding:10px 15px;cursor:pointer}button[aria-pressed=true]{background:#a2b475;color:#18201e}.stage{position:relative;aspect-ratio:4/3;background:#252d2c;overflow:hidden;border:1px solid #5e6b54;border-radius:9px}.stage img{display:block;width:100%;height:100%;object-fit:contain}.before{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}.line{position:absolute;top:0;bottom:0;left:50%;border-left:2px solid #f0d99b;pointer-events:none}.label{position:absolute;top:16px;padding:7px 10px;background:#172019dd;border-radius:5px}.left{left:16px}.right{right:16px}input{width:100%;accent-color:#b8c58b;margin:18px 0}footer{font-size:14px;color:#bbc6b4}a{color:#e7d7a0}.stats{display:flex;gap:30px;flex-wrap:wrap}.stats b{font-size:22px;color:#e5dfbe}</style>
<main><h1>野外指挥帐篷 · 细化前后</h1><p>左侧为初版，右侧为细化版。拖动滑块对照原始 MCP 渲染；两图的相机、尺寸和背景一致。</p><div class="stats"><span>方块 <b>702 → 1218</b></span><span>侧墙内倾 <b>7.28°</b></span><span>保留原有构件 <b>440</b></span></div><nav>${buttons}</nav><div class="stage"><img id="after" src="exterior.png" alt="细化后"><img class="before" id="before" src="before_exterior.png" alt="细化前"><div class="line" id="line"></div><span class="label left">初版</span><span class="label right">细化版</span></div><label for="slider">对比分界</label><input id="slider" type="range" min="0" max="100" value="50"><footer>倾斜侧墙 · 浅褶皱与缝线 · 梯形门口支架 · 4px 材质留边。帆布为方块近似，不是布料模拟。<p><a href="ranger_field_tent.bbmodel">可编辑工程</a> · <a href="ranger_field_tent.geo.json">Bedrock 几何</a></p></footer></main>
<script>const before=document.getElementById('before'),after=document.getElementById('after'),line=document.getElementById('line'),slider=document.getElementById('slider');slider.addEventListener('input',()=>{before.style.clipPath='inset(0 '+(100-Number(slider.value))+'% 0 0)';line.style.left=slider.value+'%'});document.querySelectorAll('button[data-view]').forEach(button=>button.addEventListener('click',()=>{before.src='before_'+button.dataset.view+'.png';after.src=button.dataset.view+'.png';document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)))}));</script></html>`;
fs.writeFileSync(`${dir}/comparison.html`,html);
console.log(JSON.stringify({passed:true,cubes:1218,bones:21,interior_preserved:evidence.interior_cube_count,matched_views:comparisons.length,original_files_unchanged:true}));
