import { BridgeError } from '../shared/errors.js';
import type { AnimationHandle, AnimationHost, KeyframeHandle } from './animation-host.js';

export function nativeAnimation(value: AnimationHandle): BBAnimation {
  if (!(value instanceof BBAnimation)) throw new Error('Expected native Animation');
  return value;
}
export function nativeKeyframe(value: KeyframeHandle): BBKeyframe {
  if (!(value instanceof BBKeyframe)) throw new Error('Expected native Keyframe');
  return value;
}
const numeric = (value: unknown): boolean => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
function editable(value: AnimationHandle): boolean {
  const a = nativeAnimation(value);
  if ([a.anim_time_update, a.blend_weight, a.start_delay, a.loop_delay].some(v => v?.trim())) return false;
  return Object.values(a.animators).every(track => track.keyframes.length === 0 || (track instanceof BoneAnimator && track.keyframes.every(f =>
    ['rotation', 'position', 'scale'].includes(f.channel) && ['linear', 'step'].includes(f.interpolation)
    && f.data_points.length === 1 && f.data_points.every(p => numeric(p.x) && numeric(p.y) && numeric(p.z)))));
}
function safePreviewContext(): void {
  // Selection, mode changes and pause can themselves invoke Animator.preview.
  if (AnimationController.all.length || !BBAnimation.all.every(editable)) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Preview/edit selection requires numeric animations and no animation controllers in the project.');
}
/** Canvas.updateAll resets the pose; restore it only for supported numeric clips. */
export function refreshNativeAnimation(): void {
  if (typeof Modes !== 'undefined' && Modes.animate && typeof BBAnimation !== 'undefined'
    && BBAnimation.all.length && AnimationController.all.length === 0 && BBAnimation.all.every(editable)) Animator.preview();
}
function select(value: AnimationHandle): BBAnimation {
  safePreviewContext();
  const a = nativeAnimation(value);
  Timeline.pause();
  a.select();
  for (const other of BBAnimation.all) other.playing = other === a;
  return a;
}
export function nativeAnimationHost(): AnimationHost {
  return {
    animations: () => BBAnimation.all,
    keyframes: a => Object.values(nativeAnimation(a).animators).filter(track => track instanceof BoneAnimator).flatMap(track => track.keyframes),
    animationEditable: editable,
    makeAnimation: input => new BBAnimation({ name: input.name, length: input.length, loop: input.loop, snapping: input.snapping }),
    addAnimation: a => { nativeAnimation(a).add(false); },
    updateAnimation: (a, input) => {
      const options: AnimationOptions = {};
      if (input.name !== undefined) options.name = input.name;
      if (input.length !== undefined) options.length = input.length;
      if (input.loop !== undefined) options.loop = input.loop;
      if (input.snapping !== undefined) options.snapping = input.snapping;
      nativeAnimation(a).extend(options);
    },
    prepareAnimationEdit: (value, boneIds) => {
      const a = select(value);
      for (const id of boneIds) {
        const bone = Group.all.find(g => g.uuid === id);
        if (!bone) throw new Error('Bone disappeared');
        const track = a.getBoneAnimator(bone);
        if (!track) throw new Error('Bone animator unavailable');
        track.addToTimeline();
      }
    },
    putKeyframe: (value, input, existing) => {
      const options: KeyframeOptions = { channel: input.channel, time: input.time, interpolation: input.interpolation,
        data_points: [{ x: input.value[0], y: input.value[1], z: input.value[2] }], uniform: false };
      if (existing) return nativeKeyframe(existing).extend(options);
      const bone = Group.all.find(g => g.uuid === input.bone_id);
      if (!bone) throw new Error('Bone disappeared');
      const track = nativeAnimation(value).getBoneAnimator(bone);
      if (!track) throw new Error('Bone animator unavailable');
      return track.addKeyframe(options);
    },
    removeKeyframe: f => { nativeKeyframe(f).remove(); },
    previewAnimation: (value, time) => {
      select(value);
      const mode = Modes.options.animate;
      if (!mode) throw new BridgeError('UNSUPPORTED_HOST', 'Animate mode unavailable.');
      mode.select();
      Timeline.setTime(time);
      Animator.preview();
      return Timeline.time;
    },
  };
}
