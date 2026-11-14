import { z } from 'zod';
import { displayName, nativeId, stateVectorSchema, uniqueIds, uvOffsetSchema, vectorSchema } from './common.js';

export const beamThickness = z.number().finite().min(0.01).max(256);
const points = { start: vectorSchema, end: vectorSchema };
const validLength = (v: {start: number[]; end: number[]}): boolean => {
  const length = Math.hypot(...v.end.map((n,i)=>n-v.start[i]!));
  return length >= 0.01 && length <= 4096;
};
export const beamSpec = z.strictObject({ ...points, name: displayName, thickness: beamThickness,
  uv_offset: uvOffsetSchema.default([0,0]), mirror_uv: z.boolean().default(false),
}).refine(validLength, 'Beam length must be between 0.01 and 4096.');
export const beamAlignment = z.strictObject({ ...points, cube_id: nativeId, thickness: beamThickness.optional() })
  .refine(validLength, 'Beam length must be between 0.01 and 4096.');
export const beamInputs = {
  create_beams: z.strictObject({ project_id: nativeId, parent_id: nativeId, beams: z.array(beamSpec).min(1).max(256) }),
  align_beams: z.strictObject({ project_id: nativeId, beams: z.array(beamAlignment).min(1).max(256)
    .refine(v=>uniqueIds(v.map(b=>b.cube_id)), 'Duplicate cube IDs.') }),
};
const output = z.strictObject({ project_id: nativeId, count:z.number().int().min(1).max(256),
  beams:z.array(z.strictObject({cube_id:nativeId,start:stateVectorSchema,end:stateVectorSchema,
    length:z.number().finite().positive(),endpoint_error:z.number().finite().min(0).max(1e-6)})).min(1).max(256),
});
export const beamOutputs = {create_beams:output,align_beams:output};
