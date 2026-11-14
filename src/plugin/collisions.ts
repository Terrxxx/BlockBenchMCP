import { prepareShape, projectionOverlap } from '../shared/collision.js';
import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput } from '../shared/protocol.js';
import { findCubes } from './bones.js';
import type { BlockbenchHost, ProjectHandle } from './host.js';

export function checkCollisions(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'check_collisions'>, deadline: number): ToolOutput<'check_collisions'> {
  const cubes = findCubes(host, input.cube_ids);
  const animation = input.animation ? host.animations().find(a => a.uuid === input.animation!.animation_id) : undefined;
  if (input.animation) {
    if (!animation) throw new BridgeError('NOT_FOUND', 'Animation not found in the active project.');
    if (!host.animationEditable(animation)) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Only numeric local bone animations can be sampled.');
    if (host.keyframes(animation).length > 4096) throw new BridgeError('ANIMATION_LIMIT', 'Animation exceeds 4096 keyframes.');
    if (input.animation.times.some(t => t > animation.length)) throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS', 'Sample time exceeds clip length.');
  }
  const times: (number | null)[] = input.animation?.times ?? [null];
  const pairs: [number, number][] = [];
  const parent = (index: number): string => { const p = cubes[index]!.parent; return p === 'root' ? 'root' : p.uuid; };
  for (let a = 0; a < cubes.length; a++) for (let b = a + 1; b < cubes.length; b++) {
    if (input.include_same_bone || parent(a) !== parent(b)) pairs.push([a, b]);
  }
  if (pairs.length * times.length > 200000) throw new BridgeError('INVALID_PARAMS', 'Collision workload exceeds 200000 pair-samples; reduce cube_ids or sample times.');
  const collisions: ToolOutput<'check_collisions'>['collisions'] = [];
  const sampled: (number | null)[] = [];
  let checked = 0;
  const result = (complete: boolean): ToolOutput<'check_collisions'> => ({ project_id: project.uuid, animation_id: animation?.uuid ?? null, sampled_times: sampled, checked_pairs: checked, complete, collisions,
    warnings: ['Potential intersections of solid cube volumes, not a physics or visual-quality verdict; intentional joints may overlap.', 'Only the listed times and selected pairs are checked; unsampled motion may intersect.', 'Native sampling honors current host animation channel mute settings.', ...(input.include_same_bone ? [] : ['Cubes with the same direct parent bone are excluded.']), ...(!complete ? ['Result limit reached; the requested check is incomplete.'] : [])] });
  for (const time of times) {
    if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Collision deadline elapsed; no model data was changed.');
    const shapes = host.collisionShapes(cubes, animation, time ?? undefined).map(prepareShape);
    if (shapes.length !== cubes.length || shapes.some((s, i) => s.cube_id !== cubes[i]!.uuid)) throw new BridgeError('INTERNAL_ERROR', 'Host returned mismatched collision shapes.');
    sampled.push(time);
    for (const [a, b] of pairs) {
      if (Date.now() >= deadline) throw new BridgeError('TIMEOUT', 'Collision deadline elapsed; no model data was changed.');
      const overlap = projectionOverlap(shapes[a]!, shapes[b]!, input.tolerance);
      checked++;
      if (overlap !== null) {
        if (collisions.length === input.max_results) return result(false);
        collisions.push({ cube_a: cubes[a]!.uuid, cube_b: cubes[b]!.uuid, time, min_projection_overlap: overlap });
      }
    }
  }
  return result(true);
}
