import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput } from '../shared/protocol.js';
import type { BlockbenchHost, ProjectHandle } from './host.js';
import type { AnimationHandle, KeyframeHandle } from './animation-host.js';
import { edit } from './edits.js';

function find(host: BlockbenchHost, id: string): AnimationHandle {
  const animation = host.animations().find(a => a.uuid === id);
  if (!animation) throw new BridgeError('NOT_FOUND', 'Animation not found in the active project.');
  return animation;
}
function editable(host: BlockbenchHost, animation: AnimationHandle): void {
  if (!host.animationEditable(animation)) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Only numeric bone transform animations with linear/step interpolation are editable or previewable.');
  if (host.keyframes(animation).length > 4096) throw new BridgeError('ANIMATION_LIMIT', 'Animation exceeds 4096 keyframes.');
}
function uniqueName(host: BlockbenchHost, name: string, except?: string): void {
  if (host.animations().some(a => a.uuid !== except && a.name === name)) throw new BridgeError('NAME_CONFLICT', 'Animation name already exists.');
}
function summary(host: BlockbenchHost, a: AnimationHandle): ToolOutput<'create_animation'>['animation'] {
  return { id: a.uuid, name: a.name, length: a.length, loop: a.loop, snapping: a.snapping,
    keyframe_count: host.keyframes(a).length, editable: host.animationEditable(a) };
}
export function createAnimation(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'create_animation'>): ToolOutput<'create_animation'> {
  uniqueName(host, input.name);
  if (host.animations().length >= 128) throw new BridgeError('ANIMATION_LIMIT', 'Project already contains 128 animations.');
  const animations: AnimationHandle[] = [];
  return edit(host, project, 'Blockbench AI: Create animation', { elements: [], animations: [] }, () => ({ elements: [], animations }), () => {
    const a = host.makeAnimation(input); animations.push(a); host.addAnimation(a);
    return { project_id: project.uuid, animation: summary(host, a) };
  });
}
export function updateAnimation(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'update_animation'>): ToolOutput<'update_animation'> {
  const a = find(host, input.animation_id); editable(host, a);
  if (input.name) uniqueName(host, input.name, a.uuid);
  if (input.length !== undefined && host.keyframes(a).some(f => f.time > input.length!)) throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS', 'Length cannot precede the final keyframe.');
  const scope = { elements: [], animations: [a] };
  return edit(host, project, 'Blockbench AI: Update animation', scope, () => scope, () => {
    host.updateAnimation(a, input); return { project_id: project.uuid, animation: summary(host, a) };
  });
}
export function setKeyframes(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'set_keyframes'>): ToolOutput<'set_keyframes'> {
  const a = find(host, input.animation_id); editable(host, a);
  const frames = host.keyframes(a);
  const plan = input.keyframes.map(spec => {
    if (!host.groups().some(g => g.uuid === spec.bone_id)) throw new BridgeError('NOT_FOUND', 'Bone not found.');
    if (spec.time > a.length) throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS', 'Keyframe time exceeds animation length.');
    const matches = frames.filter(f => f.animator.uuid === spec.bone_id && f.channel === spec.channel && Math.abs(f.time - spec.time) < 1e-7);
    if (matches.length > 1 || (matches[0] && matches[0].time !== spec.time)) throw new BridgeError('KEYFRAME_CONFLICT', 'An ambiguous or nearly coincident keyframe exists.');
    return { spec, existing: matches[0] };
  });
  for (let i = 0; i < plan.length; i++) for (const other of plan.slice(i + 1)) {
    const f = plan[i]!.spec; const g = other.spec;
    if (f.bone_id === g.bone_id && f.channel === g.channel && Math.abs(f.time - g.time) < 1e-7) throw new BridgeError('KEYFRAME_CONFLICT', 'Batch times are too close.');
  }
  const created = plan.filter(p => !p.existing).length;
  if (frames.length + created > 4096) throw new BridgeError('ANIMATION_LIMIT', 'Animation would exceed 4096 keyframes.');
  host.prepareAnimationEdit(a, [...new Set(input.keyframes.map(f => f.bone_id))]);
  // Re-enumerate native frames: a hook can throw after inserting a frame but
  // before putKeyframe returns its handle to the controller.
  // Animation snapshots also reconstruct tracks when Redo first recreates a
  // previously removed clip. Native keyframe restore skips missing animators.
  // prepareAnimationEdit created all target tracks before the before-snapshot.
  const scope = () => ({ elements: [], animations: [a], keyframes: [...host.keyframes(a)] });
  return edit(host, project, 'Blockbench AI: Set keyframes', scope(), scope, () => {
    const ids = plan.map(({ spec, existing }) => {
      const frame = host.putKeyframe(a, spec, existing);
      return frame.uuid;
    });
    return { project_id: project.uuid, animation_id: a.uuid, keyframe_ids: ids, created, updated: plan.length - created };
  });
}
export function deleteKeyframes(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'delete_keyframes'>): ToolOutput<'delete_keyframes'> {
  const a = find(host, input.animation_id); editable(host, a);
  const frames = host.keyframes(a);
  const removed = input.keyframe_ids.map(id => {
    const frame = frames.find(f => f.uuid === id);
    if (!frame) throw new BridgeError('NOT_FOUND', 'Keyframe not found in this animation.');
    return frame;
  });
  host.prepareAnimationEdit(a, [...new Set(removed.map(f => f.animator.uuid))]);
  return edit(host, project, 'Blockbench AI: Delete keyframes', { elements: [], animations: [a], keyframes: [...frames] }, () => ({ elements: [], animations: [a], keyframes: [...host.keyframes(a)] }), () => {
    for (const frame of removed) host.removeKeyframe(frame);
    return { project_id: project.uuid, animation_id: a.uuid, count: removed.length };
  });
}
export function getAnimationState(host: BlockbenchHost, input: ToolInput<'get_animation_state'>): ToolOutput<'get_animation_state'> {
  const p = host.getProject();
  if (!p) throw new BridgeError('NO_PROJECT', 'No active project.');
  if (p.uuid !== input.project_id) throw new BridgeError('PROJECT_MISMATCH', 'The active project changed.');
  const a = input.animation_id ? find(host, input.animation_id) : undefined;
  const items = a ? host.keyframes(a) : host.animations();
  const page = items.slice(input.offset, input.offset + input.limit);
  const scalar = (value: unknown): string | number => typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? '').slice(0, 1024);
  return { project_id: p.uuid, animations: a ? [summary(host, a)] : (page as AnimationHandle[]).map(item => summary(host, item)),
    keyframes: a ? (page as KeyframeHandle[]).map(f => ({ id: f.uuid, bone_id: f.animator.uuid, channel: f.channel.slice(0,64), time: f.time,
      interpolation: f.interpolation.slice(0,64), values: f.data_points.slice(0,2).map(v => [scalar(v.x), scalar(v.y), scalar(v.z)]) })) : [],
    total: items.length, offset: input.offset, next_offset: input.offset + page.length < items.length ? input.offset + page.length : null };
}
export function previewAnimation(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'preview_animation'>): ToolOutput<'preview_animation'> {
  const a = find(host, input.animation_id); editable(host, a);
  if (input.time > a.length) throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS', 'Preview time exceeds animation length.');
  return { project_id: project.uuid, animation_id: a.uuid, time: host.previewAnimation(a, input.time), playing: false };
}
