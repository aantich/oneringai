import { ConnectorTools } from '../tools/connector/ConnectorTools.js';
import { toolRegistry } from '../tools/registry.browser.generated.js';
export function loadConnectorToolsModule(): { ConnectorTools: typeof ConnectorTools } { return { ConnectorTools }; }
export function loadBuiltInToolRegistry(): { toolRegistry: typeof toolRegistry } { return { toolRegistry }; }
