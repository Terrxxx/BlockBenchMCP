import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'INVALID_PARAMS', 'INVALID_MESSAGE', 'UNSUPPORTED_VERSION', 'AUTH_FAILED',
  'NOT_CONNECTED', 'DISCONNECTED', 'TIMEOUT', 'CANCELLED', 'BUSY',
  'DUPLICATE_REQUEST', 'NO_PROJECT', 'PROJECT_MISMATCH', 'PROJECT_NOT_OWNED',
  'UNSUPPORTED_FORMAT', 'PATH_FORBIDDEN', 'FILE_EXISTS', 'SAVE_FAILED',
  'INTERNAL_ERROR', 'UNSUPPORTED_HOST', 'RESOURCE_OUTSIDE_WORKSPACE',
  'NOT_FOUND', 'NAME_CONFLICT', 'HIERARCHY_CYCLE',
  'UNSUPPORTED_ANIMATION', 'ANIMATION_LIMIT', 'KEYFRAME_OUT_OF_BOUNDS', 'KEYFRAME_CONFLICT',
  'INVALID_TEXTURE', 'TEXTURE_TOO_LARGE', 'TEXTURE_SIZE_MISMATCH', 'TEXTURE_LIMIT', 'TEXTURE_LOAD_FAILED', 'UV_OUT_OF_BOUNDS',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const errorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().max(1024),
  outcome_unknown: z.boolean().default(false),
});
export type ErrorInfo = z.infer<typeof errorSchema>;

export class BridgeError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly outcomeUnknown = false) {
    super(message);
    this.name = 'BridgeError';
  }
  toJSON(): ErrorInfo {
    return { code: this.code, message: this.message, outcome_unknown: this.outcomeUnknown };
  }
}

export function asBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 5).map(i => `${i.path.join('.') || 'input'}: ${i.code}`);
    return new BridgeError('INVALID_PARAMS', issues.join('; '));
  }
  return new BridgeError('INTERNAL_ERROR', 'Operation failed; inspect the local application log.');
}
