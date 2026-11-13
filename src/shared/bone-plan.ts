import { BridgeError } from './errors.js';
import type { BoneInput, BoneUpdate } from './schemas/bones.js';

export interface BoneRecord { id: string; name: string; parent_id: string | null }

export function assertUniqueNames(names: readonly string[]): void {
  if (new Set(names).size !== names.length) throw new BridgeError('NAME_CONFLICT', 'Bone names must be unique within the project.');
}

/** Iterative topological sort, also validates references and existing graph cycles. */
export function parentOrder(parents: ReadonlyMap<string, string | null>): string[] {
  const children = new Map<string, string[]>();
  const queue: string[] = [];
  for (const [id, parent] of parents) {
    if (parent === null) queue.push(id);
    else {
      if (!parents.has(parent)) throw new BridgeError('NOT_FOUND', 'A parent bone does not exist.');
      const list = children.get(parent) ?? [];
      list.push(id); children.set(parent, list);
    }
  }
  for (let index = 0; index < queue.length; index++) queue.push(...(children.get(queue[index]!) ?? []));
  if (queue.length !== parents.size) throw new BridgeError('HIERARCHY_CYCLE', 'Bone hierarchy must not contain a cycle.');
  return queue;
}

export function planBoneCreation(existing: readonly BoneRecord[], inputs: readonly BoneInput[]): BoneInput[] {
  assertUniqueNames([...existing.map(bone => bone.name), ...inputs.map(bone => bone.name)]);
  const parents = new Map(existing.map(bone => [`id:${bone.id}`, bone.parent_id === null ? null : `id:${bone.parent_id}`]));
  const specs = new Map(inputs.map(bone => [`key:${bone.key}`, bone]));
  for (const bone of inputs) {
    parents.set(`key:${bone.key}`, bone.parent_key !== undefined ? `key:${bone.parent_key}` : bone.parent_id ? `id:${bone.parent_id}` : null);
  }
  return parentOrder(parents).flatMap(key => { const spec = specs.get(key); return spec ? [spec] : []; });
}

export function planBoneUpdate(existing: readonly BoneRecord[], updates: readonly BoneUpdate[]): string[] {
  const records = new Map(existing.map(bone => [bone.id, { ...bone }]));
  for (const update of updates) {
    const bone = records.get(update.bone_id);
    if (!bone) throw new BridgeError('NOT_FOUND', 'A bone does not exist in the active project.');
    if (update.name !== undefined) bone.name = update.name;
    if (update.parent_id !== undefined) bone.parent_id = update.parent_id;
  }
  assertUniqueNames([...records.values()].map(bone => bone.name));
  return parentOrder(new Map([...records.values()].map(bone => [bone.id, bone.parent_id])));
}
