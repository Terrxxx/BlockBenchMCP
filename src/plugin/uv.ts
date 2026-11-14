import { BridgeError } from '../shared/errors.js';
import type { ToolOutput } from '../shared/protocol.js';
import { faceNames, type FaceName, type FaceStates } from '../shared/schemas/modeling.js';
import type { CubeHandle, ProjectHandle } from './host.js';

export function faceSize(cube: Pick<CubeHandle, 'from' | 'to'>, face: FaceName, floor = false): [number, number] {
  const size = cube.to.map((v, i) => floor ? Math.floor(v - cube.from[i]! + 1e-7) : v - cube.from[i]!);
  const axes = face === 'up' || face === 'down' ? [0, 2] : face === 'east' || face === 'west' ? [2, 1] : [0, 1];
  return [size[axes[0]!]!, size[axes[1]!]!];
}
export function boxWarnings(cubes: CubeHandle[]): ToolOutput<'update_cubes'>['uv_warnings'] {
  return cubes.filter(c => c.box_uv).flatMap(cube => {
    const faces = faceNames.filter(face => faceSize(cube, face, true).some(n => n === 0)
      && cube.faces[face]?.texture !== null);
    return faces.length ? [{ cube_id: cube.uuid, code: 'DEGENERATE_BOX_UV' as const, faces }] : [];
  });
}
export function uvOutside(project: ProjectHandle, uv: readonly number[]): boolean {
  return uv.some((v, i) => !Number.isFinite(v) || v < 0 || v > (i % 2 === 0 ? project.texture_width : project.texture_height));
}
export function checkFaceBounds(project: ProjectHandle, faces: FaceStates): void {
  for (const face of Object.values(faces)) if (face.enabled && face.texture !== null && uvOutside(project, face.uv)) {
    throw new BridgeError('UV_OUT_OF_BOUNDS', 'Every enabled face UV must fit inside the project atlas.');
  }
}
