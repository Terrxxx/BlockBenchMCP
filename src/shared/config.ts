import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Workspace } from './workspace.js';
import { BridgeError } from './errors.js';

export const CONFIG_NAME = '.blockbench-ai-mcp.json';
export const configSchema = z.strictObject({
  version: z.literal(1), host: z.literal('127.0.0.1'), port: z.number().int().min(1024).max(65535),
  workspace: z.string().min(1), token: z.string().regex(/^[a-f0-9]{64}$/),
  timeout_ms: z.number().int().min(1000).max(60_000).default(15_000),
});
export type BridgeConfig = z.infer<typeof configSchema>;

export function createConfig(workspace: Workspace, port = 30031): BridgeConfig {
  const config = configSchema.parse({ version: 1, host: '127.0.0.1', port, workspace: workspace.root, token: randomBytes(32).toString('hex') });
  workspace.fs.writeFileSync(workspace.resolve(CONFIG_NAME, true), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return config;
}

export function readConfig(workspace: Workspace): BridgeConfig {
  const file = workspace.resolve(CONFIG_NAME);
  if (workspace.fs.statSync(file).size > 4096) throw new BridgeError('INVALID_PARAMS', 'Configuration exceeds 4 KiB.');
  const config = configSchema.parse(JSON.parse(workspace.fs.readFileSync(file, 'utf8')) as unknown);
  if (config.workspace !== workspace.root) throw new BridgeError('PATH_FORBIDDEN', 'Configuration workspace does not match the selected directory.');
  return config;
}
