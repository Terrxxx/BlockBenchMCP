import { BridgeError } from './errors.js';
import type { Vector3 } from './schemas/common.js';

/** Eight corners indexed by X bit 0, Y bit 1, Z bit 2, in preview world space. */
export interface CollisionShape { cube_id: string; corners: Vector3[] }
const sub = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v: Vector3): Vector3 {
  const length = Math.hypot(...v);
  if (!Number.isFinite(length) || length < 1e-12) throw new BridgeError('INVALID_PARAMS', 'Collision checking requires finite nonzero-volume cube transforms.');
  return v.map(n => n / length) as Vector3;
}
export interface PreparedShape { cube_id: string; corners: Vector3[]; edges: Vector3[]; normals: Vector3[]; min: Vector3; max: Vector3 }
export function prepareShape(shape: CollisionShape): PreparedShape {
  if (shape.corners.length !== 8 || shape.corners.some(p => p.length !== 3 || p.some(n => !Number.isFinite(n)))) throw new BridgeError('INTERNAL_ERROR', 'Host returned invalid collision corners.');
  const p = shape.corners;
  const edges = [1, 2, 4].map(i => unit(sub(p[i]!, p[0]!)));
  if (Math.abs(dot(cross(edges[0]!, edges[1]!), edges[2]!)) < 1e-10) throw new BridgeError('INVALID_PARAMS', 'Collision checking does not support singular cube transforms.');
  const normals = [cross(edges[1]!, edges[2]!), cross(edges[2]!, edges[0]!), cross(edges[0]!, edges[1]!)].map(unit);
  return { ...shape, edges, normals, min: [0, 1, 2].map(i => Math.min(...p.map(v => v[i]!))) as Vector3, max: [0, 1, 2].map(i => Math.max(...p.map(v => v[i]!))) as Vector3 };
}
/** SAT for affine-transformed boxes, including shear; value is NOT a penetration vector. */
export function projectionOverlap(a: PreparedShape, b: PreparedShape, tolerance: number): number | null {
  if ([0, 1, 2].some(i => Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!) <= tolerance)) return null;
  const axes = [...a.normals, ...b.normals];
  for (const ae of a.edges) for (const be of b.edges) {
    const axis = cross(ae, be);
    if (Math.hypot(...axis) > 1e-10) axes.push(unit(axis));
  }
  let minimum = Infinity;
  for (const axis of axes) {
    const ap = a.corners.map(p => dot(p, axis)), bp = b.corners.map(p => dot(p, axis));
    const overlap = Math.min(Math.max(...ap), Math.max(...bp)) - Math.max(Math.min(...ap), Math.min(...bp));
    if (overlap <= tolerance) return null;
    minimum = Math.min(minimum, overlap);
  }
  return minimum;
}
