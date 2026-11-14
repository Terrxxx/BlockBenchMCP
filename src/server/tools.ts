import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { asBridgeError } from '../shared/errors.js';
import { commandNames, isReadOnlyCommand, inputSchemas, outputSchemas, type Command, type ToolInput } from '../shared/protocol.js';
import type { BridgeServer } from './bridge.js';
import type { Workspace } from '../shared/workspace.js';

const descriptions: Record<Command, string> = {
  list_projects: 'List open project tabs without switching; paged IDs, names, format, active, managed, locked and saved flags. No filesystem paths.',
  select_project: 'Select an open tab by project UUID through the official API. Does not save, close, or grant editing ownership. Inspect state after selection; BUSY when editing/locked.',
  get_cube_uv: 'Read actual six-face UV rectangles, rotations, bindings, physical face sizes and pixel sizes for 1–256 cubes in the active Bedrock tab, including unmanaged tabs. Reveals zero-area UV and texel density.',
  set_face_uv: 'Set complete six-face UV rectangles for 1–256 managed cubes as one Undo batch. Switches Box UV to per-face UV, preserving texture IDs and geometry. Pixel coordinates, fractional and reversed rectangles allowed; rotation 0/90/180/270. Thin parts should use nonzero rectangles. Zero area requires allow_degenerate:true. Atlas bounds checked for whole batch.',
  update_cubes: 'Patch cube name/from/to/origin/rotation by ID in one Undo batch; preserve IDs, parent and UV/texture bindings. Coordinates are stored model coordinates before bone transforms. Preflights final geometry and UV bounds; returns degenerate Box UV warnings. Use to repair geometry instead of recreating models.',
  validate_project: 'Read-only UV and volume diagnostics for the active Bedrock tab, including unmanaged projects. Detect degenerate face UV, out-of-bounds UV, missing explicit texture bindings and zero-volume cubes. Reports total/truncation. Intentional point sampling is a warning, not a quality failure. Does not test collisions; use check_collisions separately.',
  check_collisions: 'Check selected 1–256 cubes for potential solid-volume intersections in native rest pose or explicit numeric animation times (max 33). SAT on native transformed box corners, including rotated parents. Excludes same direct parent bone by default. Reports pair IDs, times, projection overlap and completeness; ignores contacts within tolerance. Not continuous collision detection or a physical penetration depth. Intentional joints may overlap. Restores pose/time/cache, no Undo or model writes. Max 200000 pair-samples.',
  create_beams: 'Create 1–256 square-section rods between two end-face centres with verified Bedrock ZYX rotation. Explicit parent_id. Coordinates are unrotated model coordinates before parent bone transforms, as Cube.from/to, not animated world positions. One Undo, Box UV preflight. No inflate/stretch/rescale.',
  align_beams: 'Align existing cubes between start/end face centres in unrotated model coordinates before parent bone transforms. Preserves cube IDs, names, parents and UV/texture bindings. Optional thickness replaces both cross-section sizes; omitted preserves X/Z sizes. Entire batch preflight, one Undo and native endpoint verification.',
  render_project: 'Render active managed Bedrock cubes to workspace-relative PNG from an explicit perspective or orthographic camera. Optional numeric bone animation ID/time; omitted means rest pose. Internal textures only; no IK/controllers. Restores display state; does not save the project. Defaults transparent 512x512, maximum 2048 per side. Overwrite is explicit.',
  export_bedrock_model: 'Export active managed Bedrock geometry through the official codec to a workspace-relative .geo.json. Omits visible bounds; honors native export flags. Does not save or dirty the project. Overwrite replaces the whole file.',
  export_bedrock_animations: 'Export 1–128 selected numeric bone animations through the official codec to one workspace-relative .animation.json. Official snapping applies; collisions are rejected before writing. No IK, effects or controllers. Overwrite replaces the whole file.',
  export_texture_png: 'Export an internal static PNG atlas by texture_id to a workspace-relative .png using the official image writer. Does not relink or mark the source texture as saved. Overwrite replaces the whole file.',
  create_animation: 'Create an undoable numeric Bedrock animation clip. Name animation.namespace.name; length in seconds; loop once/loop/hold. Does not write an external animation file.',
  update_animation: 'Update animation name, length, loop or snapping as one Undo step. Length must include every existing keyframe.',
  set_keyframes: 'Upsert 1–256 numeric bone transform keyframes, one Undo batch. Key is bone_id/channel/exact time in seconds. Existing UUIDs preserved. No time snapping, Molang or effects. Selects target animation and prepares timeline tracks.',
  delete_keyframes: 'Delete a batch of keyframe UUIDs from one managed animation as one Undo step; validates the complete batch first.',
  get_animation_state: 'Read active project animations without evaluating expressions. Without animation_id pages clips; with animation_id pages bone keyframes. Query after uncertain outcomes; supports reopened unmanaged projects.',
  preview_animation: 'Pause playback and preview a numeric managed animation at a time in seconds using official Animate mode. Changes selection/time, not model data; no Undo entry.',
  create_project: 'Create a new Minecraft Bedrock Entity project tab. Supply model_identifier without geometry. prefix. Returns its UUID. Does not close existing tabs.',
  get_project_state: 'Inspect the active project and a bounded page of cubes from memory. Use after timeouts or reconnecting to reconcile uncertain mutations.',
  create_cubes: 'Create 1–256 cubes in the active managed Bedrock project as one Undo batch. Preflights atlas bounds and returns uv_warnings for degenerate Box UV; thin parts should use set_face_uv. Optional parent_id targets an existing bone; otherwise reuse/create the default root. root_group_id in the result is the actual batch parent ID.',
  save_project: 'Save a managed active project as .bbmodel through the official Blockbench codec. Path is relative to the authorized workspace; parents must exist. Existing files require overwrite:true.',
  create_bones: 'Create an undoable batch of named Bedrock bones. Use unique batch keys and parent_key for same-batch parents, or parent_id for existing bones. No implicit renaming.',
  update_bones: 'Update a batch of Bedrock bones by ID: name, pivot origin, rotation or parent_id (null for top level). Preserves child coordinate values; does not compensate world-space appearance.',
  reparent_cubes: 'Move specified cubes into an existing bone as one Undo step. Preserves stored cube coordinates and rotation, not world-space appearance under rotated parents.',
  import_texture: 'Import one static PNG from a workspace-relative path as the shared Bedrock atlas. Maximum 8 MiB and 4096 pixels per side; dimensions must match the project. Requires no existing texture. Embeds image data without linking or watching source files.',
  assign_texture: 'Bind the project single Bedrock atlas to all enabled faces of specified Box UV or per-face UV cubes in one Undo batch. Validates atlas bounds. Bedrock shares one effective atlas across the whole entity.',
  set_cube_uv: 'Set Box UV offsets and optional mirror_uv for a cube batch. Validates the entire UV rectangle against project dimensions. Missing mirror_uv preserves the current value. Switches to Box UV; returns uv_warnings when thin dimensions collapse faces. Use set_face_uv for independent pixel density.',
};

