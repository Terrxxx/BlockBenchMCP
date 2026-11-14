import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlockbenchAdapter } from '../../src/plugin/adapter.js';
import { Workspace } from '../../src/shared/workspace.js';
import { requestSchema, VERSION, outputSchemas, type Command, type ToolOutput } from '../../src/shared/protocol.js';
import { FakeHost } from '../helpers/fake-host.js';
import { pngFixture } from '../helpers/png.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('workspace resource exports', () => {
  let host: FakeHost; let adapter: BlockbenchAdapter; let workspace: Workspace; let id: string;
  function run<K extends Command>(command: K, params: unknown, deadline = Date.now() + 1000): ToolOutput<K> {
    return outputSchemas[command].parse(adapter.execute(requestSchema.parse({ version: VERSION, type: 'request', request_id: randomUUID(), deadline_ms: deadline, command, params }))) as ToolOutput<K>;
  }
  const model = (extra = {}) => run('export_bedrock_model', { project_id: id, path: 'test.geo.json', ...extra });
  beforeEach(() => {
    host = new FakeHost(); workspace = new Workspace(tempWorkspace(), fs); adapter = new BlockbenchAdapter(host, workspace);
    id = run('create_project', { name: 'export', model_identifier: 'export' }).project.id;
    host.calls = [];
  });
  it('writes exactly official codec output without Undo or saved metadata changes', () => {
    const before = structuredClone(host.project);
    expect(model()).toMatchObject({ kind: 'bedrock_model', path: 'test.geo.json' });
    expect(JSON.parse(fs.readFileSync(path.join(workspace.root, 'test.geo.json'), 'utf8'))).toEqual(host.compileBedrockModel());
    expect(host.project).toEqual(before);
    expect(host.calls).not.toContain('initEdit');
  });
  it('refuses overwrite before compiling and replaces whole file when explicit', () => {
    const target = path.join(workspace.root, 'test.geo.json'); fs.writeFileSync(target, 'old data');
    expect(() => model()).toThrow('Target exists'); expect(host.calls).toEqual([]);
    model({ overwrite: true }); expect(fs.readFileSync(target, 'utf8')).not.toContain('old data');
  });
  it.each(['../escape.geo.json', 'absent/x.geo.json', 'C:\\escape.geo.json', 'x:ads.geo.json', 'CON.geo.json', 'test.bbmodel'])('rejects unsafe export path %s', target => {
    expect(() => model({ path: target })).toThrow(); expect(host.calls).toEqual([]);
  });
  it('rejects junctions and hard links for every resource kind', () => {
    const other = tempWorkspace(); fs.symlinkSync(other, path.join(workspace.root, 'link'), 'junction');
    for (const [kind, suffix] of [['bedrock_model','.geo.json'],['bedrock_animations','.animation.json'],['texture_png','.png']] as const) {
      expect(() => workspace.exportTarget(`link/test${suffix}`, kind, true)).toThrow('Symbolic links');
      fs.writeFileSync(path.join(other, `original${suffix}`), 'keep');
      fs.linkSync(path.join(other, `original${suffix}`), path.join(workspace.root, `linked${suffix}`));
      expect(() => workspace.exportTarget(`linked${suffix}`, kind, true)).toThrow('Hard-linked');
    }
  });
  it('preflights ownership, active edit, external resources and expiry', () => {
    expect(() => model({ project_id: randomUUID() })).toThrow('active project changed');
    host.editing = true; expect(() => model()).toThrow('active Blockbench edit'); host.editing = false;
    host.resources = [path.join(tempWorkspace(), 'outside.png')]; expect(() => model()).toThrow('outside'); host.resources = [];
    expect(() => run('export_bedrock_model', { project_id: id, path: 'test.geo.json' }, 1)).toThrow('expired');
    adapter = new BlockbenchAdapter(host, workspace); expect(() => model()).toThrow('connection session');
    expect(host.calls).toEqual([]);
  });
  it('rechecks project, deadline and target after compiler hooks', () => {
    const compile = host.compileBedrockModel.bind(host);
    host.compileBedrockModel = () => { fs.writeFileSync(path.join(workspace.root,'test.geo.json'), 'new owner'); return compile(); };
    expect(() => model()).toThrow('Target exists'); expect(host.calls).not.toContain('Blockbench.writeFile');
    fs.unlinkSync(path.join(workspace.root,'test.geo.json'));
    host.compileBedrockModel = () => { host.project!.uuid = randomUUID(); return compile(); };
    expect(() => model()).toThrow('active project changed');
    host.project!.uuid = id;
    const now = Date.now();
    host.compileBedrockModel = () => { vi.spyOn(Date, 'now').mockReturnValue(now + 2000); return compile(); };
    try { expect(() => model()).toThrow('expired'); } finally { vi.restoreAllMocks(); }
    expect(fs.existsSync(path.join(workspace.root,'test.geo.json'))).toBe(false);
  });
  it('marks compile failures certain and write/verification failures uncertain', () => {
    const compile = host.compileBedrockModel.bind(host);
    host.compileBedrockModel = () => { throw new Error('codec hook'); };
    expect(() => model()).toThrow(expect.objectContaining({ code: 'EXPORT_FAILED', outcomeUnknown: false }));
    host.compileBedrockModel = compile; host.failWrite = true;
    expect(() => model()).toThrow(expect.objectContaining({ code: 'EXPORT_FAILED', outcomeUnknown: true }));
    host.failWrite = false; host.writeResource = (_c, target) => { fs.writeFileSync(target, 'corrupt'); };
    expect(() => model()).toThrow(expect.objectContaining({ code: 'EXPORT_FAILED', outcomeUnknown: true }));
  });
  it('rejects malformed, nonfinite and oversized codec output', () => {
    host.compileBedrockModel = () => ({}); expect(() => model()).toThrow('invalid document');
    host.compileBedrockModel = () => ({ format_version:'test', 'minecraft:geometry':[{description:{identifier:'geometry.test'}}], invalid:Infinity });
    expect(() => model()).toThrow('non-finite');
    host.compileBedrockModel = () => ({ format_version:'test', 'minecraft:geometry':[{description:{identifier:'geometry.test'}}], huge:'x'.repeat(8*1024*1024) });
    expect(() => model()).toThrow(expect.objectContaining({code:'EXPORT_TOO_LARGE'}));
    expect(host.calls).not.toContain('Blockbench.writeFile');
  });
  it('exports selected clips in one file and rejects the whole selection on unknown/duplicate IDs or expressions', () => {
    const a = run('create_animation',{project_id:id,name:'animation.test.a',length:1}).animation.id;
    const b = run('create_animation',{project_id:id,name:'animation.test.b',length:1}).animation.id;
    const exp = (ids: string[]) => run('export_bedrock_animations',{project_id:id,path:'test.animation.json',animation_ids:ids});
    expect(() => exp([a,randomUUID()])).toThrow('not found'); expect(() => exp([a,a])).toThrow();
    expect(host.calls).not.toContain('AnimationCodec.compileFile');
    host.animationEditable = () => false; expect(() => exp([a])).toThrow('numeric'); host.animationEditable = () => true;
    exp([b,a]); const doc = JSON.parse(fs.readFileSync(path.join(workspace.root,'test.animation.json'),'utf8'));
    expect(Object.keys(doc.animations)).toEqual(['animation.test.b','animation.test.a']);
  });
  it('exports exact PNG bytes and rejects external, malformed or dimension-mismatched images', async () => {
    const data = pngFixture(); const texture = await host.prepareTexture('atlas',`data:image/png;base64,${data.toString('base64')}`,{width:64,height:64}); host.atlases.push(texture);
    const exp = (target: string) => run('export_texture_png',{project_id:id,texture_id:texture.uuid,path:target});
    exp('atlas.png'); expect(fs.readFileSync(path.join(workspace.root,'atlas.png'))).toEqual(data);
    texture.internal=false; expect(() => exp('external.png')).toThrow('internal'); texture.internal=true;
    texture.width=32; expect(() => exp('wrong.png')).toThrow('dimensions'); texture.width=64;
    host.textureSources.set(texture.uuid,'C:/outside.png'); expect(() => exp('invalid.png')).toThrow('data URL');
    host.textureSources.set(texture.uuid,'data:image/png;base64,AAAA'); expect(() => exp('invalid.png')).toThrow();
    expect(fs.existsSync(path.join(workspace.root,'invalid.png'))).toBe(false);
  });
});
