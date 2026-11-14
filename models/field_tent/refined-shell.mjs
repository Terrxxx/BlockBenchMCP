/** Declarative shell geometry; receives local modeling helpers, never host objects. */
export function refinedShell({box,beam,slopePanel}) {
 const tilt=Math.atan2(6,47)*180/Math.PI;
 const outer=y=>54-(y-4)*6/47;
 const door=y=>22-(y-4)*6/45;
 // Flat local wall coordinates; parent bones apply the measured inward lean.
 for(const side of [-1,1]){
  const x=side*54,g=side<0?'wall_left':'wall_right';
  box(g,'canvas_lower',[x-.65,4,-72],[x+.65,32,72],'canvas');
  box(g,'canvas_upper',[x-.65,46,-72],[x+.65,51.4,72],'canvas');
  for(const [a,b]of [[-72,-55],[-33,33],[55,72]])box(g,'canvas_window_pier',[x-.65,32,a],[x+.65,46,b],'canvas');
  for(const z of [-44,44]){
   for(const yy of [32,44])box(g,'window_hem',[x-1,yy,z-12],[x+1,yy+2,z+12],'dark_canvas');
   for(const zz of [z-12,z+10])box(g,'window_hem',[x-1,32,zz],[x+1,46,zz+2],'dark_canvas');
   for(const zz of [z-5,z+1,z+6])box(g,'window_net',[x-.3,34,zz],[x+.3,44,zz+.6],'metal');
   for(const yy of [37,41])box(g,'window_net',[x-.3,yy,z-10],[x+.3,yy+.6,z+10],'metal');
   box(g,'rolled_window_flap',[x-1.5,46,z-13],[x+1.5,49,z+13],'roof');
   for(const zz of [z-9,z+7])box(g,'flap_tie',[x-1.7,45.5,zz],[x+1.7,49.5,zz+1.2],'rope');
  }
  box(g,'recognition_band',[x-1.6,16,-72],[x+1.6,19,72],'cream');
  box(g,'mud_skirt',[x-.9,4,-72],[x+.9,8,72],'dark_canvas');
  // Irregular shallow vertical folds: a narrow dark valley next to a lit lip.
  for(let i=0;i<22;i++){
   const z=-68+i*6.3,top=(Math.abs(z)>30&&Math.abs(z)<57)?29:44+(i%3)*2;
   const xx=x+side*(.8+(i%3)*.12);
   box(g,'cloth_fold_valley',[Math.min(x,xx)-.22,8,z],[Math.max(x,xx)+.22,top,z+.7],'fold_dark');
   box(g,'cloth_fold_lip',[xx-.25,10+(i%4),z+.7],[xx+.25,top-2,z+1.3],i%3===0?'fold_light':'canvas');
  }
  for(const z of [-71,-24,24,70]){
   box(g,'stitched_vertical_seam',[x-1,4,z],[x+1,51,z+1.2],'dark_canvas');
   for(let y=9;y<49;y+=4)box(g,'seam_stitch',[x-1.12,y,z+.35],[x+1.12,y+1.1,z+.8],'hem');
   for(const y of [8,48])box(g,'strap_buckle',[x-1.4,y,z-.3],[x+1.4,y+2,z+1.5],'scuffed_metal');
  }
  const xx=x+side*1.35;
  box(g,'repair_patch',[xx-.2,9,54],[xx+.2,14,63],'patch');
  for(const zz of [54,62])for(let y=9;y<14;y+=1.4)box(g,'patch_stitch',[xx-.3,y,zz],[xx+.3,y+.5,zz+.6],'hem');
  for(let i=0;i<12;i++){const zz=-69+i*11.8;box(g,'mud_splash',[xx-.2,4,zz],[xx+.2,5+(i%4),zz+2.7],'mud');}
  // Wing insignia on the uninterrupted centre panel, well above the band.
  for(const wing of [-1,1])for(let row=0;row<3;row++){
   const a=wing<0?-13+row*2:3,b=wing<0?-3:13-row*2;
   box(g,'wing_mark',[xx-.25,34-row*2,a],[xx+.25,35.4-row*2,b],'cream');
  }
  box(g,'emblem_spine',[xx-.25,27,-1],[xx+.25,38,1],'cream');
  box(g,'emblem_head',[xx-.25,37,-2],[xx+.25,39,2],'cream');
 }
 // Broad roof panels with sub-unit creases, not a flat solid slab.
 const ys=t=>78-27*t-.55*Math.sin(Math.PI*t)*Math.sin(t*Math.PI*6);
 for(const side of [-1,1]){
  for(let panel=0;panel<4;panel++)for(let rib=0;rib<8;rib++){
   const a=rib/8,b=(rib+1)/8,z=-76+panel*38;
   slopePanel('roof','tensioned_roof',side*48*a,ys(a),side*48*b,ys(b),z,z+38,.85,rib%4===1?'fold_light':'roof');
  }
  for(const z of [-75,-38,0,38,75]){
   beam('roof','roof_binding',[side*49,50.8,z],[0,78.4,z],1.35,'dark_canvas');
   for(let t=.12;t<.95;t+=.12){const x=side*48*t,y=ys(t)+.6;box('roof','roof_stitch',[x-.25,y,z-.3],[x+.25,y+.3,z+.4],'hem');}
   box('roof','eave_fastener',[side*48-1.7,49,z-1.7],[side*48+1.7,52.5,z+1.7],'metal');
  }
  beam('roof','rolled_eave',[side*49,50.7,-77],[side*49,50.7,77],2,'hem');
  for(let z=-71;z<74;z+=12)box('roof','eave_tab',[side*49-.6,47.8,z],[side*49+.6,51,z+1.6],'dark_canvas');
 }
 beam('roof','ridge_binding',[0,78.5,-77],[0,78.5,77],1.8,'dark_canvas');
 for(const z of [-76,76])box('roof','ridge_metal_cap',[-2,76.5,z-2],[2,79.5,z+2],'scuffed_metal');
 // Front and back trapezoid panels, stepped only at the silhouette.
 for(const z of [-72,72]){
  const g=z<0?'front_canvas':'rear_canvas';
  for(let y=51;y<78;y+=1){const half=(78-y)*48/27;box(g,'gable_canvas',[-half,y,z-.7],[half,y+1,z+.7],'roof');}
  if(z<0){
   for(let y=4;y<49;y+=1.5)for(const side of [-1,1]){
    const out=outer(y),inn=door(y);box(g,'sloping_door_panel',[side<0?-out:inn,y,z-.7],[side<0?-inn:out,y+1.5,z+.7],y>=16&&y<19?'cream':'canvas');
   }
   box(g,'front_header',[-48,49,z-.7],[48,51,z+.7],'canvas');
   for(const side of [-1,1]){
    beam(g,'gathered_door_fold',[side*23,4,z-1.7],[side*16,49,z-1.7],3.5,'fold_light');
    beam(g,'folded_door_shadow',[side*24.7,4,z-1.9],[side*17.7,49,z-1.9],.9,'fold_dark');
    beam(g,'front_outer_seam',[side*54,4,z-1],[side*48,51,z-1],1.5,'dark_canvas');
    for(let i=0;i<3;i++)beam(g,'front_tension_crease',[side*(30+i*6),6,z-1.05],[side*(20+i*8),46-i*3,z-1.05],.7,'fold_dark');
   }
   // Layered octagonal-looking roll and two wrapping straps.
   box(g,'door_roll_core',[-18.5,49,-76],[18.5,54,-71],'canvas');
   box(g,'door_roll_highlight',[-19,50,-76.5],[19,53,-70.7],'roof');
   beam(g,'roll_edge',[-18,49.3,-76.2],[18,49.3,-76.2],.8,'fold_dark');
   for(const x of [-15,13]){
    box(g,'roll_webbing',[x,48.7,-76.8],[x+1.5,54.4,-70.5],'dark_canvas');
    box(g,'roll_buckle',[x-.2,50.5,-77.3],[x+1.7,52.7,-76.8],'brass');
   }
  }else{
   for(let y=4;y<51;y+=1.5){
    const half=outer(y);const segments=y>=27&&y<42?[[-half,-33],[-17,17],[33,half]]:[[-half,half]];
    for(const [a,b]of segments)box(g,'back_canvas',[a,y,z-.7],[b,y+1.5,z+.7],'canvas');
   }
   for(const x of [-25,25]){
    for(const y of [27,40])box(g,'back_window_hem',[x-9,y,z-1],[x+9,y+2,z+1],'dark_canvas');
    for(const xx of [x-9,x+7])box(g,'back_window_hem',[xx,27,z-1],[xx+2,42,z+1],'dark_canvas');
    beam(g,'back_net',[x-7,29,z],[x+7,40,z],.8,'metal');beam(g,'back_net',[x+7,29,z],[x-7,40,z],.8,'metal');
   }
   beam(g,'back_zipper',[0,4,z+1],[0,76,z+1],.8,'dark_canvas');
  }
 }
 // Exposed doorway braces, collar joints and roof tie bar.
 for(const side of [-1,1]){
  beam('entrance_frame','door_brace',[side*24,3.8,-76],[side*16,51,-75],2.4,'dark_wood');
  beam('entrance_frame','outer_brace',[side*53,3.8,-73.5],[side*47,51,-73.5],1.8,'metal');
  beam('entrance_frame','front_rafter',[side*47,51,-74],[0,77,-74],1.7,'dark_wood');
  for(const t of [.08,.84]){
   const a=[side*(24-8*t),3.8+47.2*t,-76+t];
   beam('entrance_frame','brace_collar',a,[a[0]-.6*side,a[1]+3.8,a[2]],3.1,'scuffed_metal');
   box('entrance_frame','brace_bolt',[a[0]-.55,a[1]+1.2,a[2]-2],[a[0]+.55,a[1]+2.3,a[2]-1.5],'steel');
  }
  box('entrance_frame','brace_foot',[side*24-2,2,-78],[side*24+2,4.5,-73],'scuffed_metal');
 }
 beam('entrance_frame','door_lintel',[-16,50,-75],[16,50,-75],2,'dark_wood');
 for(const z of [-70,-24,24,70]){
  for(const side of [-1,1]){
   beam('frame','leaning_frame',[side*52,4,z],[side*46,50,z],1.8,'metal');
   beam('roof_frame','rafter',[side*46,50,z],[0,76,z],1.8,'metal');
   box('frame','foot',[side*52-2,3,z-2],[side*52+2,5,z+2],'steel');
   box('frame','collar',[side*46-1.5,47,z-1.5],[side*46+1.5,51,z+1.5],'scuffed_metal');
  }
  box('roof_frame','ridge_joint',[-2,74,z-2],[2,78,z+2],'steel');
 }
 for(const x of [-46,46])beam('frame','eave_rail',[x,49,-71],[x,49,71],1.6,'metal');
 beam('roof_frame','ridge_pole',[0,76,-71],[0,76,71],1.8,'metal');
 for(const side of [-1,1])for(const z of [-65,0,65]){
  const start=[side*49,50,z],end=[side*58,1,z===0?8:Math.sign(z)*78];
  beam('guy_ropes','tension_rope',start,end,.75,'rope');
  box('guy_ropes','anchor',[end[0]-1.5,0,end[2]-1.5],[end[0]+1.5,3,end[2]+1.5],'scuffed_metal');
  beam('guy_ropes','anchor_peg',end,[end[0]+side,5,end[2]+1],1,'metal');
  const lerp=t=>start.map((v,i)=>v+(end[i]-v)*t);
  beam('guy_ropes','rope_tensioner',lerp(.3),lerp(.38),1.5,'wood');
 }
 for(const side of [-1,1])box('deck_extension','deck_margin',[side<0?-54:48,1,-72],[side<0?-48:54,3.8,72],'wood');
 return {tilt};
}
