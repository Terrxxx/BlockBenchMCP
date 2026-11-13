import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Workspace } from '../../src/shared/workspace.js';
import { createConfig, readConfig } from '../../src/shared/config.js';
import { tempWorkspace } from '../helpers/temp.js';

describe('workspace boundary', () => {
  it.each(['../escape.bbmodel', '..\\escape.bbmodel', '/tmp/escape.bbmodel', 'C:\\escape.bbmodel', '\\\\server\\share\\x.bbmodel', 'x:stream.bbmodel', 'CON.bbmodel', 'a/../../x.bbmodel', 'a./x.bbmodel', 'a//x.bbmodel'])('rejects %s', input => {
    const workspace = new Workspace(tempWorkspace(), fs);
    expect(() => workspace.saveTarget(input, true)).toThrow();
  });
  it('allows only existing parents and explicitly requested overwrites', () => {
    const workspace = new Workspace(tempWorkspace(), fs);
    expect(workspace.saveTarget('test.bbmodel', false)).toBe(path.join(workspace.root, 'test.bbmodel'));
    expect(() => workspace.saveTarget('absent/test.bbmodel', false)).toThrow();
    expect(() => workspace.saveTarget('test.json', false)).toThrow();
    fs.writeFileSync(path.join(workspace.root, 'test.bbmodel'), 'existing');
    expect(() => workspace.saveTarget('test.bbmodel', false)).toThrow('Target exists');
    expect(workspace.saveTarget('test.bbmodel', true)).toContain('test.bbmodel');
  });
  it('rejects junction escape before following it', () => {
    const workspace = new Workspace(tempWorkspace(), fs);
    const outside = tempWorkspace(); // Still inside the repository, outside the authorized test root.
    fs.symlinkSync(outside, path.join(workspace.root, 'escape'), 'junction');
    expect(() => workspace.saveTarget('escape/x.bbmodel', true)).toThrow('Symbolic links');
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it('rejects hard-linked targets and resource references outside its root', () => {
    const workspace = new Workspace(tempWorkspace(), fs);
    fs.writeFileSync(path.join(workspace.root, 'original.bbmodel'), 'existing');
    fs.linkSync(path.join(workspace.root, 'original.bbmodel'), path.join(workspace.root, 'linked.bbmodel'));
    expect(() => workspace.saveTarget('linked.bbmodel', true)).toThrow('Hard-linked');
    expect(() => workspace.assertResource(path.join(tempWorkspace(), 'secret.png'))).toThrow('outside');
  });
  it('creates a private configuration without overwriting and checks the root', () => {
    const workspace = new Workspace(tempWorkspace(), fs);
    const config = createConfig(workspace);
    expect(config.token).toHaveLength(64);
    expect(readConfig(workspace)).toEqual(config);
    expect(() => createConfig(workspace)).toThrow();
    fs.writeFileSync(path.join(workspace.root, '.blockbench-ai-mcp.json'), JSON.stringify({ ...config, workspace: tempWorkspace() }));
    expect(() => readConfig(workspace)).toThrow('does not match');
  });
});
