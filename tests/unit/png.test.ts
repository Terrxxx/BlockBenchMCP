import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { crc32, inspectPng, MAX_PNG_BYTES } from '../../src/shared/png.js';
import { Workspace } from '../../src/shared/workspace.js';
import { pngChunk, pngFixture } from '../helpers/png.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('bounded workspace PNG import', () => {
  it('validates CRC against the standard check vector and accepts a real PNG', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(inspectPng(pngFixture())).toEqual({ width:64,height:64 });
  });
  it('rejects non-PNG, corruption, truncation, trailing data and animation', () => {
    const valid=pngFixture(); const broken=Buffer.from(valid); broken[40]=broken[40]! ^ 1;
    for (const bytes of [Buffer.from('not PNG'),broken,valid.subarray(0,-1),Buffer.concat([valid,Buffer.from([1])]),
      Buffer.concat([valid.subarray(0,33),pngChunk('acTL',new Uint8Array(8)),valid.subarray(33)])]) {
      expect(() => inspectPng(bytes)).toThrow();
    }
  });
  it('rejects oversized files and images before decoding', () => {
    expect(() => inspectPng(new Uint8Array(MAX_PNG_BYTES+1))).toThrow('8 MiB');
    const valid=pngFixture(); const header=Buffer.from(valid.subarray(16,29)); header.writeUInt32BE(4097,0);
    const oversized=Buffer.concat([valid.subarray(0,8),pngChunk('IHDR',header),valid.subarray(33)]);
    expect(() => inspectPng(oversized)).toThrow('4096');
  });
  it('reads only validated PNG paths and does not load sidecar metadata', () => {
    const root=tempWorkspace(); const workspace=new Workspace(root,fs);
    const png=pngFixture(); fs.writeFileSync(path.join(root,'atlas.png'),png);
    fs.writeFileSync(path.join(root,'atlas.png.mcmeta'),'not valid JSON');
    expect(workspace.readPng('atlas.png')).toEqual({info:{width:64,height:64},dataUrl:`data:image/png;base64,${png.toString('base64')}`});
    for (const target of ['../atlas.png',path.join(root,'atlas.png'),'atlas.jpg','missing.png','a:stream.png']) expect(() => workspace.readPng(target)).toThrow();
    const hardlink=path.join(root,'hard.png'); fs.linkSync(path.join(root,'atlas.png'),hardlink);
    expect(() => workspace.readPng('hard.png')).toThrow('Hard-linked');
  });
});
