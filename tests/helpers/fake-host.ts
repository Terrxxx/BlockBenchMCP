import type { AnimationHandle, KeyframeHandle } from '../../src/plugin/animation-host.js';
import type { KeyframeInput } from '../../src/shared/schemas/animations.js';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { BlockbenchHost, CubeHandle, EditScope, GroupHandle, ProjectHandle, TextureHandle } from '../../src/plugin/host.js';
import type { CubeInput, ToolInput } from '../../src/shared/protocol.js';
import type { BoneInput, BoneUpdate } from '../../src/shared/schemas/bones.js';
import type { PngInfo } from '../../src/shared/png.js';
import type { RenderInput } from '../../src/shared/schemas/render.js';
import { pngFixture } from './png.js';
import type { BeamGeometry } from '../../src/shared/beam-geometry.js';
import type { Vector3 } from '../../src/shared/schemas/common.js';

// Native Blockbench GUIDs need not have RFC UUID version/variant bits. Force
// that case in every host fixture so the full MCP path exercises compatibility.
function nativeId(): string {
  const uuid = randomUUID();
  return `${uuid.slice(0, 14)}0${uuid.slice(15, 19)}0${uuid.slice(20)}`;
}

/** Behavioral test double. Its output is deliberately NOT a bbmodel serializer. */
export class FakeHost implements BlockbenchHost {
  eulerOrder():string{return 'ZYX';}
  updateCubeGeometry(cube:CubeHandle,geometry:BeamGeometry):void {
    Object.assign(cube,structuredClone(geometry));
    if(this.failUpdate)throw new Error('Injected cube update failure');
  }
  beamEndpoints(cube:CubeHandle):[Vector3,Vector3] {
    // Independent sequential axis rotations (Rx, Ry, Rz), not solver formula.
    return [cube.from[1],cube.to[1]].map(y=>{
      let p=[(cube.from[0]+cube.to[0])/2-cube.origin[0],y-cube.origin[1],(cube.from[2]+cube.to[2])/2-cube.origin[2]];
      for(let axis=0;axis<3;axis++){
        const a=(axis+1)%3,b=(axis+2)%3,r=cube.rotation[axis]!*Math.PI/180,c=Math.cos(r),s=Math.sin(r),oldA=p[a]!,oldB=p[b]!;
        p[a]=c*oldA-s*oldB;p[b]=s*oldA+c*oldB;
      }
      return p.map((v,i)=>v+cube.origin[i]!) as Vector3;
    }) as [Vector3,Vector3];
  }
  version = '5.2.2';
  desktop = true;
  renderPng(input:RenderInput):string {this.calls.push('Preview.render');return `data:image/png;base64,${pngFixture(input.width,input.height).toString('base64')}`;}
  project: ProjectHandle | null = null;
  elements: CubeHandle[] = [];
  bones: GroupHandle[] = [];
  atlases: TextureHandle[] = [];
  textureSources = new Map<string, string>();
  clips: AnimationHandle[] = [];
  frames: Record<string, KeyframeHandle[]> = {};
  failKeyframeAt = -1;
  failRemoveAt = -1;
  resources: string[] = [];
  calls: string[] = [];
  editing = false;
  lastBeforeScope: EditScope | undefined;
  lastAfterScope: EditScope | undefined;
  failAttachAt = -1;
  failWrite = false;
  failGroupAt = -1;
  failUpdate = false;
  failAddTexture = false;
  failApplyTexture = false;
  decodeGate: Promise<void> | undefined;
  private before: { cubes: CubeHandle[]; groups: GroupHandle[]; textures: TextureHandle[]; clips: AnimationHandle[]; frames: Record<string, KeyframeHandle[]> } | undefined;
  getProject(): ProjectHandle | null { return this.project; }
  cubes(): CubeHandle[] { return this.elements; }
  groups(): GroupHandle[] { return this.bones; }
  textures(): TextureHandle[] { return this.atlases; }
  animations(): AnimationHandle[] { return this.clips; }
  keyframes(a: AnimationHandle): KeyframeHandle[] { return this.frames[a.uuid] ?? []; }
  animationEditable(a: AnimationHandle): boolean { return this.keyframes(a).every(f => f.data_points.every(p => [p.x,p.y,p.z].every(v => typeof v === 'number'))); }
  makeAnimation(input: ToolInput<'create_animation'>): AnimationHandle { return { uuid: nativeId(), name: input.name, length: input.length, loop: input.loop, snapping: input.snapping }; }
  addAnimation(a: AnimationHandle): void { this.clips.push(a); this.frames[a.uuid] = []; }
  updateAnimation(a: AnimationHandle, input: ToolInput<'update_animation'>): void {
    for (const key of ['name','length','loop','snapping'] as const) if(input[key] !== undefined) Object.assign(a, { [key]: input[key] });
  }
  prepareAnimationEdit(): void { this.calls.push('Animation.select'); }
  putKeyframe(a: AnimationHandle, input: KeyframeInput, existing?: KeyframeHandle): KeyframeHandle {
    if(this.keyframes(a).length === this.failKeyframeAt) throw new Error('Injected keyframe failure');
    const f = existing ?? { uuid: nativeId(), animator: { uuid: input.bone_id }, time: input.time, channel: input.channel, interpolation: input.interpolation, data_points: [] };
    Object.assign(f, { time: input.time, interpolation: input.interpolation, data_points: [{x:input.value[0],y:input.value[1],z:input.value[2]}] });
    if(!existing) this.frames[a.uuid]!.push(f);
    return f;
  }
  removeKeyframe(f: KeyframeHandle): void {
    const list = Object.values(this.frames).find(frames => frames.includes(f))!;
    if(list.length === this.failRemoveAt) throw new Error('Injected remove failure');
    list.splice(list.indexOf(f),1);
  }
  previewAnimation(_a: AnimationHandle, time: number): number { this.calls.push('Animator.preview'); return time; }
  resourcePaths(): string[] { return this.resources; }
  isEditing(): boolean { return this.editing; }
  createProject(input: ToolInput<'create_project'>): ProjectHandle {
    this.calls.push('newProject'); this.elements = []; this.bones = []; this.atlases = []; this.clips = []; this.frames = {};
    this.project = { uuid: nativeId(), ...input, format: { id: 'bedrock' }, saved: false, save_path: '' };
    return this.project;
  }
  beginEdit(scope: EditScope): void {
    this.lastBeforeScope = scope;
    this.calls.push('initEdit'); this.editing = true;
    this.before = structuredClone({ cubes: this.elements, groups: this.bones, textures: this.atlases, clips: this.clips, frames: this.frames });
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
  async prepareTexture(name: string, dataUrl: string, info: PngInfo): Promise<TextureHandle> {
    this.calls.push('Texture.decode'); await this.decodeGate;
    const texture = { uuid: nativeId(), name, ...info, internal: true };
    this.textureSources.set(texture.uuid, dataUrl);
    return texture;
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
  finishEdit(_label: string, scope: EditScope): void { this.lastAfterScope = scope; this.calls.push('finishEdit'); this.editing = false; this.project!.saved = false; }
  cancelEdit(): void {
    this.calls.push('cancelEdit(true)'); this.elements = this.before!.cubes; this.bones = this.before!.groups; this.atlases = this.before!.textures; this.clips = this.before!.clips; this.frames = this.before!.frames; this.editing = false;
  }
  refresh(): void { this.calls.push('Canvas.updateAll'); }
  compileProject(): string { this.calls.push('Codecs.project.compile'); return 'TEST_ONLY_OFFICIAL_CODEC_STUB'; }
  compileBedrockModel(): unknown {
    this.calls.push('Codecs.bedrock.compile');
    return { format_version: 'TEST_ONLY', 'minecraft:geometry': [{ description: { identifier: 'geometry.test_stub' } }] };
  }
  compileBedrockAnimations(animations: AnimationHandle[]): unknown {
    this.calls.push('AnimationCodec.compileFile');
    return { format_version: 'TEST_ONLY', animations: Object.fromEntries(animations.map(a => [a.name, { test_stub: true }])) };
  }
  textureDataUrl(texture: TextureHandle): string { return this.textureSources.get(texture.uuid) ?? ''; }
  writeResource(content: string, target: string, image: boolean): void {
    this.calls.push('Blockbench.writeFile');
    if (this.failWrite) throw new Error('Injected write failure');
    fs.writeFileSync(target, image ? Buffer.from(content.split(',')[1]!, 'base64') : content);
  }
  writeProject(content: string, target: string): void {
    this.calls.push('Codecs.project.write');
    if (this.failWrite) throw new Error('Injected write failure');
    fs.writeFileSync(target, content);
    this.project!.saved = true;
  }
}
