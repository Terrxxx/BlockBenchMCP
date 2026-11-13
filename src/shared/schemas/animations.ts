import { z } from 'zod';
import { nativeId as id, idBatch, vectorSchema } from './common.js';

const time = z.number().finite().min(0).max(1000);
const animationName = z.string().max(128).regex(/^animation\.[a-z0-9_]+(?:\.[a-z0-9_]+)+$/);
const properties = {
  name: animationName, length: time.refine(n => n > 0), loop: z.enum(['once', 'loop', 'hold']),
  snapping: z.number().int().min(10).max(500),
};
export const keyframeInput = z.strictObject({
  bone_id: id, channel: z.enum(['rotation', 'position', 'scale']), time,
  value: vectorSchema, interpolation: z.enum(['linear', 'step']).default('linear'),
});
export type KeyframeInput = z.infer<typeof keyframeInput>;
export const animationInputs = {
  create_animation: z.strictObject({ project_id: id, ...properties,
    loop: properties.loop.default('once'), snapping: properties.snapping.default(20) }),
  update_animation: z.strictObject({ project_id: id, animation_id: id,
    name: properties.name.optional(), length: properties.length.optional(),
    loop: properties.loop.optional(), snapping: properties.snapping.optional(),
  }).refine(p => p.name !== undefined || p.length !== undefined || p.loop !== undefined || p.snapping !== undefined, 'Supply a property to update.'),
  set_keyframes: z.strictObject({ project_id: id, animation_id: id,
    keyframes: z.array(keyframeInput).min(1).max(256).refine(frames => new Set(frames.map(f => `${f.bone_id}/${f.channel}/${f.time}`)).size === frames.length, 'Duplicate keyframe slots.'),
  }),
  delete_keyframes: z.strictObject({ project_id: id, animation_id: id, keyframe_ids: idBatch }),
  get_animation_state: z.strictObject({ project_id: id, animation_id: id.optional(),
    offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(200).default(100) }),
  preview_animation: z.strictObject({ project_id: id, animation_id: id, time }),
};
export const animationState = z.strictObject({ id, name: z.string().max(1024), length: z.number().finite(),
  loop: z.enum(['once', 'loop', 'hold']), snapping: z.number().finite(), keyframe_count: z.number().int(), editable: z.boolean() });
export const keyframeState = z.strictObject({ id, bone_id: id, channel: z.string().max(64), time: z.number().finite(),
  interpolation: z.string().max(64), values: z.array(z.tuple([z.union([z.number().finite(), z.string().max(1024)]), z.union([z.number().finite(), z.string().max(1024)]), z.union([z.number().finite(), z.string().max(1024)])])).max(2) });
export const animationOutputs = {
  create_animation: z.strictObject({ project_id: id, animation: animationState }),
  update_animation: z.strictObject({ project_id: id, animation: animationState }),
  set_keyframes: z.strictObject({ project_id: id, animation_id: id, keyframe_ids: idBatch, created: z.number().int(), updated: z.number().int() }),
  delete_keyframes: z.strictObject({ project_id: id, animation_id: id, count: z.number().int() }),
  get_animation_state: z.strictObject({ project_id: id, animations: z.array(animationState).max(200),
    keyframes: z.array(keyframeState).max(200), total: z.number().int(), offset: z.number().int(), next_offset: z.number().int().nullable() }),
  preview_animation: z.strictObject({ project_id: id, animation_id: id, time: z.number().finite(), playing: z.literal(false) }),
};
