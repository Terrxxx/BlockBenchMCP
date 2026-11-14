import { z } from 'zod';
import { nativeId } from './common.js';

export const exportKinds = ['bedrock_model', 'bedrock_animations', 'texture_png'] as const;
export type ExportKind = typeof exportKinds[number];
export const exportSuffixes: Record<ExportKind, string> = {
  bedrock_model: '.geo.json', bedrock_animations: '.animation.json', texture_png: '.png',
};
const destination = (kind: ExportKind) => ({
  project_id: nativeId,
  path: z.string().min(1).max(240).refine(p => p.toLowerCase().endsWith(exportSuffixes[kind]), 'Incorrect resource suffix.'),
  overwrite: z.boolean().default(false),
});
export const exportInputs = {
  export_bedrock_model: z.strictObject(destination('bedrock_model')),
  export_bedrock_animations: z.strictObject({ ...destination('bedrock_animations'),
    animation_ids: z.array(nativeId).min(1).max(128).refine(ids => new Set(ids).size === ids.length, 'Duplicate animation IDs.'),
  }),
  export_texture_png: z.strictObject({ ...destination('texture_png'), texture_id: nativeId }),
};
const result = (kind: ExportKind) => z.strictObject({
  project_id: nativeId, path: z.string().max(240), bytes: z.number().int().positive().max(8 * 1024 * 1024),
  kind: z.literal(kind), warnings: z.array(z.string().max(512)).max(10),
});
export const exportOutputs = {
  export_bedrock_model: result('bedrock_model'),
  export_bedrock_animations: result('bedrock_animations'),
  export_texture_png: result('texture_png'),
};
