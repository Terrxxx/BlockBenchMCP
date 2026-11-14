import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeCollisionShapes } from '../../src/plugin/native-collision.js';
import type { CubeHandle } from '../../src/plugin/host.js';
import type { AnimationHandle } from '../../src/plugin/animation-host.js';

class Vec {
  constructor(public x = 0, public y = 0, public z = 0) {}
  clone() { return new Vec(this.x, this.y, this.z); }
  copy(v: Vec) { return this.set(v.x, v.y, v.z); }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  applyMatrix4(matrix: { x: number }) { this.x += matrix.x; return this; }
}
class Node {
  position = new Vec(7); rotation = new Vec(0, 2); scale = new Vec(1, 2, 3); visible = false;
  geometry = { computeBoundingBox: vi.fn(), boundingBox: { min: new Vec(), max: new Vec(1, 2, 3) } };
  matrixWorld = { x: 0 };
}
let node: Node, timeline: { time: number }, values: Record<string, number[]>, context: Record<string, unknown>;
class Track {
  uuid = 'bone'; rotation_global = false; group: unknown = 'saved';
  displayFrame() { this.group = 'sample'; node.position.x = timeline.time * 10; }
}
class Clip implements AnimationHandle {
  uuid = 'clip'; name = 'animation.door.open'; length = 1; loop = 'once' as const; snapping = 20; animators = { bone: new Track() };
}
class CubeStub { uuid = 'cube'; get mesh() { return node; } }
const cubes = () => [new CubeStub() as unknown as CubeHandle];
beforeEach(() => {
  node = new Node(); timeline = { time: 42 }; values = { rotation: [1, 2, 3] }; context = { animation: 'old' };
  vi.stubGlobal('Cube', CubeStub); vi.stubGlobal('BBAnimation', Clip); vi.stubGlobal('BoneAnimator', Track); vi.stubGlobal('Group', { all: [{ uuid: 'bone' }] });
  vi.stubGlobal('Outliner', { elements: cubes() }); vi.stubGlobal('AnimationController', { all: [] }); vi.stubGlobal('Timeline', timeline);
  vi.stubGlobal('Canvas', { scene: { traverse: (visit: (n: Node) => void) => visit(node), updateMatrixWorld: () => { node.matrixWorld.x = node.position.x; } } });
  vi.stubGlobal('Animator', { _last_values: values, MolangParser: { context }, showDefaultPose: () => { node.position.x = 0; node.visible = true; }, resetLastValues: () => { values.rotation = [0, 0, 0]; context.animation = 'sample'; } });
});
afterEach(() => vi.unstubAllGlobals());
describe('native collision pose sampling', () => {
  it('reads native world corners and restores time, transforms, visibility, caches and track group', () => {
    const clip = new Clip(), prior = values.rotation;
    const result = nativeCollisionShapes(cubes(), clip, .5);
    expect(result[0]!.corners[0]).toEqual([5, 0, 0]); expect(result[0]!.corners[7]).toEqual([6, 2, 3]);
    expect(node.position.x).toBe(7); expect(node.visible).toBe(false); expect(node.matrixWorld.x).toBe(7);
    expect(node.rotation.y).toBe(2); expect(node.scale.z).toBe(3); expect(timeline.time).toBe(42);
    expect(values.rotation).toBe(prior); expect(context.animation).toBe('old'); expect(clip.animators.bone.group).toBe('saved');
  });
  it('uses default pose rather than the current timeline pose for static checks', () => {
    expect(nativeCollisionShapes(cubes())[0]!.corners[0]).toEqual([0, 0, 0]);
    expect(node.position.x).toBe(7); expect(timeline.time).toBe(42);
  });
  it.each(['sample', 'geometry'])('restores state after %s fails', reason => {
    const clip = new Clip();
    if (reason === 'sample') clip.animators.bone.displayFrame = () => { node.position.x = 100; throw new Error('sampling'); };
    else node.geometry.computeBoundingBox.mockImplementation(() => { throw new Error('geometry'); });
    expect(() => nativeCollisionShapes(cubes(), clip, .5)).toThrow();
    expect(node.position.x).toBe(7); expect(timeline.time).toBe(42); expect(context.animation).toBe('old');
  });
  it('continues restoring other state when a node restoration fails and marks uncertainty', () => {
    node.geometry.computeBoundingBox.mockImplementation(() => { node.position.copy = () => { throw new Error('restore'); }; });
    expect(() => nativeCollisionShapes(cubes(), new Clip(), .5)).toThrow(expect.objectContaining({ outcomeUnknown: true }));
    expect(timeline.time).toBe(42); expect(context.animation).toBe('old');
  });
  it('rejects controllers, global tracks and missing bones before touching the pose', () => {
    const clip = new Clip(); clip.animators.bone.rotation_global = true;
    expect(() => nativeCollisionShapes(cubes(), clip, .5)).toThrow('local bone');
    clip.animators.bone.rotation_global = false; clip.animators.bone.uuid = 'missing';
    expect(() => nativeCollisionShapes(cubes(), clip, .5)).toThrow('missing bone');
    vi.stubGlobal('AnimationController', { all: [{}] });
    expect(() => nativeCollisionShapes(cubes())).toThrow('controllers'); expect(node.position.x).toBe(7);
  });
});
