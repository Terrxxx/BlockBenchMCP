import { BridgeError } from './errors.js';
import { vectorSchema, type Vector3 } from './schemas/common.js';
import { beamThickness } from './schemas/beams.js';

export interface BeamGeometry {from:Vector3;to:Vector3;origin:Vector3;rotation:Vector3}
/** Bedrock ZYX rotation; the positive local Y axis points from start to end. */
export function beamGeometry(start:Vector3,end:Vector3,width:number,depth=width):BeamGeometry {
  vectorSchema.parse(start);vectorSchema.parse(end);beamThickness.parse(width);beamThickness.parse(depth);
  const [dx,dy,dz]=end.map((v,i)=>v-start[i]!) as Vector3;
  const length=Math.hypot(dx,dy,dz);
  if(length<0.01||length>4096)throw new BridgeError('INVALID_PARAMS','Beam length must be between 0.01 and 4096.');
  const origin=start.map((v,i)=>(v+end[i]!)/2) as Vector3;
  const half:Vector3=[width/2,length/2,depth/2];
  return {origin,from:vectorSchema.parse(origin.map((v,i)=>v-half[i]!)),to:vectorSchema.parse(origin.map((v,i)=>v+half[i]!)),
    rotation:[Math.atan2(dz,Math.hypot(dx,dy))*180/Math.PI,0,Math.atan2(-dx,dy)*180/Math.PI]};
}
