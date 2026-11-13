import * as fs from 'node:fs';
import * as path from 'node:path';

export function tempWorkspace(): string {
  const base = path.resolve('.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'test-'));
}
