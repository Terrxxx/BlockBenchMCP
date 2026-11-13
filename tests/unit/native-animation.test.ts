import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { nativeAnimationHost, refreshNativeAnimation } from '../../src/plugin/native-animation.js';
import { createNativeHost } from '../../src/plugin/native-host.js';
import type { AnimationHandle, KeyframeHandle } from '../../src/plugin/animation-host.js';

class NativeFrame implements KeyframeHandle {
  uuid=randomUUID(); time=0; channel='rotation'; interpolation='linear'; animator={uuid:randomUUID()};
  data_points: Record<string,unknown>[]=[{x:'0',y:'0',z:'0'}];
  extend=vi.fn((options: Partial<KeyframeHandle>)=> { Object.assign(this,options); return this; });
  remove=vi.fn();
}
class Track {
  uuid=randomUUID(); keyframes: NativeFrame[]=[];
  addToTimeline=vi.fn();
  addKeyframe=vi.fn((options: Partial<KeyframeHandle>)=> {
    const f=new NativeFrame().extend(options); f.animator=this; this.keyframes.push(f); return f;
  });
}
class Clip implements AnimationHandle {
  static all:Clip[]=[];
  uuid=randomUUID(); name='animation.test.wave'; length=2; loop:'once'|'loop'|'hold'='once'; snapping=20;
  animators:Record<string,Track>={}; playing=false;
  anim_time_update=''; blend_weight=''; start_delay=''; loop_delay='';
  select=vi.fn(); add=vi.fn(); extend=vi.fn();
  constructor(options:Partial<Clip>={}) { Object.assign(this,options); }
  getBoneAnimator(bone:{uuid:string}): Track { return this.animators[bone.uuid] ??= new Track(); }
}
beforeEach(()=> {
  vi.stubGlobal('BBAnimation',Clip);vi.stubGlobal('BBKeyframe',NativeFrame); vi.stubGlobal('BoneAnimator',Track);
  vi.stubGlobal('AnimationController',{all:[]}); Clip.all=[];
  vi.stubGlobal('Timeline',{time:0,pause:vi.fn(),setTime:vi.fn((time:number)=>{Timeline.time=time;})});
  vi.stubGlobal('Animator',{preview:vi.fn()}); vi.stubGlobal('Modes',{options:{animate:{select:vi.fn()}}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('native animation API seam',()=> {
  it('restores the animated pose after Canvas refresh and skips unsupported contexts',()=> {
    const a=new Clip();Clip.all=[a];vi.stubGlobal('Modes',{animate:true});
    vi.stubGlobal('Canvas',{updateAll:vi.fn()});
    createNativeHost().refresh();
    expect(Canvas.updateAll).toHaveBeenCalledOnce();expect(Animator.preview).toHaveBeenCalledOnce();
    expect(vi.mocked(Canvas.updateAll).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(Animator.preview).mock.invocationCallOrder[0]!);
    a.blend_weight='query.anim_time';refreshNativeAnimation();expect(Animator.preview).toHaveBeenCalledTimes(1);
  });
  it('prepares explicit animation and tracks before keyframe Undo',()=> {
    const a=new Clip();Clip.all=[a]; const bone={uuid:randomUUID()};vi.stubGlobal('Group',{all:[bone]});
    const host=nativeAnimationHost();host.prepareAnimationEdit(a,[bone.uuid]);
    expect(Timeline.pause).toHaveBeenCalledOnce();expect(a.select).toHaveBeenCalledOnce();
    expect(a.animators[bone.uuid]!.addToTimeline).toHaveBeenCalledOnce();
    const created=host.putKeyframe(a,{bone_id:bone.uuid,channel:'position',time:0.12345,value:[1,2,3],interpolation:'step'});
    expect(created.time).toBe(0.12345);expect(created.data_points).toEqual([{x:1,y:2,z:3}]);
    const updated=host.putKeyframe(a,{bone_id:bone.uuid,channel:'position',time:0.12345,value:[3,2,1],interpolation:'linear'},created);
    expect(updated).toBe(created);expect(a.animators[bone.uuid]!.addKeyframe).toHaveBeenCalledOnce();
    host.removeKeyframe(created);expect((created as NativeFrame).remove).toHaveBeenCalledOnce();
  });
  it('maps animation/keyframe Undo aspects to original native instances',()=> {
    const a=new Clip();const f=new NativeFrame(); const before={sentinel:'unchanged'};
    const undo={initEdit:vi.fn(),finishEdit:vi.fn(),cancelEdit:vi.fn(),current_save:{aspects:{},keyframes:before}};
    vi.stubGlobal('Undo',undo);
    const host=createNativeHost(); host.beginEdit({elements:[],animations:[]});
    host.finishEdit('create',{elements:[],animations:[a]});
    host.cancelEdit({elements:[],keyframes:[f]});
    expect(undo.initEdit).toHaveBeenCalledWith({elements:[],animations:[]});
    expect(undo.finishEdit).toHaveBeenCalledWith('create',{elements:[],animations:[a]});
    expect(undo.current_save.aspects).toEqual({elements:[],keyframes:[f]});
    expect(undo.current_save.keyframes).toBe(before);expect(undo.cancelEdit).toHaveBeenCalledWith(true);
  });
  it('accepts native numeric strings but blocks expressions, effect tracks and unsupported interpolation',()=> {
    const a=new Clip();const t=new Track();const f=new NativeFrame();t.keyframes=[f];a.animators[t.uuid]=t;
    const host=nativeAnimationHost();expect(host.animationEditable(a)).toBe(true);
    f.data_points[0]!.x='query.anim_time'; expect(host.animationEditable(a)).toBe(false);
    f.data_points[0]!.x='1';f.interpolation='bezier';expect(host.animationEditable(a)).toBe(false);
    f.interpolation='linear';a.blend_weight='1';expect(host.animationEditable(a)).toBe(false);
    a.blend_weight='';a.animators.effects={keyframes:[f]} as Track;expect(host.animationEditable(a)).toBe(false);
  });
  it('checks the whole preview context before pause can evaluate other tracks',()=> {
    const safe=new Clip();const unsafe=new Clip();unsafe.anim_time_update='query.anim_time';Clip.all=[safe,unsafe];
    expect(()=>nativeAnimationHost().previewAnimation(safe,0.5)).toThrow('numeric');
    expect(Timeline.pause).not.toHaveBeenCalled();expect(safe.select).not.toHaveBeenCalled();
    Clip.all=[safe];vi.stubGlobal('AnimationController',{all:[{}]});
    expect(()=>nativeAnimationHost().prepareAnimationEdit(safe,[])).toThrow('controllers');
    expect(Timeline.pause).not.toHaveBeenCalled();
  });
  it('pauses and previews one clip using the official mode and exact time',()=> {
    const a=new Clip();const b=new Clip();b.playing=true;Clip.all=[a,b];
    expect(nativeAnimationHost().previewAnimation(a,0.5)).toBe(0.5);
    expect(a.playing).toBe(true);expect(b.playing).toBe(false);
    expect(Modes.options.animate!.select).toHaveBeenCalledOnce();expect(Animator.preview).toHaveBeenCalledOnce();
  });
});
