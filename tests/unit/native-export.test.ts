import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeExportHost } from '../../src/plugin/native-export.js';
import type { AnimationHandle } from '../../src/plugin/animation-host.js';
import type { TextureHandle } from '../../src/plugin/host.js';

afterEach(() => vi.unstubAllGlobals());
describe('official resource export binding', () => {
  it('uses raw geometry compilation without pose-dependent visible bounds or codec.write', () => {
    const document = { official: true }; const compile = vi.fn(() => document);
    vi.stubGlobal('Codecs', { bedrock: { compile } });
    expect(nativeExportHost().compileBedrockModel()).toBe(document);
    expect(compile).toHaveBeenCalledWith({ raw: true, visible_box: false });
    vi.stubGlobal('Codecs', { bedrock: { compile, context: {} } });
    expect(() => nativeExportHost().compileBedrockModel()).toThrow('collection');
    expect(compile).toHaveBeenCalledTimes(1);
  });
  function fixture() {
    class Track {
      uuid = 'bone';
      keyframes = [{ channel:'rotation', getTimecodeString: () => '0.0' }, { channel:'rotation', getTimecodeString: () => '1.0' }];
    }
    class Clip implements AnimationHandle {
      uuid='animation'; name='animation.test.clip'; length=1; loop='once' as const; snapping=20;
      animators = { bone: new Track() };
    }
    vi.stubGlobal('BoneAnimator', Track); vi.stubGlobal('BBAnimation', Clip);
    vi.stubGlobal('AnimationController',{all:[]}); vi.stubGlobal('NullObject',{all:[]}); vi.stubGlobal('Group',{all:[{uuid:'bone'}]});
    const compileFile = vi.fn(() => ({ official: true })); vi.stubGlobal('AnimationCodec',{codecs:{bedrock:{compileFile}}});
    return { clip:new Clip(), compileFile };
  }
  it('compiles the exact selection once through AnimationCodec', () => {
    const {clip,compileFile}=fixture();
    expect(nativeExportHost().compileBedrockAnimations([clip])).toEqual({official:true});
    expect(compileFile).toHaveBeenCalledExactlyOnceWith([clip]);
  });
  it('rejects collisions from native timecode conversion before compiling', () => {
    const {clip,compileFile}=fixture(); clip.animators.bone.keyframes[1]!.getTimecodeString=()=>'0.0';
    expect(()=>nativeExportHost().compileBedrockAnimations([clip])).toThrow('merge keyframes');
    expect(compileFile).not.toHaveBeenCalled();
  });
  it('rejects export-rounded out-of-range frames, missing bones and IK without compiling', () => {
    const {clip,compileFile}=fixture(); clip.length=0.99;
    expect(()=>nativeExportHost().compileBedrockAnimations([clip])).toThrow('exported clip length'); clip.length=1;
    vi.stubGlobal('Group',{all:[]}); expect(()=>nativeExportHost().compileBedrockAnimations([clip])).toThrow('missing bone');
    vi.stubGlobal('NullObject',{all:[{ik_target:'bone'}]}); expect(()=>nativeExportHost().compileBedrockAnimations([clip])).toThrow('IK');
    expect(compileFile).not.toHaveBeenCalled();
  });
  it('reads native texture data and uses the official image writer without source paths', () => {
    class NativeTexture implements TextureHandle {
      uuid='texture'; name='atlas'; width=64; height=64; internal=true;
      getDataURL() { return 'data:image/png;base64,AAAA'; }
    }
    const writeFile=vi.fn(); vi.stubGlobal('Texture',NativeTexture); vi.stubGlobal('Blockbench',{writeFile});
    const host=nativeExportHost(); const content=host.textureDataUrl(new NativeTexture());
    host.writeResource(content,'validated.png',true);
    expect(writeFile).toHaveBeenCalledWith('validated.png',{content,savetype:'image'});
    host.writeResource('{}','validated.geo.json',false);
    expect(writeFile).toHaveBeenLastCalledWith('validated.geo.json',{content:'{}'});
    expect(()=>host.writeResource('C:/outside.png','validated.png',true)).toThrow('data URL');
    expect(writeFile).toHaveBeenCalledTimes(2);
  });
});
