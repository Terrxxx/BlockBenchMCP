import { BridgeError } from '../shared/errors.js';
import type { PngInfo } from '../shared/png.js';
import type { TextureHandle } from './host.js';

export function nativeTexture(texture: TextureHandle): Texture {
  if (!(texture instanceof Texture)) throw new Error('Expected native Texture');
  return texture;
}
export function disposeNativeTexture(handle: TextureHandle): void {
  const texture = nativeTexture(handle);
  texture.img.onload = null; texture.img.onerror = null;
  texture.img.removeAttribute('src');
  const map: unknown = texture.material.uniforms.map?.value;
  if (typeof map === 'object' && map !== null && 'dispose' in map && typeof map.dispose === 'function') map.dispose();
  texture.material.dispose();
  texture.canvas.width = 0; texture.canvas.height = 0;
}

/** Decode without joining a project or keeping an Undo edit open across an await. */
export async function prepareNativeTexture(name: string, dataUrl: string, info: PngInfo, timeoutMs: number): Promise<TextureHandle> {
  if (timeoutMs <= 0) throw new BridgeError('TIMEOUT', 'Texture request expired before decoding.');
  const texture = new Texture({ name, keep_size: true });
  texture.uv_width = info.width; texture.uv_height = info.height;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: BridgeError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        texture.img.removeEventListener('load', loaded);
        texture.img.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const loaded = (): void => {
        if (texture.error || texture.width !== info.width || texture.height !== info.height
          || texture.canvas.width !== info.width || texture.canvas.height !== info.height) {
          finish(new BridgeError('TEXTURE_LOAD_FAILED', 'Decoded texture does not match the validated PNG.'));
        } else finish();
      };
      const failed = (): void => finish(new BridgeError('TEXTURE_LOAD_FAILED', 'Blockbench could not decode the PNG.'));
      const timer = setTimeout(() => finish(new BridgeError('TIMEOUT', 'Texture decoding timed out; no texture was added.')), timeoutMs);
      texture.img.addEventListener('load', loaded);
      texture.img.addEventListener('error', failed);
      try { texture.fromDataURL(dataUrl); } catch { failed(); }
    });
    return texture;
  } catch (error) {
    disposeNativeTexture(texture);
    throw error;
  }
}
