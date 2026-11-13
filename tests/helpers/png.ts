import { deflateSync } from 'node:zlib';
import { crc32 } from '../../src/shared/png.js';

export function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 'ascii');
  chunk.set(data, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
/** Deterministic fixture, not a public texture-generation tool. */
export function pngFixture(width = 64, height = 64): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 4 + 1) + 1 + x * 4;
    const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    pixels.set(light ? [90,180,230,255] : [190,100,180,255], index);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', new Uint8Array())]);
}
