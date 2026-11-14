import { BridgeError } from '../shared/errors.js';
import type { CollisionShape } from '../shared/collision.js';
import type { Vector3 } from '../shared/schemas/common.js';
import type { AnimationHandle } from './animation-host.js';
import type { CubeHandle } from './host.js';
import { nativeAnimation } from './native-animation.js';

/** Evaluate the native pose without selecting clips, changing mode, or touching Undo. */
export function nativeCollisionShapes(cubes: CubeHandle[], value?: AnimationHandle, time?: number): CollisionShape[] {
  if (AnimationController.all.length || Outliner.elements.some(e => !(e instanceof Cube))) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Collision sampling requires cube/bone projects without controllers or IK.');
  const clip = value ? nativeAnimation(value) : undefined;
  const tracks: BoneAnimator[] = [];
  for (const track of Object.values(clip?.animators ?? {})) {
    if (!(track instanceof BoneAnimator) || track.rotation_global) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Collision sampling requires local bone transform tracks.');
    if (!Group.all.some(g => g.uuid === track.uuid)) throw new BridgeError('NOT_FOUND', 'Animation refers to a missing bone.');
    tracks.push(track);
  }
  const scene = Canvas.scene, nodes: THREE.Object3D[] = [];
  scene.traverse(node => nodes.push(node));
  if (nodes.length > 16384) throw new BridgeError('INVALID_PARAMS', 'Scene exceeds 16384 nodes.');
  const saved = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.rotation.clone(), scale: node.scale.clone(), visible: node.visible }));
  const previousTime = Timeline.time, last = { ...Animator._last_values }, context = Animator.MolangParser.context;
  const hadAnimation = Object.hasOwn(context, 'animation'), previousAnimation: unknown = context.animation;
  const groups = tracks.map(track => ({ track, group: track.group }));
  try {
    Animator.showDefaultPose(true);
    if (clip) {
      Timeline.time = time!;
      for (const track of tracks) { Animator.resetLastValues(); track.displayFrame(1); }
    }
    scene.updateMatrixWorld(true);
    return cubes.map(cube => {
      if (!(cube instanceof Cube)) throw new BridgeError('INTERNAL_ERROR', 'Expected native Cube.');
      const mesh = cube.mesh, geometry = mesh.geometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) throw new BridgeError('INTERNAL_ERROR', 'Native cube has no bounding box.');
      const corners = Array.from({ length: 8 }, (_, i): Vector3 => {
        const p = box.min.clone().set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld);
        return [p.x, p.y, p.z];
      });
      return { cube_id: cube.uuid, corners };
    });
  } finally {
    let failed = false;
    const restore = (operation: () => void): void => { try { operation(); } catch { failed = true; } };
    for (const s of saved) restore(() => { s.node.position.copy(s.position); s.node.rotation.copy(s.rotation); s.node.scale.copy(s.scale); s.node.visible = s.visible; });
    restore(() => { Timeline.time = previousTime; });
    restore(() => {
      for (const key of Object.keys(Animator._last_values)) delete Animator._last_values[key];
      Object.assign(Animator._last_values, last);
      if (hadAnimation) context.animation = previousAnimation; else delete context.animation;
    });
    for (const g of groups) restore(() => { g.track.group = g.group; });
    restore(() => { scene.updateMatrixWorld(true); });
    if (failed) throw new BridgeError('INTERNAL_ERROR', 'Collision pose restoration failed; inspect application state.', true);
  }
}
