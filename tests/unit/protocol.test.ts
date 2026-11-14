import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cubeStateSchema, inputSchemas, outputSchemas, requestSchema, responseSchema, parseJson } from '../../src/shared/protocol.js';

describe('validated protocol', () => {
  const cube = { name: 'body', from: [0, 0, 0], to: [8, 12, 4] };
  it('accepts native Blockbench IDs without RFC version/variant bits, but keeps request IDs strict', () => {
    const nativeId = '01234567-89ab-cdef-0123-456789abcdef';
    expect(inputSchemas.create_cubes.parse({ project_id: nativeId, cubes: [cube] }).project_id).toBe(nativeId);
    expect(inputSchemas.save_project.parse({ project_id: nativeId, path: 'x.bbmodel' }).project_id).toBe(nativeId);
    expect(outputSchemas.create_cubes.parse({ project_id: nativeId, cube_ids: [nativeId], count: 1, root_group_id: nativeId }).cube_ids).toEqual([nativeId]);
    expect(() => requestSchema.parse({ version: 5, type: 'request', request_id: nativeId, deadline_ms: Date.now(), command: 'get_project_state', params: {} })).toThrow();
    expect(() => responseSchema.parse({ version: 5, type: 'response', request_id: nativeId, ok: true, result: {} })).toThrow();
  });
  it('validates the complete batch and supplies explicit defaults', () => {
    const value = inputSchemas.create_cubes.parse({ project_id: randomUUID(), cubes: [cube] });
    expect(value.cubes[0]?.origin).toEqual([0, 0, 0]);
    expect(value.cubes[0]?.mirror_uv).toBe(false);
  });
  it.each([[], Array.from({ length: 257 }, () => cube), [{ ...cube, from: [9, 0, 0] }], [{ ...cube, to: [Infinity, 1, 1] }]].map(cubes => ({ cubes })))('rejects an invalid batch', ({ cubes }) => {
    expect(() => inputSchemas.create_cubes.parse({ project_id: randomUUID(), cubes })).toThrow();
  });
  it('can inspect manually edited coordinates and UV values outside mutation limits', () => {
    expect(cubeStateSchema.parse({ ...cube, id: randomUUID(), origin: [100000,0,0], rotation: [0,0,0],
      parent_id: null, box_uv: true, uv_offset: [-8,5000], mirror_uv: false, texture_ids: [],
    }).uv_offset).toEqual([-8,5000]);
  });
  it('rejects arbitrary execution fields and unknown commands', () => {
    expect(() => inputSchemas.get_project_state.parse({ code: 'anything' })).toThrow();
    expect(() => requestSchema.parse({ version: 5, type: 'request', request_id: randomUUID(), deadline_ms: Date.now(), command: 'eval', params: {} })).toThrow();
  });
  it('rejects invalid project identifiers, unknown fields and invalid JSON', () => {
    expect(() => inputSchemas.create_project.parse({ name: 'test', model_identifier: 'geometry.test' })).toThrow();
    expect(() => inputSchemas.save_project.parse({ project_id: 'wrong', path: 'x.bbmodel' })).toThrow();
    expect(() => parseJson('{')).toThrow('Expected a JSON message');
    expect(() => parseJson(' '.repeat(1_048_577))).toThrow('1 MiB');
  });
});
