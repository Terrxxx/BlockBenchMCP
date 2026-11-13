import * as path from 'node:path';
import { readConfig } from '../shared/config.js';
import { asBridgeError } from '../shared/errors.js';
import type { Logger } from '../shared/logger.js';
import { Workspace } from '../shared/workspace.js';
import { BlockbenchAdapter } from './adapter.js';
import { browserSocket, PluginConnection } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { createNativeHost } from './native-host.js';
import { PLUGIN_VERSION } from '../shared/protocol.js';

let connection: PluginConnection | undefined;
let connectAction: Action | undefined;
let disconnectAction: Action | undefined;
let connectionDialog: Dialog | undefined;
let status = 'Disconnected';
const logger: Logger = (level, event, fields = {}) => console[level === 'info' ? 'info' : level]('[Blockbench AI MCP]', event, fields);

BBPlugin.register('blockbench_ai_mcp', {
  title: 'Blockbench AI MCP', author: 'Terrxx',
  description: 'Workspace-scoped local MCP bridge for Bedrock Entity modeling.',
  icon: 'smart_toy', version: PLUGIN_VERSION, variant: 'desktop', min_version: '5.2.2', max_version: '5.99.99',
  tags: ['Minecraft: Bedrock Edition'],
  onload() {
    connectAction = new Action('blockbench_ai_mcp_connect', {
      name: 'Blockbench AI MCP: Connect', icon: 'link',
      click() {
        connectionDialog = new Dialog('blockbench_ai_mcp_connection', {
          title: 'Blockbench AI MCP',
          form: {
            workspace: { label: 'Workspace directory', type: 'text', placeholder: 'D:\\Desktop\\BlockBenchMCP' },
            status: { label: 'Status', type: 'info', text: status },
          },
          onConfirm(form) {
            try {
              const root = typeof form.workspace === 'string' ? form.workspace.trim() : '';
              if (!path.isAbsolute(root)) throw new Error('Enter an absolute workspace directory.');
              const fileSystem = requireNativeModule('fs', {
                scope: path.resolve(root), optional: true,
                message: 'Read the local bridge configuration and verify project save paths inside this workspace.',
              });
              if (!fileSystem) throw new Error('Workspace directory permission was denied.');
              const workspace = new Workspace(root, fileSystem);
              const config = readConfig(workspace);
              const adapter = new BlockbenchAdapter(createNativeHost(), workspace);
              connection?.stop();
              connection = new PluginConnection(config, new Dispatcher(request => adapter.execute(request), logger), browserSocket, logger, Blockbench.version,
                value => { status = value; if (value === 'Connected') Blockbench.showQuickMessage('Blockbench AI MCP connected', 2000); });
              connection.start();
            } catch (error) {
              // Only local UI messages can show local permission/setup details.
              Blockbench.showMessageBox({ title: 'Blockbench AI MCP', message: error instanceof Error ? error.message : asBridgeError(error).message, icon: 'error' });
            }
          },
        });
        connectionDialog.show();
      },
    });
    disconnectAction = new Action('blockbench_ai_mcp_disconnect', {
      name: 'Blockbench AI MCP: Disconnect', icon: 'link_off',
      click() { connection?.stop(); connection = undefined; },
    });
    MenuBar.addAction(connectAction, 'tools');
    MenuBar.addAction(disconnectAction, 'tools');
  },
  onunload() {
    connection?.stop(); connection = undefined;
    connectionDialog?.hide(); connectionDialog = undefined;
    connectAction?.delete(); connectAction = undefined;
    disconnectAction?.delete(); disconnectAction = undefined;
  },
});
