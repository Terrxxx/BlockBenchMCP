import { z } from 'zod';
import { BridgeError } from '../shared/errors.js';
import { decodePngDataUrl } from '../shared/png.js';
import type { ToolInput } from '../shared/protocol.js';
import type { ExportKind } from '../shared/schemas/exports.js';
import type { Workspace } from '../shared/workspace.js';
import type { BlockbenchHost, ProjectHandle } from './host.js';

type ExportCommand = 'export_bedrock_model' | 'export_bedrock_animations' | 'export_texture_png';
export type ExportRequest = { [K in ExportCommand]: { command: K; params: ToolInput<K> } }[ExportCommand];
const MAX_BYTES = 8 * 1024 * 1024;
const modelDocument = z.object({ format_version: z.string(), 'minecraft:geometry': z.array(z.object({
  description: z.object({ identifier: z.string() }).passthrough(),
}).passthrough()).length(1) }).passthrough();
const animationDocument = z.object({ format_version: z.string(), animations: z.record(z.string(), z.unknown()) }).passthrough();

/** Compile in memory, revalidate, then write exactly one authorized resource. */
export function exportResource(host: BlockbenchHost, workspace: Workspace, request: ExportRequest,
  deadline: number, activeProject: () => ProjectHandle) {
  const project = activeProject();
  const input = request.params;
  const kind: ExportKind = request.command === 'export_bedrock_model' ? 'bedrock_model'
    : request.command === 'export_bedrock_animations' ? 'bedrock_animations' : 'texture_png';
  const ensureReady = (): void => {
    if (activeProject() !== project) throw new BridgeError('PROJECT_MISMATCH', 'Active project changed during export.');
    if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Export expired before writing.');
    workspace.exportTarget(input.path, kind, input.overwrite);
    for (const resource of host.resourcePaths()) workspace.assertResource(resource);
  };
  ensureReady();
  let writing = false;
  try {
    let content: string;
    let bytes: Uint8Array;
    const warnings: string[] = [];
    if (request.command === 'export_texture_png') {
      const texture = host.textures().find(t => t.uuid === request.params.texture_id);
      if (!texture) throw new BridgeError('NOT_FOUND', 'Texture not found in the active project.');
      if (!texture.internal) throw new BridgeError('INVALID_TEXTURE', 'Export requires an internal PNG atlas.');
      content = host.textureDataUrl(texture);
      const decoded = decodePngDataUrl(content);
      bytes = decoded.bytes;
      const info = decoded.info;
      if (info.width !== texture.width || info.height !== texture.height) throw new BridgeError('TEXTURE_SIZE_MISMATCH', 'Exported PNG dimensions differ from the texture.');
    } else {
      let document: unknown;
      if (request.command === 'export_bedrock_model') {
        document = host.compileBedrockModel();
        if (!modelDocument.safeParse(document).success) throw new BridgeError('EXPORT_FAILED', 'Official geometry codec returned an invalid document.');
        warnings.push('Visible bounds are omitted to avoid changing project state or depending on the current animation pose. Official export flags and empty-bone settings apply.');
      } else {
        const clips = request.params.animation_ids.map(id => {
          const a = host.animations().find(candidate => candidate.uuid === id);
          if (!a) throw new BridgeError('NOT_FOUND', 'Animation not found in the active project.');
          if (!host.animationEditable(a)) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Export supports numeric bone animations with linear/step interpolation only.');
          if (host.keyframes(a).length > 4096) throw new BridgeError('ANIMATION_LIMIT', 'Animation exceeds 4096 keyframes.');
          return a;
        });
        if (new Set(clips.map(a => a.name)).size !== clips.length) throw new BridgeError('NAME_CONFLICT', 'Selected animation names must be unique.');
        document = host.compileBedrockAnimations(clips);
        const parsed = animationDocument.safeParse(document);
        if (!parsed.success || Object.keys(parsed.data.animations).length !== clips.length
          || clips.some(a => !Object.hasOwn(parsed.data.animations, a.name))) throw new BridgeError('EXPORT_FAILED', 'Official animation codec returned an invalid selection.');
        warnings.push('Official Bedrock export snaps keyframe times to animation snapping and rounds clip length to four decimals. Source keyframes stay unchanged.');
      }
      content = JSON.stringify(document, (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new BridgeError('EXPORT_FAILED', 'Codec output contains a non-finite number.');
        return value;
      }, 2) + '\n';
      bytes = new TextEncoder().encode(content);
    }
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new BridgeError('EXPORT_TOO_LARGE', 'Resource must be at most 8 MiB.');
    ensureReady();
    const target = workspace.exportTarget(input.path, kind, input.overwrite);
    writing = true;
    host.writeResource(content, target, kind === 'texture_png');
    const written = workspace.resolve(input.path);
    if (workspace.fs.statSync(written).size !== bytes.length) throw new Error('Resource size verification failed');
    const actual = workspace.fs.readFileSync(written);
    if (actual.length !== bytes.length || !bytes.every((value, index) => actual[index] === value)) throw new Error('Resource content verification failed');
    return { project_id: project.uuid, path: input.path.replace(/\\/g, '/'), bytes: bytes.length, kind, warnings };
  } catch (error) {
    if (!writing && error instanceof BridgeError) throw error;
    throw new BridgeError('EXPORT_FAILED', writing
      ? 'Resource write or verification failed. Inspect the target before retrying; partial output may exist.'
      : 'Official resource compilation failed before writing.', writing);
  }
}
