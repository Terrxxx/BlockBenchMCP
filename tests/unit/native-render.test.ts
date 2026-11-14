import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderNativePng } from '../../src/plugin/native-render.js';
import { renderInput } from '../../src/shared/schemas/render.js';
import type { AnimationHandle } from '../../src/plugin/animation-host.js';

class Vector {
  constructor(public x=0,public y=0,public z=0){}
  clone(){return new Vector(this.x,this.y,this.z);}
  copy(v:Vector){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  fromArray(v:number[]){this.x=v[0]!;this.y=v[1]!;this.z=v[2]!;return this;}
  normalize(){const n=Math.hypot(this.x,this.y,this.z);this.x/=n;this.y/=n;this.z/=n;return this;}
}
class Node {
  position=new Vector();rotation=new Vector();scale=new Vector(1,1,1);visible=true;parent:Node|null=null;children:Node[]=[];
  add(node:Node){this.children.push(node);node.parent=this;return node;}
  traverse(cb:(n:Node)=>void){cb(this);this.children.forEach(n=>n.traverse(cb));}
  updateMatrixWorld=vi.fn();
}
class Camera {
  position=new Vector();up=new Vector(0,1,0);near=1;far=100;zoom=0.5;top=1;bottom=-1;left=-1;right=1;lookAt=vi.fn();updateProjectionMatrix=vi.fn();
  clone(){return new Camera().copy(this);}
  copy(other:Camera){this.position.copy(other.position);this.up.copy(other.up);for(const key of ['near','far','zoom','top','bottom','left','right'] as const)this[key]=other[key];return this;}
}
class PreviewStub {
  static instances:PreviewStub[]=[]; static selected={userViewport:true};
  offscreen=true;width=0;height=0;mouse=new Vector();
  camPers=new Camera();camOrtho=new Camera();isOrtho=false;
  controls={target:new Vector(),object:this.camPers,unlinked:false,dispose:vi.fn(()=>{throw new ReferenceError('onContextMenu is not defined');})};
  renderer={setPixelRatio:vi.fn(),setClearColor:vi.fn(),setSize:vi.fn(),getPixelRatio:()=>2,getSize:(v:Vector)=>v.copy(new Vector(500,400)),getClearColor:(v:Vector)=>v.copy(new Vector(1,1,1)),getClearAlpha:()=>0.3};
  resize=vi.fn();setFOV=vi.fn();delete=vi.fn();
  constructor(public options:unknown){PreviewStub.instances.push(this);}
  get camera(){return this.isOrtho?this.camOrtho:this.camPers;}
  setProjectionMode(value:boolean){this.isOrtho=value;}
}
let bone:Node;let timeline:{time:number};
class Track {
  uuid='bone';rotation_global=false;group:unknown='prior-cache';
  displayFrame(){this.group='temporary-cache';bone.position.x=timeline.time*10;}
}
class Clip implements AnimationHandle {
  uuid='clip';name='animation.render.test';length=2;loop='once' as const;snapping=20;animators={bone:new Track()};
}
const input=()=>renderInput.parse({project_id:'11111111-1111-1111-1111-111111111111',path:'render.png',width:64,height:128,
  camera:{projection:'orthographic',position:[0,40,0],target:[0,8,0],up:[0,0,-1],vertical_size:32}});
let scene:Node&{background:unknown};let helper:Node;let light:Node;let context:Record<string,unknown>;let values:Record<string,number[]>;
beforeEach(()=>{
  PreviewStub.instances=[];scene=Object.assign(new Node(),{background:{original:true}});const model=scene.add(new Node());bone=model.add(new Node());bone.position.x=7;
  helper=scene.add(new Node());light=scene.add(Object.assign(new Node(),{isLight:true}));timeline={time:42};context={animation:'prior'};values={rotation:[1,2,3]};
  vi.stubGlobal('Canvas',{scene,global_light_color:new Vector(1,1,1)});vi.stubGlobal('Project',{model_3d:model});vi.stubGlobal('Preview',PreviewStub);vi.stubGlobal('MediaPreview',new PreviewStub({offscreen:true}));
  vi.stubGlobal('AnimationController',{all:[]});vi.stubGlobal('Outliner',{elements:[]});vi.stubGlobal('Cube',class {});vi.stubGlobal('Group',{all:[{uuid:'bone'}]});
  vi.stubGlobal('BBAnimation',Clip);vi.stubGlobal('BoneAnimator',Track);vi.stubGlobal('Timeline',timeline);
  vi.stubGlobal('Animator',{_last_values:values,MolangParser:{context},resetLastValues:()=>{values.rotation=[0,0,0];context.animation='temporary';},showDefaultPose:()=>{bone.position.x=0;}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('native offscreen render restoration',()=>{
  it('uses a dedicated top-view camera, hides helpers and restores rest-pose capture',()=>{
    const before=scene.background;
    vi.stubGlobal('Screencam',{screenshotPreview:(preview:PreviewStub,options:unknown,callback:(s:string)=>void)=>{
      expect(bone.position.x).toBe(0);expect(helper.visible).toBe(false);expect(light.visible).toBe(true);expect(scene.background).toBeNull();
      expect(preview.controls.unlinked).toBe(true);expect(preview.camera.up).toEqual(new Vector(0,0,-1));
      expect(preview.camOrtho.top).toBe(16);expect(preview.camOrtho.right).toBe(8);
      expect(options).toEqual({crop:false,width:64,height:128});callback('data:image/png;base64,render');
    }});
    expect(renderNativePng(input())).toContain('data:image/png');expect(bone.position.x).toBe(7);expect(helper.visible).toBe(true);expect(scene.background).toBe(before);expect(timeline.time).toBe(42);
    const restored=PreviewStub.instances[0]!;expect(restored.isOrtho).toBe(false);expect(restored.camera.position).toEqual(new Vector());expect(restored.controls.unlinked).toBe(false);
    expect(restored.renderer.setPixelRatio).toHaveBeenLastCalledWith(2);expect(restored.renderer.setSize).toHaveBeenLastCalledWith(500,400);expect(restored.renderer.setClearColor).toHaveBeenLastCalledWith(new Vector(1,1,1),0.3);
    expect(PreviewStub.instances[0]!.controls.dispose).not.toHaveBeenCalled();expect(PreviewStub.instances[0]!.delete).not.toHaveBeenCalled();
  });
  it('samples only supplied tracks at the requested time and restores interpolation context',()=>{
    const clip=new Clip();const prior=values.rotation;
    vi.stubGlobal('Screencam',{screenshotPreview:(_p:unknown,_o:unknown,callback:(s:string)=>void)=>{expect(bone.position.x).toBe(5);callback('png');}});
    renderNativePng({...input(),animation:{animation_id:clip.uuid,time:0.5}},clip);
    expect(bone.position.x).toBe(7);expect(timeline.time).toBe(42);expect(values.rotation).toBe(prior);expect(context.animation).toBe('prior');expect(clip.animators.bone.group).toBe('prior-cache');
  });
  it.each(['throw','no-callback'])('restores pose, background and media viewport on screenshot %s',mode=>{
    const before=scene.background;
    vi.stubGlobal('Screencam',{screenshotPreview:()=>{if(mode==='throw')throw new Error('GPU lost');}});
    expect(()=>renderNativePng(input())).toThrow();expect(bone.position.x).toBe(7);expect(scene.background).toBe(before);expect(helper.visible).toBe(true);
    expect(PreviewStub.instances[0]!.delete).not.toHaveBeenCalled();
  });
  it('continues restoring independent state and media viewport after one restore error',()=>{
    vi.stubGlobal('Screencam',{screenshotPreview:(_p:unknown,_o:unknown,callback:(s:string)=>void)=>{
      bone.position.copy=()=>{throw new Error('restore failed');};timeline.time=99;callback('png');
    }});
    expect(()=>renderNativePng(input())).toThrow(expect.objectContaining({code:'RENDER_FAILED',outcomeUnknown:true}));
    expect(timeline.time).toBe(42);expect(helper.visible).toBe(true);expect(PreviewStub.instances[0]!.delete).not.toHaveBeenCalled();
  });
  it('rejects unsupported tracks/controllers without creating another viewport',()=>{
    const clip=new Clip();clip.animators.bone.rotation_global=true;
    expect(()=>renderNativePng(input(),clip)).toThrow('local bone');
    vi.stubGlobal('AnimationController',{all:[{}]});expect(()=>renderNativePng(input())).toThrow('controllers');expect(PreviewStub.instances).toHaveLength(1);
  });
});
