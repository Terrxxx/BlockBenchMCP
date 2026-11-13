import { BridgeError } from './errors.js';

export const MAX_PNG_BYTES = 8 * 1024 * 1024;
export const MAX_PNG_SIDE = 4096;
export interface PngInfo { width: number; height: number }
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(message: string): never { throw new BridgeError('INVALID_TEXTURE', message); }

/** Structural and resource preflight; the official browser decoder verifies image pixels. */
export function inspectPng(bytes: Uint8Array): PngInfo {
  if (bytes.length > MAX_PNG_BYTES) throw new BridgeError('TEXTURE_TOO_LARGE', 'PNG exceeds the 8 MiB limit.');
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) invalid('Expected a PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions: PngInfo | undefined;
  let imageData = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) invalid('Truncated PNG chunk.');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid('Truncated PNG chunk data.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid('PNG checksum mismatch.');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid('Animated PNG is not supported in this phase.');
    if (!dimensions && type !== 'IHDR') invalid('PNG must start with IHDR.');
    if (type === 'IHDR') {
      if (dimensions || length !== 13) invalid('Invalid PNG image header.');
      const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
      if (!width || !height || width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) throw new BridgeError('TEXTURE_TOO_LARGE', 'PNG dimensions must be 1–4096 pixels per side.');
      const depth = bytes[offset + 16]!, color = bytes[offset + 17]!;
      const depths: Record<number, readonly number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20]! > 1) invalid('Unsupported PNG header.');
      dimensions = { width, height };
    }
    if (type === 'IDAT' && length > 0) imageData = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length || !imageData || !dimensions) invalid('Invalid PNG end marker or missing pixel data.');
      return dimensions;
    }
    offset = end;
  }
  return invalid('PNG is missing its end marker.');
}
