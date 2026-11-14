import { BridgeError } from '../shared/errors.js';
import type { RenderInput } from '../shared/schemas/render.js';
import type { AnimationHandle } from './animation-host.js';
import { nativeAnimation } from './native-animation.js';

export function renderNativePng(input: RenderInput, value?: AnimationHandle): string {
  if(typeof MediaPreview==='undefined' || !MediaPreview.offscreen || MediaPreview===Preview.selected)throw new BridgeError('UNSUPPORTED_HOST','Official offscreen media viewport is unavailable.');
  if (AnimationController.all.length || Outliner.elements.some(e=>!(e instanceof Cube))) throw new BridgeError('UNSUPPORTED_ANIMATION','Rendering supports cube/bone projects without controllers or IK only.');
  const clip=value ? nativeAnimation(value) : undefined;
  const tracks=clip ? Object.values(clip.animators) : [];
  for(const track of tracks) {
    if (!(track instanceof BoneAnimator) || track.rotation_global) throw new BridgeError('UNSUPPORTED_ANIMATION','Rendering requires local bone transform tracks.');
    if (!Group.all.some(g=>g.uuid===track.uuid)) throw new BridgeError('NOT_FOUND','Render animation refers to a missing bone.');
  }
  const scene=Canvas.scene;
  const nodes: THREE.Object3D[]=[];
  scene.traverse(node=>nodes.push(node));
  if(nodes.length>16384)throw new BridgeError('RENDER_FAILED','Scene exceeds 16384 render nodes.');
  const snapshots=nodes.map(node=>({node,position:node.position.clone(),rotation:node.rotation.clone(),scale:node.scale.clone(),visible:node.visible}));
  const background=scene.background;
  const time=Timeline.time;
  const lastValues={...Animator._last_values};
  const context=Animator.MolangParser.context;
  const hadAnimation=Object.hasOwn(context,'animation');
  const contextAnimation:unknown=context.animation;
  const groups=tracks.map(track=>({track:track as BoneAnimator,group:(track as BoneAnimator).group}));
  // Use the existing media viewport. In 5.2.2 OrbitControls.dispose references
  // an undefined onContextMenu; creating per-request controls would leak them.
  const preview=MediaPreview;
  const viewport={width:preview.width,height:preview.height,isOrtho:preview.isOrtho,
    perspective:preview.camPers.clone(),orthographic:preview.camOrtho.clone(),
    target:preview.controls.target.clone() as THREE.Vector3,object:preview.controls.object as unknown,
    hadUnlinked:Object.hasOwn(preview.controls,'unlinked'),unlinked:preview.controls.unlinked as unknown,
    pixelRatio:preview.renderer.getPixelRatio(),size:preview.renderer.getSize(preview.mouse.clone()),
    clearColor:preview.renderer.getClearColor(Canvas.global_light_color.clone()),clearAlpha:preview.renderer.getClearAlpha()};
  try {
    preview.setProjectionMode(input.camera.projection==='orthographic');
    preview.renderer.setPixelRatio(1);
    preview.resize(input.width,input.height);
    // OrbitControls captures its initial up axis; unlink it so top views and
    // explicit camera coordinates cannot be clamped or rotated during render.
    preview.controls.unlinked=true;
    const camera=preview.camera;
    camera.position.fromArray(input.camera.position);
    camera.up.fromArray(input.camera.up).normalize();
    preview.controls.target.fromArray(input.camera.target);
    camera.lookAt(preview.controls.target);
    camera.near=0.01;camera.far=200000;
    if(input.camera.projection==='perspective')preview.setFOV(input.camera.fov);
    else {
      const ortho=preview.camOrtho;
      ortho.top=input.camera.vertical_size/2;ortho.bottom=-ortho.top;
      ortho.right=ortho.top*input.width/input.height;ortho.left=-ortho.right;ortho.zoom=1;
    }
    camera.updateProjectionMatrix();
    preview.renderer.setClearColor(input.background==='transparent'?0:input.background,input.background==='transparent'?0:1);
    scene.background=null;
    const keep=new Set<THREE.Object3D>();
    Project.model_3d.traverse(node=>keep.add(node));
    const ancestors=(node:THREE.Object3D):void=>{for(let current:THREE.Object3D|null=node;current;current=current.parent)keep.add(current);};
    ancestors(Project.model_3d);
    for(const node of nodes)if('isLight' in node && node.isLight===true)ancestors(node);
    for(const node of nodes)if(!keep.has(node))node.visible=false;
    Animator.showDefaultPose(true);
    if(clip) {
      Timeline.time=input.animation!.time;
      for(const track of tracks) {
        Animator.resetLastValues();
        (track as BoneAnimator).displayFrame(1);
      }
    }
    scene.updateMatrixWorld(true);
    let png:string|undefined;
    Screencam.screenshotPreview(preview,{crop:false,width:input.width,height:input.height},data=>{png=data;});
    if(!png)throw new BridgeError('RENDER_FAILED','Official screenshot callback did not produce a PNG.');
    return png;
  } finally {
    // Restore even when native screenshot helpers swallow a renderer exception.
    let failed=false;
    const failures:string[]=[];
    const restore=(step:string,action:()=>void):void=>{try{action();}catch{failed=true;failures.push(step);}};
    for(const s of snapshots)restore('pose',()=>{s.node.position.copy(s.position);s.node.rotation.copy(s.rotation);s.node.scale.copy(s.scale);s.node.visible=s.visible;});
    restore('scene/time',()=>{scene.background=background;Timeline.time=time;});
    restore('interpolation',()=>{
      for(const key of Object.keys(Animator._last_values))delete Animator._last_values[key];
      Object.assign(Animator._last_values,lastValues);
      if(hadAnimation)context.animation=contextAnimation;else delete context.animation;
    });
    for(const saved of groups)restore('track',()=>{saved.track.group=saved.group;});
    restore('matrices',()=>{scene.updateMatrixWorld(true);});
    restore('camera',()=>{
      preview.camPers.copy(viewport.perspective,false);preview.camOrtho.copy(viewport.orthographic,false);
      preview.isOrtho=viewport.isOrtho;preview.width=viewport.width;preview.height=viewport.height;
      preview.controls.object=viewport.object;preview.controls.target.copy(viewport.target);
      if(viewport.hadUnlinked)preview.controls.unlinked=viewport.unlinked;else delete preview.controls.unlinked;
    });
    restore('renderer',()=>{
      preview.renderer.setPixelRatio(viewport.pixelRatio);preview.renderer.setSize(viewport.size.x,viewport.size.y);
      preview.renderer.setClearColor(viewport.clearColor,viewport.clearAlpha);
    });
    if(failed)throw new BridgeError('RENDER_FAILED',`Render restoration failed (${[...new Set(failures)].join(', ')}); inspect the application before retrying.`,true);
  }
}
