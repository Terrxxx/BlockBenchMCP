import type { CubeInput, ToolInput, Vector3 } from '../shared/protocol.js';
import type { BoneInput } from '../shared/schemas/bones.js';
import type { PngInfo } from '../shared/png.js';
import type { AnimationHandle, AnimationHost, KeyframeHandle } from './animation-host.js';
import type { ExportHost } from './export-host.js';
import type { RenderInput } from '../shared/schemas/render.js';
import type { BeamGeometry } from '../shared/beam-geometry.js';

/** Narrow, typed seam around the official host API; no dynamically named calls. */
export interface ProjectHandle {
  uuid: string;
  name: string;
  model_identifier: string;
  format: { id: string };
  texture_width: number;
  texture_height: number;
  saved: boolean;
  save_path: string;
}
export interface GroupHandle {
  uuid: string; name: string; origin: Vector3; rotation: Vector3; parent: { uuid: string } | 'root';
}
export interface CubeHandle {
  uuid: string;
  name: string;
  from: Vector3;
  to: Vector3;
  origin: Vector3;
  rotation: Vector3;
  parent: { uuid: string } | 'root';
  box_uv: boolean;
  uv_offset: [number, number];
  mirror_uv: boolean;
  faces: Record<string, { texture: string | false | null | undefined }>;
}
export interface TextureHandle { uuid: string; name: string; width: number; height: number; internal: boolean }
export interface BlockbenchHost extends AnimationHost, ExportHost {
  eulerOrder(): string;
  beamEndpoints(cube:CubeHandle): [Vector3,Vector3];
  updateCubeGeometry(cube:CubeHandle,geometry:BeamGeometry):void;
  renderPng(input: RenderInput, animation?: AnimationHandle): string;
  readonly version: string;
  readonly desktop: boolean;
  getProject(): ProjectHandle | null;
  cubes(): CubeHandle[];
  groups(): GroupHandle[];
  textures(): TextureHandle[];
  resourcePaths(): string[];
  isEditing(): boolean;
  createProject(input: ToolInput<'create_project'>): ProjectHandle;
  beginEdit(scope: EditScope): void;
  makeRoot(): GroupHandle;
  makeGroup(input: Pick<BoneInput, 'name' | 'origin' | 'rotation'>): GroupHandle;
  attachGroup(group: GroupHandle, parent: GroupHandle | 'root', initialize: boolean): void;
  updateGroup(group: GroupHandle, input: { name?: string; origin?: Vector3; rotation?: Vector3 }): void;
  makeCube(input: CubeInput): CubeHandle;
  attachCube(cube: CubeHandle, group: GroupHandle): void;
  reparentCube(cube: CubeHandle, group: GroupHandle): void;
  prepareTexture(name: string, dataUrl: string, info: PngInfo, timeoutMs: number): Promise<TextureHandle>;
  addTexture(texture: TextureHandle): void;
  disposeTexture(texture: TextureHandle): void;
  applyTexture(cube: CubeHandle, texture: TextureHandle): void;
  setCubeUV(cube: CubeHandle, uv: { uv_offset: [number, number]; mirror_uv?: boolean }): void;
  finishEdit(label: string, scope: EditScope): void;
  cancelEdit(scope: EditScope): void;
  refresh(): void;
  compileProject(): string;
  writeProject(content: string, target: string): void;
}

export interface EditScope {
  animations?: AnimationHandle[];
  keyframes?: KeyframeHandle[];
  elements: CubeHandle[];
  groups?: GroupHandle[];
  outliner?: boolean;
  selection?: boolean;
  textures?: TextureHandle[];
  bitmap?: boolean;
}
