import { animationInputs, animationOutputs } from './schemas/animations.js';
import { exportInputs, exportOutputs } from './schemas/exports.js';
import { renderInput, renderOutput } from './schemas/render.js';
import { z } from 'zod';
import { BridgeError, errorSchema } from './errors.js';
import { displayName as name, nativeId as id, rotationSchema, stateVectorSchema, uvOffsetSchema, vectorSchema } from './schemas/common.js';
import { boneInputs, boneOutputs, boneStateSchema } from './schemas/bones.js';
import { textureInputs, textureOutputs, textureStateSchema } from './schemas/textures.js';
export { vectorSchema, type Vector3 } from './schemas/common.js';

export const VERSION = 5;
export const PLUGIN_VERSION = '0.5.0';
export const MAX_MESSAGE_BYTES = 1_048_576;
export const MAX_BATCH = 256;
export const commandNames = ['create_project', 'get_project_state', 'create_cubes', 'save_project', 'create_bones', 'update_bones', 'reparent_cubes', 'import_texture', 'assign_texture', 'set_cube_uv', 'create_animation', 'update_animation', 'set_keyframes', 'delete_keyframes', 'get_animation_state', 'preview_animation', 'export_bedrock_model', 'export_bedrock_animations', 'export_texture_png', 'render_project'] as const;
export type Command = typeof commandNames[number];
// Blockbench guid()/isUUID() use 8-4-4-4-12 hex groups without RFC version or
// variant bits. Keep those native IDs distinct from our RFC request UUIDs.
const requestId = z.uuid();
export const cubeSchema = z.strictObject({
  name,
  from: vectorSchema,
  to: vectorSchema,
  origin: vectorSchema.default([0, 0, 0]),
  rotation: rotationSchema.default([0, 0, 0]),
  uv_offset: uvOffsetSchema.default([0, 0]),
  mirror_uv: z.boolean().default(false),
}).refine(c => c.from.every((value, index) => value <= c.to[index]!), { message: 'Each from coordinate must be <= to.' });
export type CubeInput = z.infer<typeof cubeSchema>;

