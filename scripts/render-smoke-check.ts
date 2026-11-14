import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { inspectPng } from '../src/shared/png.js';

/** Decode only the browser's 8-bit non-interlaced RGB/RGBA PNGs for smoke assertions. */
export function inspectRenderPixels(bytes:Buffer) {
  const {width,height}=inspectPng(bytes);
  const channels=bytes[25]===6?4:bytes[25]===2?3:0;
  if(bytes[24]!==8 || !channels || bytes[28]!==0)throw new Error('Expected non-interlaced RGB/RGBA browser PNG.');
  const chunks:Buffer[]=[];
  for(let offset=8;offset<bytes.length;){const length=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;}
  const stride=width*channels;
  const raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)throw new Error('Unexpected decoded scanline length.');
  const decoded=Buffer.alloc(stride*height);
  const paeth=(a:number,b:number,c:number):number=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)]!;if(filter>4)throw new Error('Unknown PNG filter.');
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=channels?decoded[i-channels]!:0,b=y?decoded[i-stride]!:0,c=y&&x>=channels?decoded[i-stride-channels]!:0;
      const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      decoded[i]=(raw[y*(stride+1)+1+x]!+prediction)&255;
    }
  }
  let visible=0,transparent=0;
  for(let i=0;i<decoded.length;i+=channels){const alpha=channels===4?decoded[i+3]!:255;if(alpha>0)visible++;else transparent++;}
  return {width,height,visible,transparent,corner:[...decoded.subarray(0,channels)],pixel_sha256:createHash('sha256').update(decoded).digest('hex')};
}
