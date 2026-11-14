import { beamGeometry } from '../shared/beam-geometry.js';
import { BridgeError } from '../shared/errors.js';
import type { ToolInput, ToolOutput, Vector3 } from '../shared/protocol.js';
import { findCubes, findGroup } from './bones.js';
import { edit } from './edits.js';
import type { BlockbenchHost, CubeHandle, ProjectHandle } from './host.js';
import { checkBoxUV } from './textures.js';

function supported(host:BlockbenchHost):void {
  if(host.eulerOrder()!=='ZYX')throw new BridgeError('UNSUPPORTED_HOST','Beam tools require the Bedrock ZYX rotation order.');
}
function measure(host:BlockbenchHost,cubes:CubeHandle[],targets:{start:Vector3;end:Vector3}[]):ToolOutput<'align_beams'>['beams'] {
  host.refresh();
  return cubes.map((cube,i)=>{
    const [start,end]=host.beamEndpoints(cube),target=targets[i]!;
    const distance=(a:Vector3,b:Vector3):number=>Math.hypot(...a.map((v,j)=>v-b[j]!));
    const error=Math.max(distance(start,target.start),distance(end,target.end));
    if(!Number.isFinite(error)||error>1e-6)throw new BridgeError('INVALID_PARAMS','Native beam endpoint verification failed.');
    return {cube_id:cube.uuid,start,end,length:distance(start,end),endpoint_error:error};
  });
}
export function createBeams(host:BlockbenchHost,project:ProjectHandle,input:ToolInput<'create_beams'>):ToolOutput<'create_beams'> {
  supported(host);const parent=findGroup(host,input.parent_id);
  const specs=input.beams.map(b=>{
    const spec={name:b.name,...beamGeometry(b.start,b.end,b.thickness),uv_offset:b.uv_offset,mirror_uv:b.mirror_uv};
    checkBoxUV(project,spec,spec.uv_offset);return spec;
  });
  const cubes:CubeHandle[]=[];
  const scope=()=>({elements:cubes,groups:[...host.groups()],outliner:true,selection:true});
  return edit(host,project,'Blockbench AI: Create beams',scope(),scope,()=>{
    for(const spec of specs){const cube=host.makeCube(spec);cubes.push(cube);host.attachCube(cube,parent);}
    return {project_id:project.uuid,count:cubes.length,beams:measure(host,cubes,input.beams)};
  });
}
export function alignBeams(host:BlockbenchHost,project:ProjectHandle,input:ToolInput<'align_beams'>):ToolOutput<'align_beams'> {
  supported(host);const cubes=findCubes(host,input.beams.map(b=>b.cube_id));
  const plans=input.beams.map((b,i)=>{
    const cube=cubes[i]!;
    if(!cube.box_uv)throw new BridgeError('INVALID_PARAMS','Beam alignment requires Box UV.');
    host.beamEndpoints(cube); // Reject nonstandard stretch/inflate before starting Undo.
    const spec=beamGeometry(b.start,b.end,b.thickness??cube.to[0]-cube.from[0],b.thickness??cube.to[2]-cube.from[2]);
    checkBoxUV(project,spec,cube.uv_offset);return spec;
  });
  const scope={elements:cubes};
  return edit(host,project,'Blockbench AI: Align beam endpoints',scope,()=>scope,()=>{
    cubes.forEach((cube,i)=>host.updateCubeGeometry(cube,plans[i]!));
    return {project_id:project.uuid,count:cubes.length,beams:measure(host,cubes,input.beams)};
  });
}
