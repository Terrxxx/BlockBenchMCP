import type { AnimationHandle } from './animation-host.js';
import type { TextureHandle } from './host.js';

export interface ExportHost {
  compileBedrockModel(): unknown;
  compileBedrockAnimations(animations: AnimationHandle[]): unknown;
  textureDataUrl(texture: TextureHandle): string;
  writeResource(content: string, target: string, image: boolean): void;
}
