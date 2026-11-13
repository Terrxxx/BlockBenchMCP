import { z } from 'zod';
import { idBatch, nativeId, rotationSchema, stateVectorSchema, uniqueIds, vectorSchema } from './common.js';

export const boneName = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/);
export const boneInputSchema = z.strictObject({
  key: boneName, name: boneName,
  origin: vectorSchema.default([0, 0, 0]), rotation: rotationSchema.default([0, 0, 0]),
  parent_id: nativeId.nullable().optional(), parent_key: boneName.optional(),
}).refine(value => value.parent_id === undefined || value.parent_key === undefined, 'Use parent_id or parent_key, not both.');
export type BoneInput = z.infer<typeof boneInputSchema>;
export const boneUpdateSchema = z.strictObject({
  bone_id: nativeId, name: boneName.optional(), origin: vectorSchema.optional(),
  rotation: rotationSchema.optional(), parent_id: nativeId.nullable().optional(),
}).refine(value => Object.keys(value).length > 1, 'Supply at least one change.');
export type BoneUpdate = z.infer<typeof boneUpdateSchema>;
export const boneStateSchema = z.strictObject({
  id: nativeId, name: z.string(), origin: stateVectorSchema, rotation: stateVectorSchema, parent_id: nativeId.nullable(),
});
export const boneInputs = {
  create_bones: z.strictObject({ project_id: nativeId,
    bones: z.array(boneInputSchema).min(1).max(256).refine(values => uniqueIds(values.map(value => value.key)), 'Duplicate batch keys.'),
  }),
  update_bones: z.strictObject({ project_id: nativeId,
    bones: z.array(boneUpdateSchema).min(1).max(256).refine(values => uniqueIds(values.map(value => value.bone_id)), 'Duplicate bone IDs.'),
  }),
  reparent_cubes: z.strictObject({ project_id: nativeId, cube_ids: idBatch, parent_id: nativeId }),
} as const;
export const boneOutputs = {
  create_bones: z.strictObject({ project_id: nativeId, count: z.number().int(),
    bones: z.array(z.strictObject({ key: boneName, id: nativeId })).min(1).max(256),
  }),
  update_bones: z.strictObject({ project_id: nativeId, count: z.number().int(), bone_ids: idBatch }),
  reparent_cubes: z.strictObject({ project_id: nativeId, count: z.number().int(), cube_ids: idBatch, parent_id: nativeId }),
} as const;
