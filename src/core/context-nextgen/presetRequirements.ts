import type { EvidenceScope, IEvidenceStorage } from '../../domain/interfaces/IEvidenceStorage.js';
/** Host-local preset constraints. Spreads retain them; session/portable data does not. */
export const PRESET_REQUIRED_PLUGINS = Symbol('presetRequiredPlugins');
export type RequiredPresetPlugins = {
  evidence?: { scope: EvidenceScope; storage: IEvidenceStorage };
  taskState?: { scope: EvidenceScope; taskId: string; association?: string };
};
export type PresetPluginRequirements = { [PRESET_REQUIRED_PLUGINS]?: RequiredPresetPlugins };
