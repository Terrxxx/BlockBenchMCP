import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHost } from '../../src/plugin/native-host.js';
import type { CubeHandle } from '../../src/plugin/host.js';

class CubeStub {
  mirror_uv = false;
  box_uv = false;
  uv_offset = [0, 0];
  autouv = 1;
  setUVMode(value: boolean) { this.box_uv = value; this.mirror_uv = !this.mirror_uv; }
  extend(data: unknown) { Object.assign(this, data); }
}
afterEach(() => vi.unstubAllGlobals());
describe('native per-face to Box UV conversion', () => {
  it.each([false, true])('preserves omitted mirror_uv=%s despite native conversion inference', mirror => {
    vi.stubGlobal('Cube', CubeStub);
    const cube = new CubeStub(); cube.mirror_uv = mirror;
    createNativeHost().setCubeUV(cube as unknown as CubeHandle, { uv_offset: [8, 16] });
    expect(cube).toMatchObject({ mirror_uv: mirror, box_uv: true, uv_offset: [8, 16], autouv: 0 });
  });
  it('honors an explicit mirror flag after native mode conversion', () => {
    vi.stubGlobal('Cube', CubeStub);
    const cube = new CubeStub();
    createNativeHost().setCubeUV(cube as unknown as CubeHandle, { uv_offset: [4, 4], mirror_uv: false });
    expect(cube.mirror_uv).toBe(false);
  });
});
