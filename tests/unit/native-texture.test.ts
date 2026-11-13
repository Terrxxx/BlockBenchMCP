import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareNativeTexture } from '../../src/plugin/native-texture.js';
import { createNativeHost } from '../../src/plugin/native-host.js';

class ImageStub extends EventTarget {
  onload: (()=>void) | null = null;
  onerror: (()=>void) | null = null;
  removeAttribute = vi.fn();
}
let mode:'load'|'error'|'hang'|'wrong'='load';
const instances:NativeTextureStub[]=[];
class NativeTextureStub {
  uuid='01234567-89ab-cdef-0123-456789abcdef'; name:string; width=0; height=0;
  internal=false; error=0; uv_width=0; uv_height=0;
  img=new ImageStub(); canvas={width:16,height:16};
  material={uniforms:{map:{value:{dispose:vi.fn()}}},dispose:vi.fn()};
  add=vi.fn();
  constructor(input:{name:string}) {
    this.name=input.name; instances.push(this);
    this.img.onload=()=>{this.width=mode==='wrong'?32:64; this.height=64; this.canvas.width=this.width; this.canvas.height=this.height;};
    this.img.onerror=()=>{this.error=1;};
  }
  fromDataURL=vi.fn((_source:string)=>{
    this.internal=true;
    if(mode!=='hang') queueMicrotask(()=>{
      if(mode==='error') {this.img.onerror?.(); this.img.dispatchEvent(new Event('error'));}
      else {this.img.onload?.(); this.img.dispatchEvent(new Event('load'));}
    });
    return this;
  });
}
beforeEach(()=>{ mode='load'; instances.length=0; vi.stubGlobal('Texture',NativeTextureStub); });
afterEach(()=>vi.unstubAllGlobals());

describe('official Texture loading lifecycle',()=>{
  it('preserves the official image handler and resolves only after decoding, without adding to a project',async()=>{
    const result=await prepareNativeTexture('atlas','data:image/png;base64,test',{width:64,height:64},1000);
    expect(result).toBe(instances[0]); expect(result).toMatchObject({width:64,height:64,internal:true});
    expect(instances[0]!.img.onload).toBeTypeOf('function'); expect(instances[0]!.add).not.toHaveBeenCalled();
    expect(instances[0]!.fromDataURL).toHaveBeenCalledWith('data:image/png;base64,test');
  });
  it.each(['error','wrong','hang'] as const)('cleans listeners, image and GPU resources on %s',async value=>{
    mode=value;
    await expect(prepareNativeTexture('atlas','data:image/png;base64,test',{width:64,height:64},10)).rejects.toMatchObject({code:value==='hang'?'TIMEOUT':'TEXTURE_LOAD_FAILED'});
    const texture=instances[0]!;
    expect(texture.img.onload).toBeNull(); expect(texture.img.onerror).toBeNull();
    expect(texture.img.removeAttribute).toHaveBeenCalledWith('src');
    expect(texture.material.dispose).toHaveBeenCalledTimes(1); expect(texture.material.uniforms.map.value.dispose).toHaveBeenCalledTimes(1);
    expect(texture.canvas.width).toBe(0);
    texture.img.dispatchEvent(new Event('load'));
    expect(texture.add).not.toHaveBeenCalled();
  });
  it('registers bitmap snapshots before/after addition and in rollback without nested Undo',()=>{
    const texture=new NativeTextureStub({name:'atlas'});
    const before={elements:[],textures:[],bitmap:true}; const after={elements:[],textures:[texture],bitmap:true};
    const undo={initEdit:vi.fn(),finishEdit:vi.fn(),cancelEdit:vi.fn(),current_save:{aspects:{...before},textures:{}}};
    vi.stubGlobal('Undo',undo);
    const host=createNativeHost(); host.beginEdit(before); host.addTexture(texture);
    host.finishEdit('Import',after); host.cancelEdit(after);
    expect(texture.add).toHaveBeenCalledWith(false);
    expect(undo.initEdit).toHaveBeenCalledWith(before); expect(undo.finishEdit).toHaveBeenCalledWith('Import',after);
    expect(undo.current_save.aspects.textures).toEqual([texture]); expect(undo.current_save.textures).toEqual({});
    expect(undo.cancelEdit).toHaveBeenCalledWith(true);
  });
});
