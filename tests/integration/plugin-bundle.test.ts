import { expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { WebSocket } from 'ws';
import { createConfig } from '../../src/shared/config.js';
import { Workspace, type FileSystem } from '../../src/shared/workspace.js';
import { BridgeServer } from '../../src/server/bridge.js';
import { silentLogger } from '../../src/shared/logger.js';
import { tempWorkspace } from '../helpers/temp.js';
import { inputSchemas } from '../../src/shared/protocol.js';

it('loads the standalone bundle with only supported native modules and a scoped fs, connects and unloads', async () => {
  const workspace = new Workspace(tempWorkspace(), fs);
  const config = createConfig(workspace);
  const server = new BridgeServer({ ...config, port: 0 }, silentLogger);
  await server.start();
  fs.writeFileSync(path.join(workspace.root, '.blockbench-ai-mcp.json'), JSON.stringify({ ...config, port: server.port }));
  const output = await build({ entryPoints: ['src/plugin/index.ts'], bundle: true, platform: 'node', format: 'iife', write: false, target: 'es2022' });
  type Registration = { onload: () => void; onunload: () => void };
  let registration: Registration | undefined;
  let confirm: ((values: { workspace: string }) => void) | undefined;
  let connected = false;
  const actions: { click: () => void }[] = [];
  const scopedFs: FileSystem = {
    statSync: fs.statSync, readdirSync: fs.readdirSync, readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync, existsSync: fs.existsSync,
  }; // Deliberately no realpathSync/lstatSync: official scoped fs lacks those APIs.
  try {
    runInNewContext(output.outputFiles[0]!.text, {
      console, setTimeout, clearTimeout, TextEncoder, WebSocket,
      require: (module: string): unknown => {
        if (module !== 'node:path') throw new Error(`Unsupported native module: ${module}`);
        return path;
      },
      requireNativeModule: (module: string, options: { scope: string }): FileSystem => {
        expect(module).toBe('fs'); expect(options.scope).toBe(workspace.root); return scopedFs;
      },
      BBPlugin: { register: (_id: string, options: Registration) => { registration = options; } },
      Blockbench: { version: '5.2.2', isWeb: false, showQuickMessage: () => { connected = true; }, showMessageBox: (value: unknown) => { throw new Error(JSON.stringify(value)); } },
      Action: class {
        constructor(_id: string, options: { click: () => void }) { actions.push(options); }
        delete(): void {}
      },
      Dialog: class {
        constructor(_id: string, options: { onConfirm: typeof confirm }) { confirm = options.onConfirm; }
        show(): void {}
        hide(): void {}
      },
      MenuBar: { addAction: () => {} },
    });
    expect(registration).toBeDefined();
    registration!.onload();
    actions[0]!.click();
    confirm!({ workspace: workspace.root });
    for (let i = 0; i < 100 && !connected; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(server.connected).toBe(true);
    expect(await server.call('get_project_state', inputSchemas.get_project_state.parse({}))).toMatchObject({ project: null });
    registration!.onunload();
    for (let i = 0; i < 100 && server.connected; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(server.connected).toBe(false);
  } finally { registration?.onunload(); await server.close(); }
});