export function createMcpServer(bridge: BridgeServer, workspace: Workspace): McpServer {
  const server = new McpServer({ name: 'blockbench-ai-mcp', version: '0.7.0', title: 'Blockbench AI MCP' }, {
    instructions: 'Connect the desktop plugin to the same workspace. Create a Bedrock project, retain its project UUID, then batch cubes and save relative .bbmodel paths. Never automatically retry mutations after timeout/disconnect: inspect get_project_state first. Only plugin-created projects in the active connection session are mutable. Use list_projects/select_project to target the correct tab. Plan atlas regions before creating details; sub-unit Box UV dimensions truncate, so use get_cube_uv and set_face_uv for thin parts. Review uv_warnings after mutations, validate_project before saving, and check_collisions at rest/open/intermediate animation times. Render multiple views for visual acceptance; successful writes do not guarantee quality. No arbitrary code or filesystem tools are available.',
  });
  function register(command: Command): void {
    server.registerTool<typeof outputSchemas[Command], typeof inputSchemas[Command]>(command, {
      description: descriptions[command], inputSchema: inputSchemas[command], outputSchema: outputSchemas[command],
      annotations: {
        readOnlyHint: isReadOnlyCommand(command), destructiveHint: command === 'save_project' || command === 'render_project' || command.startsWith('export_'),
        idempotentHint: isReadOnlyCommand(command), openWorldHint: false,
      },
    }, async (raw: unknown, context: ServerContext): Promise<CallToolResult> => {
      try {
        const input = inputSchemas[command].parse(raw) as ToolInput<Command>;
        if (command === 'save_project') {
          const save = inputSchemas.save_project.parse(input);
          workspace.saveTarget(save.path, save.overwrite);
        }
        if (command === 'import_texture') workspace.pngTarget(inputSchemas.import_texture.parse(input).path);
        if(command === 'render_project') {const render=inputSchemas.render_project.parse(input);workspace.exportTarget(render.path,'texture_png',render.overwrite);}
        if (command === 'export_bedrock_model' || command === 'export_bedrock_animations' || command === 'export_texture_png') {
          const output = inputSchemas[command].parse(input);
          workspace.exportTarget(output.path, command === 'export_bedrock_model' ? 'bedrock_model'
            : command === 'export_bedrock_animations' ? 'bedrock_animations' : 'texture_png', output.overwrite);
        }
        const result = await bridge.call(command, input, context.mcpReq.signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const info = asBridgeError(error).toJSON();
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: info }) }], structuredContent: { error: info } };
      }
    });
  }
  for (const command of commandNames) register(command);
  return server;
}
