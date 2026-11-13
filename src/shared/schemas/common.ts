import { z } from 'zod';

export const nativeId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const displayName = z.string().trim().min(1).max(128).regex(/^[^\x00-\x1f<>]+$/);
const coordinate = z.number().finite().min(-32768).max(32768);
export const vectorSchema = z.tuple([coordinate, coordinate, coordinate]);
export const stateVectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const angle = z.number().finite().min(-360).max(360);
export const rotationSchema = z.tuple([angle, angle, angle]);
export const uvOffsetSchema = z.tuple([z.number().int().min(0).max(4096), z.number().int().min(0).max(4096)]);
export type Vector3 = z.infer<typeof vectorSchema>;

export function uniqueIds(ids: readonly string[]): boolean { return new Set(ids).size === ids.length; }
export const idBatch = z.array(nativeId).min(1).max(256).refine(uniqueIds, 'Duplicate IDs are not allowed.');
