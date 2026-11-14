import { BridgeError } from '../shared/errors.js';
import { decodePngDataUrl } from '../shared/png.js';
import type { RenderInput } from '../shared/schemas/render.js';
import type { Workspace } from '../shared/workspace.js';
import type { BlockbenchHost, ProjectHandle } from './host.js';
import type { ToolOutput } from '../shared/protocol.js';

export function renderProject(host: BlockbenchHost, workspace: Workspace, input: RenderInput,
  deadline: number, activeProject: () => ProjectHandle): ToolOutput<'render_project'> {
  const project = activeProject();
  const ready = (): void => {
    if (activeProject() !== project) throw new BridgeError('PROJECT_MISMATCH','Project changed during rendering.');
    if (Date.now() >= deadline) throw new BridgeError('TIMEOUT','Render deadline elapsed before writing.');
    workspace.exportTarget(input.path,'texture_png',input.overwrite);
    for (const resource of host.resourcePaths()) workspace.assertResource(resource);
    if (host.textures().some(t=>!t.internal)) throw new BridgeError('INVALID_TEXTURE','Rendering requires internal textures.');
  };
  ready();
  const animation = input.animation ? host.animations().find(a=>a.uuid===input.animation!.animation_id) : undefined;
  if (input.animation) {
    if (!animation) throw new BridgeError('NOT_FOUND','Animation not found in the active project.');
    if (!host.animationEditable(animation)) throw new BridgeError('UNSUPPORTED_ANIMATION','Only numeric bone animations can be rendered.');
    if (input.animation.time > animation.length) throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS','Render time exceeds clip length.');
    if (host.keyframes(animation).length > 4096) throw new BridgeError('ANIMATION_LIMIT','Animation exceeds 4096 keyframes.');
  }
  let writing = false;
  try {
    const dataUrl = host.renderPng(input,animation);
    ready();
    const {bytes,info} = decodePngDataUrl(dataUrl);
    if (info.width !== input.width || info.height !== input.height) throw new BridgeError('RENDER_FAILED','Renderer returned unexpected image dimensions.');
    ready();
    const target = workspace.exportTarget(input.path,'texture_png',input.overwrite);
    writing=true;
    host.writeResource(dataUrl,target,true);
    const written = workspace.resolve(input.path);
    if (workspace.fs.statSync(written).size !== bytes.length) throw new Error('PNG size verification failed');
    const actual=workspace.fs.readFileSync(written);
    if (actual.length!==bytes.length || !bytes.every((v,i)=>actual[i]===v)) throw new Error('PNG verification failed');
    return {project_id:project.uuid,path:input.path.replace(/\\/g,'/'),bytes:bytes.length,width:info.width,height:info.height,
      animation_id:animation?.uuid??null,time:input.animation?.time??null,
      warnings:['Renders use current host materials, lighting and channel mute settings. Camera coordinates are Blockbench preview world coordinates.']};
  } catch (error) {
    if (!writing && error instanceof BridgeError) throw error;
    throw new BridgeError('RENDER_FAILED',writing?'PNG write or verification failed; inspect the target before retrying.':'Official rendering failed before writing.',writing);
  }
}
