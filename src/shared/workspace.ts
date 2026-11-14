import type * as fs from 'node:fs';
import * as path from 'node:path';
import { BridgeError } from './errors.js';
import { inspectPng, MAX_PNG_BYTES, type PngInfo } from './png.js';
import { exportSuffixes, type ExportKind } from './schemas/exports.js';

function forbidden(message: string): never { throw new BridgeError('PATH_FORBIDDEN', message); }
export type FileSystem = Pick<typeof fs, 'statSync' | 'readdirSync' | 'readFileSync' | 'writeFileSync' | 'existsSync'>
  & Partial<Pick<typeof fs, 'realpathSync'>>;

/** All filesystem access for configuration and model files passes through this policy. */
export class Workspace {
  readonly root: string;
  constructor(root: string, readonly fs: FileSystem) {
    if (!path.isAbsolute(root)) forbidden('Workspace must be an explicit absolute directory.');
    this.root = fs.realpathSync ? fs.realpathSync(root) : path.resolve(root);
    if (!fs.statSync(this.root).isDirectory()) forbidden('Workspace is not a directory.');
  }

  contains(candidate: string): boolean {
    const relative = path.relative(this.root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  resolve(relative: string, allowMissingLeaf = false): string {
    if (!relative || relative.length > 240 || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) forbidden('Use a workspace-relative path.');
    const segments = relative.split(/[\\/]/);
    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..' || /[\x00-\x1f<>:"|?*]/.test(segment)
        || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) forbidden('Unsafe path component.');
    }
    const target = path.resolve(this.root, ...segments);
    if (!this.contains(target)) forbidden('Path leaves the workspace.');
    // Validate one component at a time: never follow a symlink before checking it.
    let cursor = this.root;
    segments.forEach((segment, index) => {
      const entry = this.fs.readdirSync(cursor, { withFileTypes: true }).find(item => item.name === segment
        || (path.sep === '\\' && item.name.toLowerCase() === segment.toLowerCase()));
      cursor = path.join(cursor, segment);
      if (!entry) {
        if (allowMissingLeaf && index === segments.length - 1) return;
        forbidden('Parent directory or file does not exist.');
      }
      if (entry.isSymbolicLink()) forbidden('Symbolic links and junctions are not allowed.');
      const stat = this.fs.statSync(cursor);
      if (index < segments.length - 1 && !stat.isDirectory()) forbidden('Parent must be a directory.');
      if (this.fs.realpathSync && !this.contains(this.fs.realpathSync(cursor))) forbidden('Resolved path leaves the workspace.');
      if (index === segments.length - 1 && !stat.isFile()) forbidden('Target must be a regular file.');
      if (index === segments.length - 1 && stat.isFile() && stat.nlink > 1) forbidden('Hard-linked files are not allowed.');
    });
    return target;
  }

  saveTarget(relative: string, overwrite: boolean): string {
    if (path.extname(relative).toLowerCase() !== '.bbmodel') forbidden('Only .bbmodel project files can be saved.');
    const target = this.resolve(relative, true);
    if (this.fs.existsSync(target)) {
      if (!this.fs.statSync(target).isFile()) forbidden('Save target must be a regular file.');
      if (!overwrite) throw new BridgeError('FILE_EXISTS', 'Target exists. Choose a new path or explicitly set overwrite: true.');
    }
    return target;
  }

  pngTarget(relative: string): string {
    if (path.extname(relative).toLowerCase() !== '.png') forbidden('Only workspace-relative PNG files can be imported.');
    const target = this.resolve(relative);
    if (this.fs.statSync(target).size > MAX_PNG_BYTES) throw new BridgeError('TEXTURE_TOO_LARGE', 'PNG exceeds the 8 MiB limit.');
    return target;
  }

  exportTarget(relative: string, kind: ExportKind, overwrite: boolean): string {
    if (!relative.toLowerCase().endsWith(exportSuffixes[kind])) forbidden('Incorrect resource export suffix.');
    const target = this.resolve(relative, true);
    if (this.fs.existsSync(target) && !overwrite) throw new BridgeError('FILE_EXISTS', 'Target exists. Choose a new path or explicitly set overwrite: true.');
    return target;
  }

  readPng(relative: string): { dataUrl: string; info: PngInfo } {
    const bytes = this.fs.readFileSync(this.pngTarget(relative));
    const info = inspectPng(bytes);
    return { info, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  }

  assertResource(absolute: string): void {
    if (!path.isAbsolute(absolute) || !this.contains(absolute)) {
      throw new BridgeError('RESOURCE_OUTSIDE_WORKSPACE', 'A project resource is outside the authorized workspace.');
    }
    this.resolve(path.relative(this.root, absolute));
  }
}
