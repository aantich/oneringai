/** Actual AMOS routine command with synthetic provider; no keys or network. */
import assert from 'node:assert/strict';
import { Connector } from '@everworker/oneringai';
import { offlineRoutingConnector } from '../../../examples/model-routing/fixture.js';
import { RoutineCommand } from '../src/commands/commands/RoutineCommand.js';
import { DEFAULT_CONFIG } from '../src/config/types.js';
import type { IAmosApp } from '../src/config/types.js';
const { connector, mainModel, requests } = offlineRoutingConnector('amos-composition');
const config = structuredClone(DEFAULT_CONFIG); config.activeConnector = connector.name; config.activeModel = mainModel;
const app = { getConfig: () => config, getConnectorManager: () => ({ registerConnector: () => {} }) } as unknown as IAmosApp;
const command = new RoutineCommand();
try {
  for (const action of ['demo', 'inspect', 'confirm', 'inspect']) {
    const result = await command.execute({ app, args: [action], rawInput: `/routine ${action}` }); assert.equal(result.success, true); console.log(result.message);
  }
  assert.equal(requests.length, 1); console.log(JSON.stringify({ passed: true, modelCalls: 1, verification: 'host confirmed', workflowRecovery: 'same-process only' }));
} finally { command.close(); Connector.remove(connector.name); }
