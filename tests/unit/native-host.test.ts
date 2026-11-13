import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createNativeHost } from '../../src/plugin/native-host.js';
import { cubeSchema } from '../../src/shared/protocol.js';

afterEach(() => vi.unstubAllGlobals());
describe('official API binding', () => {
  it('uses Group addTo and extend without reinitializing existing bones', () => {
    class NativeGroup {
      uuid = randomUUID(); name = 'bone'; origin: [number,number,number] = [0,0,0]; rotation: [number,number,number] = [0,0,0]; parent: 'root' = 'root';
      addTo = vi.fn(() => this); init = vi.fn(() => this); extend = vi.fn(() => this);
    }
    vi.stubGlobal('Group', NativeGroup);
    const host = createNativeHost();
    const parent = host.makeGroup({name:'root',origin:[0,0,0],rotation:[0,0,0]});
    const child = host.makeGroup({name:'head',origin:[0,12,0],rotation:[0,0,0]});
    host.attachGroup(child,parent,true); host.attachGroup(child,'root',false);
    host.updateGroup(child,{origin:[0,14,0],rotation:[0,15,0]});
    expect((child as NativeGroup).init).toHaveBeenCalledTimes(1);
    expect((child as NativeGroup).addTo.mock.calls).toHaveLength(2);
    expect((child as NativeGroup).extend).toHaveBeenCalledWith({origin:[0,14,0],rotation:[0,15,0]});
  });
  it('registers created elements and groups for cancelEdit(true), preserving the before snapshot', () => {
    class NativeCube { uuid = randomUUID(); }
    class NativeGroup { uuid = randomUUID(); name = 'root'; origin: [number, number, number] = [0,0,0]; rotation: [number, number, number] = [0,0,0]; parent: 'root' = 'root'; }
    const root = new NativeGroup();
    const groups: NativeGroup[] = [];
    const undo = {
      current_save: { aspects: { elements: [] as unknown[], groups: [] as unknown[] }, groups: [] },
      cancelEdit: vi.fn(), initEdit: vi.fn(), finishEdit: vi.fn(),
    };
    vi.stubGlobal('Cube', NativeCube); vi.stubGlobal('Group', NativeGroup); vi.stubGlobal('Undo', undo);
    const host = createNativeHost();
    host.beginEdit({ elements: [], groups: [...groups], outliner: true, selection: true });
    expect(undo.initEdit).toHaveBeenCalledWith({ elements: [], groups: [], outliner: true, selection: true });
    // makeCube returns a native instance in the production binding.
    const cube = host.makeCube(cubeSchema.parse({ name: 'test', from: [0, 0, 0], to: [1, 1, 1] }));
    groups.push(root);
    host.cancelEdit({ elements: [cube], groups: [...groups], outliner: true, selection: true });
    expect(undo.current_save.aspects.elements).toEqual([cube]);
    expect(undo.current_save.aspects.groups).toEqual([root]);
    expect(undo.current_save.groups).toEqual([]);
    expect(undo.cancelEdit).toHaveBeenCalledWith(true);
  });
  it('captures groups before and after a batch so native Undo can remove and recreate the root', () => {
    class NativeCube { uuid = randomUUID(); }
    class NativeGroup { uuid = randomUUID(); name = 'root'; origin: [number, number, number] = [0,0,0]; rotation: [number, number, number] = [0,0,0]; parent: 'root' = 'root'; }
    const root = new NativeGroup();
    const groups: NativeGroup[] = [];
    const undo = { initEdit: vi.fn(), finishEdit: vi.fn() };
    vi.stubGlobal('Cube', NativeCube); vi.stubGlobal('Group', NativeGroup); vi.stubGlobal('Undo', undo);
    const host = createNativeHost();
    host.beginEdit({ elements: [], groups: [...groups], outliner: true, selection: true });
    groups.push(root);
    const cube = host.makeCube(cubeSchema.parse({ name: 'test', from: [0, 0, 0], to: [1, 1, 1] }));
    host.finishEdit('Blockbench AI: Create cubes', { elements: [cube], groups: [...groups], outliner: true, selection: true });
    expect(undo.initEdit).toHaveBeenCalledWith({ elements: [], groups: [], outliner: true, selection: true });
    expect(undo.finishEdit).toHaveBeenCalledWith('Blockbench AI: Create cubes', { elements: [cube], groups: [root], outliner: true, selection: true });
  });
  it('delegates compile/write to the official project codec with texture embedding', () => {
    const codec = { compile: vi.fn(() => 'official output'), write: vi.fn() };
    vi.stubGlobal('Codecs', { project: codec });
    vi.stubGlobal('Blockbench', { removeFlag: vi.fn() });
    const host = createNativeHost();
    expect(host.compileProject()).toBe('official output');
    expect(codec.compile).toHaveBeenCalledWith({ bitmaps: true, absolute_paths: false });
    host.writeProject('official output', 'validated.bbmodel');
    expect(codec.write).toHaveBeenCalledWith('official output', 'validated.bbmodel');
  });
  it('clears the official compiling flag when a codec hook throws', () => {
    const removeFlag = vi.fn();
    vi.stubGlobal('Blockbench', { removeFlag });
    vi.stubGlobal('Codecs', { project: { compile: () => { throw new Error('hook failed'); }, write: vi.fn() } });
    expect(() => createNativeHost().compileProject()).toThrow('hook failed');
    expect(removeFlag).toHaveBeenCalledWith('compiling_bbmodel');
  });
});
