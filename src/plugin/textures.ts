import * as path from 'node:path';
import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput } from '../shared/protocol.js';
import type { Workspace } from '../shared/workspace.js';
import { findCubes } from './bones.js';
import { edit } from './edits.js';
import type { BlockbenchHost, CubeHandle, ProjectHandle, TextureHandle } from './host.js';
import { boxWarnings, checkFaceBounds } from './uv.js';

export function textureSummary(texture: TextureHandle): ToolOutput<'import_texture'>['texture'] {
  return { id: texture.uuid, name: texture.name, width: texture.width, height: texture.height, internal: texture.internal };
}
function requireEmptyAtlas(host: BlockbenchHost): void {
  if (host.textures().length) throw new BridgeError('TEXTURE_LIMIT', 'This phase supports one shared Bedrock atlas; the project already has a texture.');
}
export function checkBoxUV(project: ProjectHandle, cube: Pick<CubeHandle, 'from' | 'to'>, offset: readonly [number, number]): void {
  const size = cube.to.map((value, axis) => Math.floor(value - cube.from[axis]! + 1e-7));
  if (offset[0] < 0 || offset[1] < 0 || offset[0] + 2 * (size[0]! + size[2]!) > project.texture_width
    || offset[1] + size[1]! + size[2]! > project.texture_height) {
    throw new BridgeError('UV_OUT_OF_BOUNDS', 'The complete Box UV rectangle must fit within the project atlas.');
  }
}
export async function importTexture(host: BlockbenchHost, workspace: Workspace, input: ToolInput<'import_texture'>,
  deadline: number, mutableProject: () => ProjectHandle): Promise<ToolOutput<'import_texture'>> {
  const project = mutableProject();
  requireEmptyAtlas(host);
  const png = workspace.readPng(input.path);
  if (png.info.width !== project.texture_width || png.info.height !== project.texture_height) {
    throw new BridgeError('TEXTURE_SIZE_MISMATCH', 'PNG dimensions must match the project texture dimensions.');
  }
  const texture = await host.prepareTexture(input.name ?? path.basename(input.path), png.dataUrl, png.info, Math.min(5000, deadline - Date.now()));
  try {
    const current = mutableProject();
    requireEmptyAtlas(host);
    if (current.texture_width !== png.info.width || current.texture_height !== png.info.height) throw new BridgeError('TEXTURE_SIZE_MISMATCH', 'Project texture dimensions changed while decoding.');
    if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Request expired while decoding; no texture was added.');
    if (texture.width !== png.info.width || texture.height !== png.info.height || !texture.internal) throw new BridgeError('TEXTURE_LOAD_FAILED', 'Decoded texture metadata is invalid.');
    const before = { elements: [], textures: [], bitmap: true };
    const after = () => ({ elements: [], textures: [texture], bitmap: true });
    return edit(host, current, 'Blockbench AI: Import texture', before, after, () => {
      host.addTexture(texture);
      return { project_id: current.uuid, texture: textureSummary(texture) };
    });
  } catch (error) {
    if (!host.textures().some(item => item.uuid === texture.uuid)) host.disposeTexture(texture);
    throw error;
  }
}
export function assignTexture(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'assign_texture'>): ToolOutput<'assign_texture'> {
  const texture = host.textures().find(item => item.uuid === input.texture_id);
  if (!texture) throw new BridgeError('NOT_FOUND', 'The texture does not exist in this project.');
  if (host.textures().length !== 1) throw new BridgeError('TEXTURE_LIMIT', 'A single Bedrock atlas is required.');
  const cubes = findCubes(host, input.cube_ids);
  for (const cube of cubes) {
    if (cube.box_uv) checkBoxUV(project, cube, cube.uv_offset);
    else checkFaceBounds(project, host.cubeFaces(cube));
  }
  const scope = { elements: cubes };
  return edit(host, project, 'Blockbench AI: Assign texture', scope, () => scope, () => {
    for (const cube of cubes) host.applyTexture(cube, texture);
    return { project_id: project.uuid, count: cubes.length, cube_ids: input.cube_ids, texture_id: texture.uuid };
  });
}
export function setCubeUV(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'set_cube_uv'>): ToolOutput<'set_cube_uv'> {
  const cubes = findCubes(host, input.cubes.map(value => value.cube_id));
  input.cubes.forEach((value, index) => checkBoxUV(project, cubes[index]!, value.uv_offset));
  const scope = { elements: cubes };
  return edit(host, project, 'Blockbench AI: Set Box UV', scope, () => scope, () => {
    input.cubes.forEach((value, index) => host.setCubeUV(cubes[index]!, {
      uv_offset: value.uv_offset, ...(value.mirror_uv !== undefined ? { mirror_uv: value.mirror_uv } : {}),
    }));
    return { project_id: project.uuid, count: cubes.length, cube_ids: cubes.map(cube => cube.uuid), uv_warnings: boxWarnings(cubes) };
  });
}
