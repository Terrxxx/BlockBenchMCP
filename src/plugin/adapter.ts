import * as path from 'node:path';
import { BridgeError } from '../shared/errors.js';
import { inputSchemas, type Request, type ToolInput, type ToolOutput } from '../shared/protocol.js';
import type { Workspace } from '../shared/workspace.js';
import type { BlockbenchHost, CubeHandle, ProjectHandle } from './host.js';
import { createBones, findGroup, reparentCubes, updateBones } from './bones.js';
import { edit } from './edits.js';
import { assignTexture, importTexture, setCubeUV, textureSummary } from './textures.js';
import { createAnimation, updateAnimation, setKeyframes, deleteKeyframes, getAnimationState, previewAnimation } from './animations.js';
import { exportResource } from './exports.js';

export class BlockbenchAdapter {
  private readonly managed = new Set<string>();
  private readonly roots = new Map<string, string>();
  constructor(private readonly host: BlockbenchHost, private readonly workspace: Workspace) {}

  execute(request: Request): unknown {
    this.assertHost();
    switch (request.command) {
      case 'export_bedrock_model':
      case 'export_bedrock_animations':
      case 'export_texture_png':
        return exportResource(this.host, this.workspace, request, request.deadline_ms, () => this.mutableProject(request.params.project_id));
      case 'create_animation': return createAnimation(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'update_animation': return updateAnimation(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'set_keyframes': return setKeyframes(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'delete_keyframes': return deleteKeyframes(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'get_animation_state': return getAnimationState(this.host, request.params);
      case 'preview_animation': return previewAnimation(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'create_project': return this.createProject(inputSchemas.create_project.parse(request.params));
      case 'get_project_state': return this.getProjectState(inputSchemas.get_project_state.parse(request.params));
      case 'create_cubes': return this.createCubes(inputSchemas.create_cubes.parse(request.params));
      case 'save_project': return this.saveProject(inputSchemas.save_project.parse(request.params));
      case 'create_bones': return createBones(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'update_bones': return updateBones(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'reparent_cubes': return reparentCubes(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'import_texture': return importTexture(this.host, this.workspace, request.params, request.deadline_ms, () => this.mutableProject(request.params.project_id));
      case 'assign_texture': return assignTexture(this.host, this.mutableProject(request.params.project_id), request.params);
      case 'set_cube_uv': return setCubeUV(this.host, this.mutableProject(request.params.project_id), request.params);
    }
  }

  private assertHost(): void {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(this.host.version);
    if (!this.host.desktop || !match || Number(match[1]) !== 5
      || Number(match[2]) < 2 || (Number(match[2]) === 2 && Number(match[3]) < 2)) {
      throw new BridgeError('UNSUPPORTED_HOST', 'This plugin requires stable Blockbench desktop 5.2.2 or newer within major 5.');
    }
  }

  private summary(project: ProjectHandle): ToolOutput<'create_project'>['project'] {
    return {
      id: project.uuid, name: project.name, format: project.format.id,
      model_identifier: project.model_identifier, saved: project.saved,
      texture_width: project.texture_width, texture_height: project.texture_height,
      cube_count: this.host.cubes().length, group_count: this.host.groups().length, texture_count: this.host.textures().length,
      managed: this.managed.has(project.uuid),
    };
  }

  private mutableProject(id: string): ProjectHandle {
    const project = this.host.getProject();
    if (!project) throw new BridgeError('NO_PROJECT', 'There is no active Blockbench project.');
    if (project.uuid !== id) throw new BridgeError('PROJECT_MISMATCH', 'The active project changed; select the intended project and inspect its state.');
    if (!this.managed.has(id)) throw new BridgeError('PROJECT_NOT_OWNED', 'Only projects created by this plugin connection session can be modified.');
    if (project.format.id !== 'bedrock') throw new BridgeError('UNSUPPORTED_FORMAT', 'Only Bedrock Entity projects are supported.');
    if (this.host.isEditing()) throw new BridgeError('BUSY', 'Finish the active Blockbench edit first.');
    return project;
  }

  private createProject(input: ToolInput<'create_project'>): ToolOutput<'create_project'> {
    if (this.host.isEditing()) throw new BridgeError('BUSY', 'Finish the active Blockbench edit first.');
    try {
      const project = this.host.createProject(input);
      this.managed.add(project.uuid);
      this.host.refresh();
      return { project: this.summary(project) };
    } catch { throw new BridgeError('INTERNAL_ERROR', 'Project creation failed; inspect open tabs before retrying.', true); }
  }

  private getProjectState(input: ToolInput<'get_project_state'>): ToolOutput<'get_project_state'> {
    const project = this.host.getProject();
    if (!project) return { project: null, cubes: [], offset: input.offset, next_offset: null, bones: [], bone_offset: input.bone_offset, next_bone_offset: null,
      textures: [], texture_offset: input.texture_offset, next_texture_offset: null };
    const cubes = this.host.cubes();
    const page = cubes.slice(input.offset, input.offset + input.limit).map(cube => ({
      id: cube.uuid, name: cube.name, from: [...cube.from] as typeof cube.from,
      to: [...cube.to] as typeof cube.to, origin: [...cube.origin] as typeof cube.origin,
      rotation: [...cube.rotation] as typeof cube.rotation,
      parent_id: cube.parent === 'root' ? null : cube.parent.uuid,
      box_uv: cube.box_uv, uv_offset: [...cube.uv_offset] as [number, number], mirror_uv: cube.mirror_uv,
      texture_ids: [...new Set(Object.values(cube.faces).map(face => face.texture).filter((value): value is string => typeof value === 'string'))],
    }));
    const bones = this.host.groups();
    const bonePage = bones.slice(input.bone_offset, input.bone_offset + input.limit).map(bone => ({
      id: bone.uuid, name: bone.name, origin: [...bone.origin] as typeof bone.origin,
      rotation: [...bone.rotation] as typeof bone.rotation, parent_id: bone.parent === 'root' ? null : bone.parent.uuid,
    }));
    const textures = this.host.textures();
    const texturePage = textures.slice(input.texture_offset, input.texture_offset + input.limit).map(textureSummary);
    return {
      project: this.summary(project), cubes: page, offset: input.offset,
      next_offset: input.offset + page.length < cubes.length ? input.offset + page.length : null,
      bones: bonePage, bone_offset: input.bone_offset,
      next_bone_offset: input.bone_offset + bonePage.length < bones.length ? input.bone_offset + bonePage.length : null,
      textures: texturePage, texture_offset: input.texture_offset,
      next_texture_offset: input.texture_offset + texturePage.length < textures.length ? input.texture_offset + texturePage.length : null,
    };
  }

  private createCubes(input: ToolInput<'create_cubes'>): ToolOutput<'create_cubes'> {
    const project = this.mutableProject(input.project_id);
    const cubes: CubeHandle[] = [];
    let root = input.parent_id ? findGroup(this.host, input.parent_id)
      : this.host.groups().find(group => group.uuid === this.roots.get(project.uuid))
        ?? this.host.groups().find(group => group.name === 'root' && group.parent === 'root');
    if (!root && this.host.groups().some(group => group.name === 'root')) throw new BridgeError('NAME_CONFLICT', 'A nested bone already uses the default root name; specify parent_id.');
    const scope = () => ({ elements: cubes, groups: [...this.host.groups()], outliner: true, selection: true });
    return edit(this.host, project, 'Blockbench AI: Create cubes', scope(), scope, () => {
      root ??= this.host.makeRoot();
      for (const spec of input.cubes) {
        const cube = this.host.makeCube(spec);
        cubes.push(cube); // Include even a partially initialized cube in rollback.
        this.host.attachCube(cube, root);
      }
      if (!input.parent_id) this.roots.set(project.uuid, root.uuid);
      return { project_id: project.uuid, cube_ids: cubes.map(cube => cube.uuid), count: cubes.length, root_group_id: root.uuid };
    });
  }

  private saveProject(input: ToolInput<'save_project'>): ToolOutput<'save_project'> {
    const project = this.mutableProject(input.project_id);
    const target = this.workspace.saveTarget(input.path, input.overwrite);
    for (const resource of this.host.resourcePaths()) this.workspace.assertResource(resource);
    const previous = { save_path: project.save_path, name: project.name, saved: project.saved };
    let writing = false;
    try {
      project.save_path = target;
      project.name = path.basename(target, path.extname(target));
      const content = this.host.compileProject();
      // Recheck after compile hooks, immediately before the official synchronous writer.
      this.mutableProject(project.uuid);
      this.workspace.saveTarget(input.path, input.overwrite);
      project.saved = false;
      writing = true;
      this.host.writeProject(content, target);
      if (!project.saved) throw new Error('Official codec did not mark the project as saved.');
      const bytes = this.workspace.fs.statSync(this.workspace.resolve(input.path)).size;
      if (bytes !== new TextEncoder().encode(content).byteLength) throw new Error('Saved file size differs from compiled content.');
      return { project_id: project.uuid, path: input.path.replace(/\\/g, '/'), bytes, saved: true };
    } catch (error) {
      Object.assign(project, previous);
      if (error instanceof BridgeError) throw error;
      throw new BridgeError('SAVE_FAILED', 'Official project save failed; project metadata was restored. Check the target before retrying.', writing);
    }
  }
}
