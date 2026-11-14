import { uvWarningsSchema } from './modeling.js';
import { z } from 'zod';
import { displayName, idBatch, nativeId, uniqueIds, uvOffsetSchema } from './common.js';

export const textureStateSchema = z.strictObject({
  id: nativeId, name: z.string(), width: z.number().int().nonnegative(), height: z.number().int().nonnegative(), internal: z.boolean(),
});
export const uvInputSchema = z.strictObject({ cube_id: nativeId, uv_offset: uvOffsetSchema, mirror_uv: z.boolean().optional() });
export type UVInput = z.infer<typeof uvInputSchema>;
export const textureInputs = {
  import_texture: z.strictObject({ project_id: nativeId, path: z.string().min(1).max(240), name: displayName.optional() }),
  assign_texture: z.strictObject({ project_id: nativeId, texture_id: nativeId, cube_ids: idBatch }),
  set_cube_uv: z.strictObject({ project_id: nativeId,
    cubes: z.array(uvInputSchema).min(1).max(256).refine(values => uniqueIds(values.map(value => value.cube_id)), 'Duplicate cube IDs.'),
  }),
} as const;
export const textureOutputs = {
  import_texture: z.strictObject({ project_id: nativeId, texture: textureStateSchema }),
  assign_texture: z.strictObject({ project_id: nativeId, texture_id: nativeId, cube_ids: idBatch, count: z.number().int() }),
  set_cube_uv: z.strictObject({ project_id: nativeId, cube_ids: idBatch, count: z.number().int(), uv_warnings: uvWarningsSchema }),
} as const;
