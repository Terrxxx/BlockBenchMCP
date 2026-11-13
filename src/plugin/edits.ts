import { BridgeError } from '../shared/errors.js';
import type { BlockbenchHost, EditScope, ProjectHandle } from './host.js';

/** Call only after complete batch preflight; no asynchronous work inside an edit. */
export function edit<T>(host: BlockbenchHost, project: ProjectHandle, label: string,
  before: EditScope, after: () => EditScope, operation: () => T): T {
  const wasSaved = project.saved;
  host.beginEdit(before);
  try {
    const result = operation();
    host.refresh();
    host.finishEdit(label, after());
    return result;
  } catch {
    try {
      host.cancelEdit(after());
      project.saved = wasSaved;
      host.refresh();
    } catch {
      throw new BridgeError('INTERNAL_ERROR', 'Batch failed and rollback could not be confirmed; inspect the project.', true);
    }
    throw new BridgeError('INTERNAL_ERROR', 'Batch failed; the Undo transaction was rolled back.');
  }
}
