import { BridgeError } from '../shared/errors.js';
import type { ExportHost } from './export-host.js';
import { nativeAnimation } from './native-animation.js';
import { nativeTexture } from './native-texture.js';

export function nativeExportHost(): ExportHost {
  return {
    compileBedrockModel: () => {
      const codec = Codecs.bedrock;
      if (!codec || typeof codec.compile !== 'function') throw new BridgeError('UNSUPPORTED_HOST', 'Bedrock model codec is unavailable.');
      if (codec.context) throw new BridgeError('BUSY', 'Finish the active collection export first.');
      return codec.compile({ raw: true, visible_box: false });
    },
    compileBedrockAnimations: values => {
      const codec = AnimationCodec.codecs.bedrock;
      if (!codec?.compileFile) throw new BridgeError('UNSUPPORTED_HOST', 'Bedrock animation codec is unavailable.');
      if (AnimationController.all.length || NullObject.all.some(n => n.ik_target)) {
        throw new BridgeError('UNSUPPORTED_ANIMATION', 'Animation export does not support controllers or IK targets.');
      }
      const animations = values.map(nativeAnimation);
      for (const a of animations) {
        for (const track of Object.values(a.animators)) {
          if (!(track instanceof BoneAnimator)) throw new BridgeError('UNSUPPORTED_ANIMATION', 'Only bone animation tracks can be exported.');
          if (!Group.all.some(g => g.uuid === track.uuid)) throw new BridgeError('NOT_FOUND', 'Animation refers to a missing bone.');
          const slots = new Set<string>();
          for (const frame of track.keyframes) {
            const time = frame.getTimecodeString();
            const slot = `${frame.channel}/${time}`;
            if (slots.has(slot)) throw new BridgeError('KEYFRAME_CONFLICT', 'Official export snapping would merge keyframes. Adjust time or snapping first.');
            slots.add(slot);
            if (!Number.isFinite(Number(time)) || Number(time) < 0 || Number(time) > Math.round(a.length * 10000) / 10000) {
              throw new BridgeError('KEYFRAME_OUT_OF_BOUNDS', 'Snapped keyframe time exceeds the exported clip length.');
            }
          }
        }
      }
      return codec.compileFile(animations);
    },
    textureDataUrl: value => nativeTexture(value).getDataURL(),
    writeResource: (content, target, image) => {
      if (image && !content.startsWith('data:image/png;base64,')) throw new BridgeError('INVALID_TEXTURE', 'PNG data URL required.');
      Blockbench.writeFile(target, image ? { content, savetype: 'image' } : { content });
    },
  };
}
