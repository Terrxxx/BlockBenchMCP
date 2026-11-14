import { z } from 'zod';
import { nativeId, vectorSchema } from './common.js';

const cameraBase = { position: vectorSchema, target: vectorSchema, up: vectorSchema.default([0,1,0]) };
export const cameraSchema = z.discriminatedUnion('projection', [
  z.strictObject({ ...cameraBase, projection:z.literal('perspective'), fov:z.number().finite().min(10).max(120).default(45) }),
  z.strictObject({ ...cameraBase, projection:z.literal('orthographic'), vertical_size:z.number().finite().min(0.1).max(4096) }),
]).superRefine((camera, ctx) => {
  const [x,y,z] = camera.position.map((v,i)=>v-camera.target[i]!) as [number,number,number];
  const [a,b,c] = camera.up;
  const distance = Math.hypot(x,y,z); const upLength = Math.hypot(a,b,c);
  if (distance < 0.1 || upLength < 0.0001 || Math.hypot(y*c-z*b,z*a-x*c,x*b-y*a) < 0.0001 * distance * upLength) {
    ctx.addIssue({code:'custom',message:'Camera position/target must differ and up must not be zero or parallel to the view.'});
  }
});
export const renderInput = z.strictObject({
  project_id:nativeId, path:z.string().min(1).max(240).refine(p=>p.toLowerCase().endsWith('.png'),'PNG path required.'),
  overwrite:z.boolean().default(false), width:z.number().int().min(64).max(2048).default(512), height:z.number().int().min(64).max(2048).default(512),
  camera:cameraSchema, background:z.union([z.literal('transparent'),z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default('transparent'),
  animation:z.strictObject({animation_id:nativeId,time:z.number().finite().min(0).max(1000)}).optional(),
});
export type RenderInput = z.infer<typeof renderInput>;
export const renderOutput = z.strictObject({
  project_id:nativeId, path:z.string().max(240), bytes:z.number().int().positive().max(8*1024*1024),
  width:z.number().int().min(64).max(2048),height:z.number().int().min(64).max(2048),
  animation_id:nativeId.nullable(),time:z.number().finite().nullable(),warnings:z.array(z.string().max(512)).max(10),
});