export const inputSchemas = {
  render_project: renderInput,
  ...exportInputs,
  ...animationInputs,
  ...boneInputs,
  ...textureInputs,
  create_project: z.strictObject({
    name,
    model_identifier: z.string().min(1).max(128).regex(/^[a-z0-9_][a-z0-9_.-]*$/)
      .refine(value => !value.startsWith('geometry.'), 'Omit the geometry. prefix.'),
    texture_width: z.number().int().min(1).max(4096).default(64),
    texture_height: z.number().int().min(1).max(4096).default(64),
  }),
  get_project_state: z.strictObject({
    offset: z.number().int().min(0).max(1_000_000).default(0),
    bone_offset: z.number().int().min(0).max(1_000_000).default(0),
    texture_offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  create_cubes: z.strictObject({ project_id: id, parent_id: id.optional(), cubes: z.array(cubeSchema).min(1).max(MAX_BATCH) }),
  save_project: z.strictObject({
    project_id: id,
    path: z.string().min(1).max(240),
    overwrite: z.boolean().default(false),
  }),
} as const;
export type ToolInput<K extends Command> = z.infer<typeof inputSchemas[K]>;

export const projectSchema = z.strictObject({
  id, name: z.string(), format: z.string(), model_identifier: z.string(), saved: z.boolean(),
  texture_width: z.number(), texture_height: z.number(), cube_count: z.number().int(),
  group_count: z.number().int(), managed: z.boolean(),
  texture_count: z.number().int(),
});
export const cubeStateSchema = z.strictObject({
  id, name: z.string(), from: stateVectorSchema, to: stateVectorSchema, origin: stateVectorSchema,
  rotation: stateVectorSchema, parent_id: id.nullable(),
  box_uv: z.boolean(), uv_offset: z.tuple([z.number().finite(), z.number().finite()]), mirror_uv: z.boolean(), texture_ids: z.array(id).max(6),
});
export const outputSchemas = {
  render_project: renderOutput,
  ...exportOutputs,
  ...animationOutputs,
  ...boneOutputs,
  ...textureOutputs,
  create_project: z.strictObject({ project: projectSchema }),
  get_project_state: z.strictObject({
    project: projectSchema.nullable(), cubes: z.array(cubeStateSchema).max(200),
    offset: z.number().int(), next_offset: z.number().int().nullable(),
    bones: z.array(boneStateSchema).max(200), bone_offset: z.number().int(), next_bone_offset: z.number().int().nullable(),
    textures: z.array(textureStateSchema).max(200), texture_offset: z.number().int(), next_texture_offset: z.number().int().nullable(),
  }),
  create_cubes: z.strictObject({ project_id: id, cube_ids: z.array(id).min(1).max(MAX_BATCH), count: z.number().int(), root_group_id: id }),
  save_project: z.strictObject({ project_id: id, path: z.string(), bytes: z.number().int().nonnegative(), saved: z.literal(true) }),
} as const;
export type ToolOutput<K extends Command> = z.infer<typeof outputSchemas[K]>;

const envelope = {
  version: z.literal(VERSION), type: z.literal('request'), request_id: requestId,
  deadline_ms: z.number().int().positive(),
};
export const requestSchema = z.discriminatedUnion('command', [
  z.strictObject({ ...envelope, command:z.literal('render_project'), params:inputSchemas.render_project }),
  z.strictObject({ ...envelope, command: z.literal('export_bedrock_model'), params: inputSchemas.export_bedrock_model }),
  z.strictObject({ ...envelope, command: z.literal('export_bedrock_animations'), params: inputSchemas.export_bedrock_animations }),
  z.strictObject({ ...envelope, command: z.literal('export_texture_png'), params: inputSchemas.export_texture_png }),
  z.strictObject({ ...envelope, command: z.literal('create_animation'), params: inputSchemas.create_animation }),
  z.strictObject({ ...envelope, command: z.literal('update_animation'), params: inputSchemas.update_animation }),
  z.strictObject({ ...envelope, command: z.literal('set_keyframes'), params: inputSchemas.set_keyframes }),
  z.strictObject({ ...envelope, command: z.literal('delete_keyframes'), params: inputSchemas.delete_keyframes }),
  z.strictObject({ ...envelope, command: z.literal('get_animation_state'), params: inputSchemas.get_animation_state }),
  z.strictObject({ ...envelope, command: z.literal('preview_animation'), params: inputSchemas.preview_animation }),
  z.strictObject({ ...envelope, command: z.literal('create_project'), params: inputSchemas.create_project }),
  z.strictObject({ ...envelope, command: z.literal('get_project_state'), params: inputSchemas.get_project_state }),
  z.strictObject({ ...envelope, command: z.literal('create_cubes'), params: inputSchemas.create_cubes }),
  z.strictObject({ ...envelope, command: z.literal('save_project'), params: inputSchemas.save_project }),
  z.strictObject({ ...envelope, command: z.literal('create_bones'), params: inputSchemas.create_bones }),
  z.strictObject({ ...envelope, command: z.literal('update_bones'), params: inputSchemas.update_bones }),
  z.strictObject({ ...envelope, command: z.literal('reparent_cubes'), params: inputSchemas.reparent_cubes }),
  z.strictObject({ ...envelope, command: z.literal('import_texture'), params: inputSchemas.import_texture }),
  z.strictObject({ ...envelope, command: z.literal('assign_texture'), params: inputSchemas.assign_texture }),
  z.strictObject({ ...envelope, command: z.literal('set_cube_uv'), params: inputSchemas.set_cube_uv }),
]);
export type Request = z.infer<typeof requestSchema>;
export const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ version: z.literal(VERSION), type: z.literal('response'), request_id: requestId, ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ version: z.literal(VERSION), type: z.literal('response'), request_id: requestId, ok: z.literal(false), error: errorSchema }),
]);
export type Response = z.infer<typeof responseSchema>;
export const helloSchema = z.strictObject({
  version: z.literal(VERSION), type: z.literal('hello'), workspace: z.string().min(1),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  plugin_version: z.literal(PLUGIN_VERSION), blockbench_version: z.string().max(32),
});
export const readySchema = z.strictObject({ version: z.literal(VERSION), type: z.literal('ready') });

export function parseJson(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) throw new BridgeError('INVALID_MESSAGE', 'Message exceeds 1 MiB.');
  try { return JSON.parse(text) as unknown; }
  catch { throw new BridgeError('INVALID_MESSAGE', 'Expected a JSON message.'); }
}

export function failure(requestId: string, error: BridgeError): Response {
  return { version: VERSION, type: 'response', request_id: requestId, ok: false, error: error.toJSON() };
}

export function isReadOnlyCommand(command: Command): boolean {
  return command === 'get_project_state' || command === 'get_animation_state';
}
