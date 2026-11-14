import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist/plugin', { recursive: true });
await build({
  entryPoints: ['src/server/index.ts'], outfile: 'dist/server/index.js',
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', sourcemap: true,
});
const plugin = await build({
  entryPoints: ['src/plugin/index.ts'], outfile: 'dist/plugin/blockbench_ai_mcp.js',
  bundle: true, platform: 'node', format: 'iife', target: 'es2022', sourcemap: false,
  metafile: true, legalComments: 'eof',
  banner: { js: '/* Blockbench AI MCP v0.6.0 — desktop 5.2.2+; built from src/plugin/index.ts */' },
});
await writeFile('dist/plugin/build-meta.json', JSON.stringify(plugin.metafile, null, 2));
console.log('Built stdio server and standalone Blockbench desktop plugin.');
