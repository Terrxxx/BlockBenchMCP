import { z } from 'zod';
import { BridgeError } from '../shared/errors.js';
import type { BlockbenchHost, CubeHandle, EditScope, GroupHandle } from './host.js';
import { disposeNativeTexture, nativeTexture, prepareNativeTexture } from './native-texture.js';
import { nativeAnimation, nativeAnimationHost, nativeKeyframe, refreshNativeAnimation } from './native-animation.js';
import { nativeExportHost } from './native-export.js';
import { renderNativePng } from './native-render.js';

function nativeCube(cube: CubeHandle): Cube {
  if (!(cube instanceof Cube)) throw new Error('Expected native Cube');
  return cube;
}
function nativeGroup(group: GroupHandle): Group {
  if (!(group instanceof Group)) throw new Error('Expected native Group');
  return group;
}
function projectCodec(): Codec {
  const codec = Codecs.project;
  if (!codec || typeof codec.compile !== 'function' || typeof codec.write !== 'function') {
    throw new BridgeError('UNSUPPORTED_HOST', 'Official project codec is unavailable.');
  }
  return codec;
}

function nativeScope(scope: EditScope): UndoAspects {
  const { groups, textures, animations, keyframes, ...rest } = scope;
  return { ...rest, elements: scope.elements.map(nativeCube), ...(groups ? { groups: groups.map(nativeGroup) } : {}),
    ...(textures ? { textures: textures.map(nativeTexture) } : {}),
    ...(animations ? { animations: animations.map(nativeAnimation) } : {}),
    ...(keyframes ? { keyframes: keyframes.map(nativeKeyframe) } : {}),
  };
}

export function createNativeHost(): BlockbenchHost {
  return {
    eulerOrder: () => Format.euler_order,
    updateCubeGeometry: (cube,geometry) => {nativeCube(cube).extend(geometry);},
    beamEndpoints: cube => {
      const c=nativeCube(cube);
      if(c.inflate!==0 || c.rescale || c.stretch.some(v=>v!==1))throw new BridgeError('INVALID_PARAMS','Beam tools require no inflate, stretch or rescale.');
      c.mesh.updateMatrix();
      const parent=c.parent instanceof Group?c.parent.origin:[0,0,0];
      return [c.from[1],c.to[1]].map(y=>{
        const point=c.mesh.position.clone().set((c.from[0]+c.to[0])/2-c.origin[0],y-c.origin[1],(c.from[2]+c.to[2])/2-c.origin[2]);
        point.applyMatrix4(c.mesh.matrix);
        return [point.x+parent[0]!,point.y+parent[1]!,point.z+parent[2]!];
      }) as [[number,number,number],[number,number,number]];
    },
    ...nativeAnimationHost(),
    ...nativeExportHost(),
    renderPng: renderNativePng,
    get version() { return Blockbench.version; },
    get desktop() { return !Blockbench.isWeb; },
    getProject: () => typeof Project === 'undefined' || !Project ? null : Project,
    cubes: () => Cube.all,
    groups: () => Group.all,
    textures: () => Texture.all,
    resourcePaths: () => {
      const textures = Texture.all.map(texture => texture.path).filter((value): value is string => Boolean(value));
      const references = z.array(z.object({ source: z.string().optional() }).passthrough())
        .parse(Project?.reference_images ?? []).map(image => image.source)
        .filter((value): value is string => Boolean(value) && !value!.startsWith('data:'));
      return [...textures, ...references];
    },
    isEditing: () => Boolean(typeof Undo !== 'undefined' && Undo?.current_save),
    createProject: input => {
      const format = Formats.bedrock;
      if (!format || !newProject(format) || !Project) throw new Error('Could not create Bedrock project');
      Project.name = input.name;
      Project.model_identifier = input.model_identifier;
      Project.texture_width = input.texture_width;
      Project.texture_height = input.texture_height;
      Project.box_uv = true;
      Project.saved = false;
      return Project;
    },
    // In 5.2, outliner tracks hierarchy only. Explicit group snapshots are also
    // required to remove/recreate a root on Undo/Redo and on failed batches.
    beginEdit: scope => { Undo.initEdit(nativeScope(scope)); },
    makeRoot: () => new Group({ name: 'root', origin: [0, 0, 0] }).addTo('root').init(),
    makeGroup: input => new Group(input),
    attachGroup: (group, parent, initialize) => {
      const native = nativeGroup(group);
      native.addTo(parent === 'root' ? 'root' : nativeGroup(parent));
      if (initialize) native.init();
    },
    updateGroup: (group, input) => { nativeGroup(group).extend(input); },
    makeCube: input => new Cube({ ...input, box_uv: true, autouv: 0 }),
    attachCube: (cube, group) => { nativeCube(cube).addTo(nativeGroup(group)).init(); },
    reparentCube: (cube, group) => { nativeCube(cube).addTo(nativeGroup(group)); },
    prepareTexture: prepareNativeTexture,
    addTexture: texture => { nativeTexture(texture).add(false); },
    disposeTexture: disposeNativeTexture,
    applyTexture: (cube, texture) => { nativeCube(cube).applyTexture(nativeTexture(texture), true); },
    setCubeUV: (cube, uv) => { const native = nativeCube(cube); native.setUVMode(true); native.extend({ ...uv, autouv: 0 }); },
    finishEdit: (label, scope) => { Undo.finishEdit(label, nativeScope(scope)); },
    cancelEdit: scope => {
      // cancelEdit(true) computes its reference from current_save.aspects. It must see
      // the newly created elements while the before-snapshot remains empty.
      if (!Undo.current_save) throw new Error('Undo transaction is no longer active');
      Object.assign(Undo.current_save.aspects, nativeScope(scope));
      Undo.cancelEdit(true);
    },
    refresh: () => { Canvas.updateAll(); if (typeof UVEditor !== 'undefined') UVEditor.loadData(); refreshNativeAnimation(); },
    compileProject: () => {
      try {
        const result: unknown = projectCodec().compile({ bitmaps: true, absolute_paths: false });
        if (typeof result !== 'string') throw new Error('Expected official project codec to return text');
        return result;
      } finally {
        // The official codec sets this flag before invoking compile hooks. A hook
        // exception must not leave later edits believing compilation is active.
        Blockbench.removeFlag('compiling_bbmodel');
      }
    },
    writeProject: (content, target) => { projectCodec().write(content, target); },
  };
}
