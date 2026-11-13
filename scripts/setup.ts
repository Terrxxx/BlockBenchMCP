import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Workspace } from '../src/shared/workspace.js';
import { createConfig } from '../src/shared/config.js';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, port: { type: 'string', default: '30031' } } });
if (!values.workspace) throw new Error('Usage: npm run setup -- --workspace <directory> [--port 30031]');
const workspace = new Workspace(path.resolve(values.workspace), fs);
createConfig(workspace, Number(values.port));
console.log(`Created workspace configuration in ${workspace.root}. Keep it private. Existing configuration is never overwritten.`);
