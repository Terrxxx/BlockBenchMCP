import * as fs from 'node:fs';
import { parseArgs } from 'node:util';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { readConfig } from '../shared/config.js';
import { asBridgeError } from '../shared/errors.js';
import { stderrLogger as log } from '../shared/logger.js';
import { Workspace } from '../shared/workspace.js';
import { BridgeServer } from './bridge.js';
import { createMcpServer } from './tools.js';

let bridge: BridgeServer | undefined;
let handle: StdioServerHandle | undefined;
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await bridge?.close();
  await handle?.close();
}

try {
  const { values } = parseArgs({ options: { workspace: { type: 'string' } } });
  if (!values.workspace) throw new Error('Required argument: --workspace <absolute directory>');
  const workspace = new Workspace(values.workspace, fs);
  bridge = new BridgeServer(readConfig(workspace), log);
  await bridge.start();
  const activeBridge = bridge;
  handle = serveStdio(() => createMcpServer(activeBridge, workspace), { onerror: () => log('error', 'mcp_transport_error') });
  process.stdin.once('end', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
} catch (error) {
  const info = asBridgeError(error);
  log('error', 'startup_failed', { code: info.code, message: error instanceof Error ? error.message : info.message });
  await shutdown();
  process.exitCode = 1;
}
