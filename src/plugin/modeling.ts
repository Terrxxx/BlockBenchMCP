import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput } from '../shared/protocol.js';
import { faceNames, type CubeUpdate } from '../shared/schemas/modeling.js';
import { findCubes } from './bones.js';
import { edit } from './edits.js';
import type { BlockbenchHost, ProjectHandle } from './host.js';
import { checkBoxUV } from './textures.js';
import { boxWarnings, checkFaceBounds, faceSize, uvOutside } from './uv.js';

export function getCubeUV(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'get_cube_uv'>): ToolOutput<'get_cube_uv'> {
  return { project_id: project.uuid, texture_width: project.texture_width, texture_height: project.texture_height,
    cubes: findCubes(host, input.cube_ids).map(cube => {
      const faces = host.cubeFaces(cube);
      return { cube_id: cube.uuid, box_uv: cube.box_uv, faces, dimensions: faceNames.map(face => {
        const uv = faces[face].uv;
        const pixels: [number, number] = [Math.abs(uv[2] - uv[0]), Math.abs(uv[3] - uv[1])];
        if (faces[face].rotation % 180 !== 0) pixels.reverse();
        return { face, model_size: faceSize(cube, face), pixel_size: pixels };
      }) };
    }),
  };
}

export function setFaceUV(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'set_face_uv'>): ToolOutput<'set_face_uv'> {
  const cubes = findCubes(host, input.cubes.map(c => c.cube_id));
  for (const item of input.cubes) for (const face of Object.values(item.faces)) {
    if (uvOutside(project, face.uv)) throw new BridgeError('UV_OUT_OF_BOUNDS', 'Face UV lies outside the atlas.');
    if (!input.allow_degenerate && (face.uv[0] === face.uv[2] || face.uv[1] === face.uv[3])) {
      throw new BridgeError('INVALID_PARAMS', 'Zero-area face UV requires explicit allow_degenerate:true for intentional point/line sampling.');
    }
  }
  const scope = { elements: cubes };
  return edit(host, project, 'Blockbench AI: Set face UV', scope, () => scope, () => {
    cubes.forEach((cube, i) => host.setFaceUV(cube, input.cubes[i]!.faces));
    return { project_id: project.uuid, cube_ids: input.cubes.map(c => c.cube_id), count: cubes.length };
  });
}

export function updateCubes(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'update_cubes'>): ToolOutput<'update_cubes'> {
  const cubes = findCubes(host, input.cubes.map(c => c.cube_id));
  const updates = input.cubes.map(({ cube_id: _id, ...update }, i) => {
    const clean = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)) as CubeUpdate;
    const cube = cubes[i]!, next = { ...cube, ...clean };
    if (next.from.some((v, axis) => v > next.to[axis]!)) throw new BridgeError('INVALID_PARAMS', 'Each final from coordinate must be <= to.');
    if (cube.box_uv) checkBoxUV(project, next, cube.uv_offset);
    else checkFaceBounds(project, host.cubeFaces(cube));
    return clean;
  });
  const scope = { elements: cubes };
  return edit(host, project, 'Blockbench AI: Update cubes', scope, () => scope, () => {
    cubes.forEach((cube, i) => host.updateCube(cube, updates[i]!));
    return { project_id: project.uuid, cube_ids: cubes.map(c => c.uuid), count: cubes.length, uv_warnings: boxWarnings(cubes) };
  });
}

export function validateProject(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'validate_project'>, deadline: number): ToolOutput<'validate_project'> {
  const cubes = input.cube_ids ? findCubes(host, input.cube_ids) : host.cubes();
  if (cubes.length > 20000) throw new BridgeError('INVALID_PARAMS', 'Validation supports at most 20000 cubes; use cube_ids batches.');
  const issues: ToolOutput<'validate_project'>['issues'] = [];
  let total = 0;
  const add = (issue: typeof issues[number]): void => { total++; if (issues.length < input.max_issues) issues.push(issue); };
  const textures = new Set(host.textures().map(t => t.uuid));
  for (const cube of cubes) {
    if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Validation deadline elapsed; no model changes were made.');
    if (cube.from.some((v, i) => v >= cube.to[i]!)) add({ cube_id: cube.uuid, code: 'ZERO_VOLUME', message: 'Cube has zero or negative volume; a deliberate plane may be valid.' });
    const faces = host.cubeFaces(cube);
    for (const face of faceNames) {
      const data = faces[face];
      if (!data.enabled || data.texture === null) continue;
      const base = { cube_id: cube.uuid, face };
      if (!data.texture || !textures.has(data.texture)) add({ ...base, code: 'UNBOUND_TEXTURE', message: 'Face has no valid explicit atlas binding; check single-texture fallback in the host.' });
      if (data.uv[0] === data.uv[2] || data.uv[1] === data.uv[3]) add({ ...base, code: 'DEGENERATE_UV', message: 'Face samples a line or point. Use set_face_uv for thin parts, unless solid-color sampling is intentional.' });
      if (uvOutside(project, data.uv)) add({ ...base, code: 'UV_OUT_OF_BOUNDS', message: 'UV extends outside the atlas.' });
    }
  }
  return { project_id: project.uuid, checked_cubes: cubes.length, issue_count: total, truncated: total > issues.length, issues };
}
