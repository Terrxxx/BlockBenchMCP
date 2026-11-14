import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { pngChunk } from '../helpers/png.js';
import { inspectRenderPixels } from '../../scripts/render-smoke-check.js';

describe('render smoke PNG pixel checks',()=>{
  it.each([0,1,2,3,4])('decodes PNG filter %s and counts transparency',filter=>{
    const width=2,height=2,channels=4,stride=width*channels;
    const pixels=Buffer.from([16,32,48,255,80,100,120,0,40,50,60,255,100,120,140,128]);
    const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
    const raw=Buffer.alloc((stride+1)*height);
    for(let y=0;y<height;y++){raw[y*(stride+1)]=filter;for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]!:0,b=y?pixels[i-stride]!:0,c=y&&x>=channels?pixels[i-stride-channels]!:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);raw[y*(stride+1)+x+1]=(pixels[i]!-predictor)&255;}}
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
    expect(inspectRenderPixels(png)).toMatchObject({width:2,height:2,visible:3,transparent:1,corner:[16,32,48,255]});
  });
});
