import type { KeyframeInput } from '../shared/schemas/animations.js';
import type { ToolInput } from '../shared/protocol.js';

export interface AnimationHandle {
  uuid: string; name: string; length: number; loop: 'once' | 'loop' | 'hold'; snapping: number;
}
export interface KeyframeHandle {
  uuid: string; time: number; channel: string; interpolation: string;
  animator: { uuid: string };
  data_points: Record<string, unknown>[];
}
export interface AnimationHost {
  animations(): AnimationHandle[];
  keyframes(animation: AnimationHandle): KeyframeHandle[];
  animationEditable(animation: AnimationHandle): boolean;
  makeAnimation(input: ToolInput<'create_animation'>): AnimationHandle;
  addAnimation(animation: AnimationHandle): void;
  updateAnimation(animation: AnimationHandle, input: ToolInput<'update_animation'>): void;
  prepareAnimationEdit(animation: AnimationHandle, boneIds: string[]): void;
  putKeyframe(animation: AnimationHandle, input: KeyframeInput, existing?: KeyframeHandle): KeyframeHandle;
  removeKeyframe(frame: KeyframeHandle): void;
  previewAnimation(animation: AnimationHandle, time: number): number;
}
