import { describe, expect, it } from 'vitest';
import { prepareShape, projectionOverlap } from '../../src/shared/collision.js';
import type { Vector3 } from '../../src/shared/schemas/common.js';

function box(from: Vector3, to: Vector3, transform = (p: Vector3): Vector3 => p) {
  return prepareShape({ cube_id: 'test', corners: Array.from({ length: 8 }, (_, i) => transform([i & 1 ? to[0] : from[0], i & 2 ? to[1] : from[1], i & 4 ? to[2] : from[2]])) });
}
const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => projectionOverlap(a, b, 1e-4);
describe('affine cube SAT', () => {
  it('ignores separated boxes, face contact and tiny numerical overlap', () => {
    const a = box([0, 0, 0], [1, 1, 1]);
    for (const start of [2, 1, .99999]) expect(hit(a, box([start, 0, 0], [3, 1, 1]))).toBeNull();
  });
  it('finds partial overlap and containment, without calling overlap a physical penetration depth', () => {
    const a = box([0, 0, 0], [4, 4, 4]);
    expect(hit(a, box([3, 0, 0], [5, 4, 4]))).toBeCloseTo(1);
    expect(hit(a, box([1, 1, 1], [2, 2, 2]))).toBeCloseTo(1);
  });
  it('rejects a rotated pair whose AABBs overlap but whose volumes do not', () => {
    const rotate = ([x, y, z]: Vector3): Vector3 => [(x - y) / Math.sqrt(2), (x + y) / Math.sqrt(2), z];
    const a = box([-2, -.1, -.1], [2, .1, .1], rotate);
    const b = box([-2, -.1, -.1], [2, .1, .1], p => { const r = rotate(p); return [r[0] - .5, r[1] + .5, r[2]]; });
    expect(a.max[0]).toBeGreaterThan(b.min[0]); expect(hit(a, b)).toBeNull();
  });
  it('supports sheared boxes from rotated descendants of nonuniformly scaled parents', () => {
    const shear = ([x, y, z]: Vector3): Vector3 => [2 * x + y, y, z];
    const a = box([0, 0, 0], [1, 1, 1], shear);
    expect(hit(a, box([.25, .25, .25], [.75, .75, .75], shear))).toBeGreaterThan(0);
    expect(hit(a, box([0, 2, 0], [1, 3, 1], shear))).toBeNull();
  });
  it('reproduces the supplied door axis offset: closed clear, 90 degrees overlaps frame by 1', () => {
    const frame = box([-16, 0, 6.5], [-15, 32, 10]);
    const leaf = (degrees: number) => box([-14.75, 1, 7], [-13.75, 31, 9], ([x, y, z]) => {
      const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
      return [-15 + c * (x + 15) + s * (z - 8), y, 8 - s * (x + 15) + c * (z - 8)];
    });
    expect(hit(frame, leaf(0))).toBeNull();
    expect(hit(frame, leaf(90))).toBeCloseTo(1);
    expect(hit(frame, leaf(-90))).toBeCloseTo(1);
    expect(hit(frame, leaf(45))).toBeGreaterThan(0);
  });
  it('rejects flat/nonfinite shapes rather than declaring an invalid pose collision-free', () => {
    expect(() => box([0, 0, 0], [0, 1, 1])).toThrow();
    expect(() => box([0, 0, 0], [Infinity, 1, 1])).toThrow();
  });
});
