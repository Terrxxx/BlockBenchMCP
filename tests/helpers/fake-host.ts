import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { BlockbenchHost, CubeHandle, GroupHandle, ProjectHandle, TextureHandle } from '../../src/plugin/host.js';
import type { CubeInput, ToolInput } from '../../src/shared/protocol.js';
import type { BoneInput, BoneUpdate } from '../../src/shared/schemas/bones.js';
import type { PngInfo } from '../../src/shared/png.js';

// Native Blockbench GUIDs need not have RFC UUID version/variant bits. Force
// that case in every host fixture so the full MCP path exercises compatibility.
function nativeId(): string {
  const uuid = randomUUID();
  return `${uuid.slice(0, 14)}0${uuid.slice(15, 19)}0${uuid.slice(20)}`;
}

/** Behavioral test double. Its output is deliberately NOT a bbmodel serializer. */
export class FakeHost implements BlockbenchHost {
  version = '5.2.2';
  desktop = true;
  project: ProjectHandle | null = null;
  elements: CubeHandle[] = [];
  bones: GroupHandle[] = [];
  atlases: TextureHandle[] = [];
  resources: string[] = [];
  calls: string[] = [];
  editing = false;
  failAttachAt = -1;
  failWrite = false;
  failGroupAt = -1;
  failUpdate = false;
  failAddTexture = false;
  failApplyTexture = false;
  decodeGate: Promise<void> | undefined;
  private before: { cubes: CubeHandle[]; groups: GroupHandle[]; textures: TextureHandle[] } | undefined;
  getProject(): ProjectHandle | null { return this.project; }
  cubes(): CubeHandle[] { return this.elements; }
  groups(): GroupHandle[] { return this.bones; }
  textures(): TextureHandle[] { return this.atlases; }
  resourcePaths(): string[] { return this.resources; }
  isEditing(): boolean { return this.editing; }
  createProject(input: ToolInput<'create_project'>): ProjectHandle {
    this.calls.push('newProject'); this.elements = []; this.bones = []; this.atlases = [];
    this.project = { uuid: nativeId(), ...input, format: { id: 'bedrock' }, saved: false, save_path: '' };
    return this.project;
  }
  beginEdit(): void {
    this.calls.push('initEdit'); this.editing = true;
    this.before = structuredClone({ cubes: this.elements, groups: this.bones, textures: this.atlases });
  }
  makeRoot(): GroupHandle {
    const group = this.makeGroup({ name: 'root', origin: [0, 0, 0], rotation: [0, 0, 0] });
    this.attachGroup(group, 'root', true); return group;
  }
  makeGroup(input: Pick<BoneInput, 'name' | 'origin' | 'rotation'>): GroupHandle {
    return { uuid: nativeId(), name: input.name, origin: [...input.origin], rotation: [...input.rotation], parent: 'root' };
  }
  attachGroup(group: GroupHandle, parent: GroupHandle | 'root', initialize: boolean): void {
    group.parent = parent;
    if (initialize) {
      this.bones.push(group); this.calls.push('Group.init');
      if (this.bones.length === this.failGroupAt) throw new Error('Injected group failure');
    } else this.calls.push('Group.addTo');
  }
  updateGroup(group: GroupHandle, input: Pick<BoneUpdate, 'name' | 'origin' | 'rotation'>): void {
    Object.assign(group, structuredClone(input));
    if (this.failUpdate) throw new Error('Injected update failure');
  }
  makeCube(input: CubeInput): CubeHandle {
    this.calls.push('Cube'); return { uuid: nativeId(), ...input, parent: 'root', box_uv: true,
      faces: { north:{texture:false},east:{texture:false},south:{texture:false},west:{texture:false},up:{texture:false},down:{texture:false} },
    };
  }
  attachCube(cube: CubeHandle, group: GroupHandle): void {
    this.calls.push('Cube.init'); cube.parent = group; this.elements.push(cube);
    if (this.elements.length === this.failAttachAt) throw new Error('Injected partial cube initialization failure');
  }
  reparentCube(cube: CubeHandle, group: GroupHandle): void { cube.parent = group; this.calls.push('Cube.addTo'); }
  async prepareTexture(name: string, _dataUrl: string, info: PngInfo): Promise<TextureHandle> {
    this.calls.push('Texture.decode'); await this.decodeGate;
    return { uuid: nativeId(), name, ...info, internal: true };
  }
  addTexture(texture: TextureHandle): void { this.calls.push('Texture.add(false)'); this.atlases.push(texture); if (this.failAddTexture) throw new Error('Injected add failure'); }
  disposeTexture(): void { this.calls.push('Texture.dispose'); }
  applyTexture(cube: CubeHandle, texture: TextureHandle): void {
    this.calls.push('Cube.applyTexture');
    for (const face of Object.values(cube.faces)) if (face.texture !== null) face.texture = texture.uuid;
    if (this.failApplyTexture) throw new Error('Injected binding failure');
  }
  setCubeUV(cube: CubeHandle, uv: { uv_offset: [number, number]; mirror_uv?: boolean }): void {
    cube.box_uv = true; cube.uv_offset = [...uv.uv_offset]; if (uv.mirror_uv !== undefined) cube.mirror_uv = uv.mirror_uv;
  }
  finishEdit(): void { this.calls.push('finishEdit'); this.editing = false; this.project!.saved = false; }
  cancelEdit(): void {
    this.calls.push('cancelEdit(true)'); this.elements = this.before!.cubes; this.bones = this.before!.groups; this.atlases = this.before!.textures; this.editing = false;
  }
  refresh(): void { this.calls.push('Canvas.updateAll'); }
  compileProject(): string { this.calls.push('Codecs.project.compile'); return 'TEST_ONLY_OFFICIAL_CODEC_STUB'; }
  writeProject(content: string, target: string): void {
    this.calls.push('Codecs.project.write');
    if (this.failWrite) throw new Error('Injected write failure');
    fs.writeFileSync(target, content);
    this.project!.saved = true;
  }
}
