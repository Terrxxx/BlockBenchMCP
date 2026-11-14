import { z } from 'zod';
import { displayName, idBatch, nativeId, rotationSchema, uniqueIds, vectorSchema } from './common.js';

export const faceNames = ['north', 'east', 'south', 'west', 'up', 'down'] as const;
export type FaceName = typeof faceNames[number];
const finite = z.number().finite();
export const uvRectSchema = z.tuple([finite, finite, finite, finite]);
const faceEdit = z.strictObject({ uv: uvRectSchema, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0) });
export const faceEditsSchema = z.strictObject({ north: faceEdit, east: faceEdit, south: faceEdit, west: faceEdit, up: faceEdit, down: faceEdit });
export type FaceEdits = z.infer<typeof faceEditsSchema>;
export const faceStateSchema = z.strictObject({ uv: uvRectSchema, rotation: finite, texture: nativeId.or(z.literal(false)).nullable(), enabled: z.boolean() });
export const facesStateSchema = z.strictObject({ north: faceStateSchema, east: faceStateSchema, south: faceStateSchema, west: faceStateSchema, up: faceStateSchema, down: faceStateSchema });
export type FaceStates = z.infer<typeof facesStateSchema>;
export const uvWarningsSchema = z.array(z.strictObject({ cube_id: nativeId, code: z.literal('DEGENERATE_BOX_UV'), faces: z.array(z.enum(faceNames)).max(6) })).max(256);
export const cubeUpdateSchema = z.strictObject({ cube_id: nativeId, name: displayName.optional(), from: vectorSchema.optional(), to: vectorSchema.optional(), origin: vectorSchema.optional(), rotation: rotationSchema.optional() })
  .refine(v => Object.keys(v).length > 1, 'Supply at least one change.');
export type CubeUpdate = { [K in Exclude<keyof z.infer<typeof cubeUpdateSchema>, 'cube_id'>]?: Exclude<z.infer<typeof cubeUpdateSchema>[K], undefined> };
const offset = z.number().int().min(0).max(1_000_000).default(0);
const limit = z.number().int().min(1).max(200).default(100);
const tab = z.strictObject({ id: nativeId, name: z.string(), format: z.string(), saved: z.boolean(), active: z.boolean(), managed: z.boolean(), locked: z.boolean() });
const batchResult = z.strictObject({ project_id: nativeId, cube_ids: idBatch, count: z.number().int().min(1).max(256) });
export const modelingInputs = {
  list_projects: z.strictObject({ offset, limit }),
  select_project: z.strictObject({ project_id: nativeId }),
  get_cube_uv: z.strictObject({ project_id: nativeId, cube_ids: idBatch }),
  set_face_uv: z.strictObject({ project_id: nativeId, allow_degenerate: z.boolean().default(false), cubes: z.array(z.strictObject({ cube_id: nativeId, faces: faceEditsSchema })).min(1).max(256).refine(v => uniqueIds(v.map(c => c.cube_id)), 'Duplicate cube IDs.') }),
  update_cubes: z.strictObject({ project_id: nativeId, cubes: z.array(cubeUpdateSchema).min(1).max(256).refine(v => uniqueIds(v.map(c => c.cube_id)), 'Duplicate cube IDs.') }),
  validate_project: z.strictObject({ project_id: nativeId, cube_ids: idBatch.optional(), max_issues: z.number().int().min(1).max(500).default(200) }),
  check_collisions: z.strictObject({ project_id: nativeId, cube_ids: idBatch,
    animation: z.strictObject({ animation_id: nativeId, times: z.array(z.number().finite().min(0).max(3600)).min(1).max(33).refine(v => new Set(v).size === v.length, 'Duplicate sample times.') }).optional(),
    include_same_bone: z.boolean().default(false), tolerance: z.number().finite().min(0.000001).max(1).default(0.0001), max_results: z.number().int().min(1).max(500).default(200),
  }),
};
export const modelingOutputs = {
  list_projects: z.strictObject({ projects: z.array(tab).max(200), total: z.number().int(), next_offset: z.number().int().nullable() }),
  select_project: z.strictObject({ project: tab }),
  get_cube_uv: z.strictObject({ project_id: nativeId, texture_width: finite, texture_height: finite, cubes: z.array(z.strictObject({ cube_id: nativeId, box_uv: z.boolean(), faces: facesStateSchema,
    dimensions: z.array(z.strictObject({ face: z.enum(faceNames), model_size: z.tuple([finite, finite]), pixel_size: z.tuple([finite, finite]) })).length(6),
  })).min(1).max(256) }),
  set_face_uv: batchResult,
  update_cubes: batchResult.extend({ uv_warnings: uvWarningsSchema }),
  validate_project: z.strictObject({ project_id: nativeId, checked_cubes: z.number().int(), issue_count: z.number().int(), truncated: z.boolean(), issues: z.array(z.strictObject({ cube_id: nativeId, face: z.enum(faceNames).optional(), code: z.enum(['DEGENERATE_UV', 'UV_OUT_OF_BOUNDS', 'UNBOUND_TEXTURE', 'ZERO_VOLUME']), message: z.string().max(256) })).max(500) }),
  check_collisions: z.strictObject({ project_id: nativeId, animation_id: nativeId.nullable(), sampled_times: z.array(finite.nullable()).max(33), checked_pairs: z.number().int(), complete: z.boolean(), collisions: z.array(z.strictObject({ cube_a: nativeId, cube_b: nativeId, time: finite.nullable(), min_projection_overlap: finite.positive() })).max(500), warnings: z.array(z.string()).max(8) }),
};
