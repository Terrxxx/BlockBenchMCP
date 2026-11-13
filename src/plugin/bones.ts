import { planBoneCreation, planBoneUpdate, type BoneRecord } from '../shared/bone-plan.js';
import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput } from '../shared/protocol.js';
import { edit } from './edits.js';
import type { BlockbenchHost, CubeHandle, GroupHandle, ProjectHandle } from './host.js';

export function findGroup(host: BlockbenchHost, id: string): GroupHandle {
  const group = host.groups().find(item => item.uuid === id);
  if (!group) throw new BridgeError('NOT_FOUND', 'The parent bone does not exist in the active project.');
  return group;
}
export function findCubes(host: BlockbenchHost, ids: readonly string[]): CubeHandle[] {
  const all = new Map(host.cubes().map(cube => [cube.uuid, cube]));
  return ids.map(id => {
    const cube = all.get(id);
    if (!cube) throw new BridgeError('NOT_FOUND', 'A cube does not exist in the active project.');
    return cube;
  });
}
function records(host: BlockbenchHost): BoneRecord[] {
  return host.groups().map(group => ({ id: group.uuid, name: group.name, parent_id: group.parent === 'root' ? null : group.parent.uuid }));
}

export function createBones(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'create_bones'>): ToolOutput<'create_bones'> {
  const plan = planBoneCreation(records(host), input.bones);
  const created = new Map<string, GroupHandle>();
  const scope = () => ({ elements: [], groups: [...new Set([...host.groups(), ...created.values()])], outliner: true, selection: true });
  return edit(host, project, 'Blockbench AI: Create bones', scope(), scope, () => {
    for (const spec of plan) {
      const parent = spec.parent_key !== undefined ? created.get(spec.parent_key)! : spec.parent_id ? findGroup(host, spec.parent_id) : 'root';
      const group = host.makeGroup(spec);
      created.set(spec.key, group);
      host.attachGroup(group, parent, true);
    }
    return { project_id: project.uuid, count: created.size, bones: input.bones.map(spec => ({ key: spec.key, id: created.get(spec.key)!.uuid })) };
  });
}

export function updateBones(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'update_bones'>): ToolOutput<'update_bones'> {
  const order = planBoneUpdate(records(host), input.bones);
  const updates = new Map(input.bones.map(value => [value.bone_id, value]));
  const groups = new Map(host.groups().map(group => [group.uuid, group]));
  const scope = () => ({ elements: [], groups: [...host.groups()], outliner: true, selection: true });
  return edit(host, project, 'Blockbench AI: Update bones', scope(), scope, () => {
    // Avoid temporarily creating cycles when a valid final hierarchy swaps ancestors.
    for (const update of input.bones) if (update.parent_id !== undefined) host.attachGroup(groups.get(update.bone_id)!, 'root', false);
    for (const id of order) {
      const update = updates.get(id);
      if (!update) continue;
      const group = groups.get(id)!;
      const patch: Parameters<BlockbenchHost['updateGroup']>[1] = {};
      if (update.name !== undefined) patch.name = update.name;
      if (update.origin !== undefined) patch.origin = update.origin;
      if (update.rotation !== undefined) patch.rotation = update.rotation;
      host.updateGroup(group, patch);
      if (update.parent_id !== undefined) host.attachGroup(group, update.parent_id === null ? 'root' : groups.get(update.parent_id)!, false);
    }
    return { project_id: project.uuid, count: input.bones.length, bone_ids: input.bones.map(bone => bone.bone_id) };
  });
}

export function reparentCubes(host: BlockbenchHost, project: ProjectHandle, input: ToolInput<'reparent_cubes'>): ToolOutput<'reparent_cubes'> {
  const parent = findGroup(host, input.parent_id);
  const cubes = findCubes(host, input.cube_ids);
  const scope = { elements: cubes, groups: [...host.groups()], outliner: true, selection: true };
  return edit(host, project, 'Blockbench AI: Reparent cubes', scope, () => scope, () => {
    for (const cube of cubes) host.reparentCube(cube, parent);
    return { project_id: project.uuid, count: cubes.length, cube_ids: input.cube_ids, parent_id: parent.uuid };
  });
}
