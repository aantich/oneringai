/**
 * Agent Editor Page - Create or edit an agent
 */

import { useChatGPTStatus } from '../hooks/useChatGPTStatus.js';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Button,
  Form,
  Card,
  Nav,
  Row,
  Col,
  Badge,
  OverlayTrigger,
  Tooltip,
  Alert,
  Collapse,
} from 'react-bootstrap';
import { ArrowLeft, Save, Trash2, HelpCircle, AlertCircle, ChevronDown, ChevronRight, Server, Wrench, RefreshCw, Cloud, Shield } from 'lucide-react';
import { PermissionRulesEditor, type IPermissionRuleInfo, type INewPermissionRule } from '../../ui/index.js';
import { PageHeader } from '../components/layout';
import { useNavigation } from '../hooks/useNavigation';
import { useConnectorVersion } from '../App';

// Agent type - NextGen only supports 'basic' (other types deprecated)
type AgentType = 'basic';

// Strategy info type (matches StrategyInfo from library)
interface StrategyInfo {
  name: string;
  displayName: string;
  description: string;
  threshold: number;
  isBuiltIn: boolean;
}

interface ToolInfo {
  name: string;
  displayName: string;
  category: string;
  description: string;
  safeByDefault: boolean;
  requiresConnector: boolean;
  connectorServiceTypes?: string[];
  connectorName?: string;
  serviceType?: string;
}

// Category display names and icons
const CATEGORY_LABELS: Record<string, string> = {
  filesystem: 'Filesystem',
  shell: 'Shell',
  web: 'Web',
  code: 'Code Execution',
  json: 'JSON',
  connector: 'API Connectors',
  desktop: 'Desktop Automation',
  'custom-tools': 'Custom Tools',
  routines: 'Routines',
  other: 'Other',
};

const ALL_TOOL_CATEGORIES = [
  'filesystem', 'shell', 'web', 'code', 'json', 'desktop', 'custom-tools', 'routines', 'other',
];

interface UniversalConnector {
  name: string;
  vendorId: string;
  vendorName: string;
  authMethodId: string;
  authMethodName: string;
  credentials: Record<string, string>;
  displayName?: string;
  baseURL?: string;
  status: 'active' | 'error' | 'untested';
  source?: 'local' | 'backend' | 'built-in';
}

interface MCPServerInfo {
  name: string;
  displayName?: string;
  description?: string;
  transport: string;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  toolCount?: number;
  availableTools?: string[];
}

interface MCPTool {
  name: string;
  description?: string;
}

interface AgentMCPServerRef {
  serverName: string;
  selectedTools?: string[];
}

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow: number;
  realtime?: boolean;
  voices?: Array<{ id: string; name: string; gender: string; isDefault?: boolean }>;
}

interface AgentFormData {
  name: string;
  connector: string;
  model: string;
  agentType: AgentType; // Always 'basic' in NextGen
  instructions: string;
  temperature: number;
  // Execution settings
  maxIterations: number;
  // Context settings
  contextStrategy: string; // 'proactive' | 'balanced' | 'lazy'
  maxContextTokens: number;
  responseReserve: number;
  // Memory settings (renamed to workingMemory for NextGen)
  workingMemoryEnabled: boolean;
  maxMemorySizeBytes: number;
  maxMemoryIndexEntries: number;
  memorySoftLimitPercent: number;
  contextAllocationPercent: number;
  // In-context memory
  inContextMemoryEnabled: boolean;
  maxInContextEntries: number;
  maxInContextTokens: number;
  // Persistent instructions
  persistentInstructionsEnabled: boolean;
  // User info
  userInfoEnabled: boolean;
  // Dynamic UI
  dynamicUIEnabled: boolean;
  // Tool permissions
  permissionsEnabled: boolean;
  // Selected tools
  tools: string[];
  // Tool catalog
  toolCatalogEnabled: boolean;
  pinnedCategories: string[];
  toolCategoryScope: string[];
  // MCP servers
  mcpServers: AgentMCPServerRef[];
  // Voice/TTS settings
  voiceEnabled: boolean;
  voiceConnector: string;
  voiceModel: string;
  voiceVoice: string;
  voiceFormat: string;
  voiceSpeed: number;
  // Voice Bridge (Phone Calling)
  voiceBridgeEnabled: boolean;
  voiceBridgeTwilioConnector: string;
  voiceBridgeSttConnector: string;
  voiceBridgeSttModel: string;
  voiceBridgeTtsConnector: string;
  voiceBridgeTtsModel: string;
  voiceBridgeTtsVoice: string;
  voiceBridgeGreeting: string;
  voiceBridgeGreetingOutbound: string;
  voiceBridgeInterruptible: boolean;
  voiceBridgePort: number;
  voiceBridgePublicUrl: string;
  voiceBridgeMaxConcurrent: number;
  voiceBridgeMaxDuration: number;
  voiceBridgeFromNumber: string;
  // Orchestrator mode
  isOrchestrator: boolean;
  orchestratorChildAgents: Array<{ agentConfigId: string; alias: string }>;
  orchestratorMaxAgents: number;
}

const defaultFormData: AgentFormData = {
  name: '',
  connector: '',
  model: '',
  agentType: 'basic', // Only 'basic' supported in NextGen
  instructions: '',
  temperature: 0.7,
  // Execution settings
  maxIterations: 50, // Default from AGENT_DEFAULTS.MAX_ITERATIONS
  // Context settings
  contextStrategy: 'algorithmic', // Default strategy from registry
  maxContextTokens: 128000,
  responseReserve: 4096,
  // Memory settings (workingMemory in NextGen)
  workingMemoryEnabled: true,
  maxMemorySizeBytes: 25 * 1024 * 1024, // 25MB
  maxMemoryIndexEntries: 30, // Limit memory index entries in context
  memorySoftLimitPercent: 80,
  contextAllocationPercent: 10,
  // In-context memory
  inContextMemoryEnabled: false,
  maxInContextEntries: 20,
  maxInContextTokens: 4000,
  // Persistent instructions
  persistentInstructionsEnabled: false,
  // User info
  userInfoEnabled: false,
  // Dynamic UI
  dynamicUIEnabled: true,
  // Tool permissions
  permissionsEnabled: true,
  // Tools
  tools: [],
  // Tool catalog
  toolCatalogEnabled: false,
  pinnedCategories: [],
  toolCategoryScope: [],
  // MCP servers
  mcpServers: [],
  // Voice/TTS settings
  voiceEnabled: false,
  voiceConnector: '',
  voiceModel: '',
  voiceVoice: '',
  voiceFormat: 'mp3',
  voiceSpeed: 1.0,
  // Voice Bridge (Phone Calling)
  voiceBridgeEnabled: false,
  voiceBridgeTwilioConnector: '',
  voiceBridgeSttConnector: '',
  voiceBridgeSttModel: '',
  voiceBridgeTtsConnector: '',
  voiceBridgeTtsModel: '',
  voiceBridgeTtsVoice: '',
  voiceBridgeGreeting: '',
  voiceBridgeGreetingOutbound: '',
  voiceBridgeInterruptible: true,
  voiceBridgePort: 3000,
  voiceBridgePublicUrl: '',
  voiceBridgeMaxConcurrent: 5,
  voiceBridgeMaxDuration: 1800,
  voiceBridgeFromNumber: '',
  // Orchestrator mode
  isOrchestrator: false,
  orchestratorChildAgents: [],
  orchestratorMaxAgents: 20,
};

export function AgentEditorPage(): React.ReactElement {
  const { state, goBack, navigate } = useNavigation();
  const isEditMode = state.params.mode === 'edit';
  const agentId = state.params.id as string | undefined;
  const { status: chatGPTStatus } = useChatGPTStatus();
  const [formData, setFormData] = useState<AgentFormData>(defaultFormData);
  const [selectedChildAgentId, setSelectedChildAgentId] = useState('');
  const [activeTab, setActiveTab] = useState<string>('general');
  const [saving, setSaving] = useState(false);

  // Data from API
  const [connectors, setConnectors] = useState<{ name: string; vendor: string; source?: 'local' | 'backend' | 'built-in' }[]>([]);
  const [modelsByVendor, setModelsByVendor] = useState<
    { vendor: string; models: ModelInfo[] }[]
  >([]);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [universalConnectors, setUniversalConnectors] = useState<UniversalConnector[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServerInfo[]>([]);
  const [mcpServerTools, setMCPServerTools] = useState<Record<string, MCPTool[]>>({});
  const [loadingMCPTools, setLoadingMCPTools] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string; model: string; tools: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const connectorVersion = useConnectorVersion();

  // Voice/TTS state
  const [ttsModels, setTTSModels] = useState<Array<{ name: string; displayName: string; vendor: string; connector: string; maxInputLength: number; voiceCount: number }>>([]);
  const [ttsCapabilities, setTTSCapabilities] = useState<{
    voices: Array<{ id: string; name: string; language: string; gender: 'male' | 'female' | 'neutral'; style?: string; isDefault?: boolean; accent?: string }>;
    formats: string[];
    speed: { supported: boolean; min?: number; max?: number; default?: number };
  } | null>(null);

  // Voice Bridge state
  const [sttModels, setSTTModels] = useState<Array<{ name: string; displayName: string; vendor: string; connector: string }>>([]);
  const [bridgeTTSModels, setBridgeTTSModels] = useState<Array<{ name: string; displayName: string; vendor: string; connector: string }>>([]);
  const [bridgeTTSCapabilities, setBridgeTTSCapabilities] = useState<{
    voices: Array<{ id: string; name: string; language: string; gender: 'male' | 'female' | 'neutral'; style?: string; isDefault?: boolean }>;
  } | null>(null);
  const [twilioConnectors, setTwilioConnectors] = useState<UniversalConnector[]>([]);

  // Live models fetched from the connector's API (e.g. Ollama)
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [loadingLiveModels, setLoadingLiveModels] = useState(false);

  // Load data on mount (and when connectors change via backend profile switch)
  useEffect(() => {
    async function loadData() {
      try {
        const [connectorsList, models, tools, uniConns, mcpServersList, strategyList, agentsList] = await Promise.all([
          window.hosea.connector.list(),
          window.hosea.model.list(),
          window.hosea.tool.registry(),
          window.hosea.universalConnector.list(),
          window.hosea.mcpServer.list(),
          window.hosea.strategy.list(),
          window.hosea.agentConfig.list(),
        ]);
        setConnectors(connectorsList);
        setModelsByVendor(models);
        setAvailableTools(Array.isArray(tools) ? tools : []);
        setUniversalConnectors(uniConns);
        setMCPServers(mcpServersList);
        setStrategies(strategyList);
        setAvailableAgents(agentsList.map(a => ({ id: a.id, name: a.name, model: a.model, tools: a.tools })));

        // Load existing agent data if in edit mode
        if (isEditMode && agentId) {
          const existingAgent = await window.hosea.agentConfig.get(agentId);
          if (existingAgent) {
            // Validate strategy exists in registry, fallback to 'balanced' if not
            const validStrategy = strategyList.some((s) => s.name === existingAgent.contextStrategy)
              ? existingAgent.contextStrategy
              : 'default';

            setFormData({
              name: existingAgent.name,
              connector: existingAgent.connector,
              model: existingAgent.model,
              agentType: existingAgent.agentType,
              instructions: existingAgent.instructions,
              temperature: existingAgent.temperature,
              maxIterations: existingAgent.maxIterations ?? 50,
              contextStrategy: validStrategy,
              maxContextTokens: existingAgent.maxContextTokens,
              responseReserve: existingAgent.responseReserve,
              workingMemoryEnabled: existingAgent.workingMemoryEnabled,
              maxMemorySizeBytes: existingAgent.maxMemorySizeBytes,
              maxMemoryIndexEntries: existingAgent.maxMemoryIndexEntries ?? 30,
              memorySoftLimitPercent: existingAgent.memorySoftLimitPercent,
              contextAllocationPercent: existingAgent.contextAllocationPercent,
              inContextMemoryEnabled: existingAgent.inContextMemoryEnabled,
              maxInContextEntries: existingAgent.maxInContextEntries,
              maxInContextTokens: existingAgent.maxInContextTokens,
              persistentInstructionsEnabled: existingAgent.persistentInstructionsEnabled ?? false,
              userInfoEnabled: existingAgent.userInfoEnabled ?? false,
              dynamicUIEnabled: existingAgent.dynamicUIEnabled ?? false,
              permissionsEnabled: existingAgent.permissionsEnabled ?? true,
              tools: existingAgent.tools,
              toolCatalogEnabled: existingAgent.toolCatalogEnabled ?? false,
              pinnedCategories: existingAgent.pinnedCategories ?? [],
              toolCategoryScope: existingAgent.toolCategoryScope ?? [],
              mcpServers: existingAgent.mcpServers || [],
              // Voice/TTS settings
              voiceEnabled: existingAgent.voiceEnabled ?? false,
              voiceConnector: existingAgent.voiceConnector ?? '',
              voiceModel: existingAgent.voiceModel ?? '',
              voiceVoice: existingAgent.voiceVoice ?? '',
              voiceFormat: existingAgent.voiceFormat ?? 'mp3',
              voiceSpeed: existingAgent.voiceSpeed ?? 1.0,
              // Voice Bridge (Phone Calling)
              voiceBridgeEnabled: existingAgent.voiceBridgeEnabled ?? false,
              voiceBridgeTwilioConnector: existingAgent.voiceBridgeTwilioConnector ?? '',
              voiceBridgeSttConnector: existingAgent.voiceBridgeSttConnector ?? '',
              voiceBridgeSttModel: existingAgent.voiceBridgeSttModel ?? '',
              voiceBridgeTtsConnector: existingAgent.voiceBridgeTtsConnector ?? '',
              voiceBridgeTtsModel: existingAgent.voiceBridgeTtsModel ?? '',
              voiceBridgeTtsVoice: existingAgent.voiceBridgeTtsVoice ?? '',
              voiceBridgeGreeting: existingAgent.voiceBridgeGreeting ?? '',
              voiceBridgeGreetingOutbound: (existingAgent as Record<string, unknown>).voiceBridgeGreetingOutbound as string ?? '',
              voiceBridgeInterruptible: existingAgent.voiceBridgeInterruptible ?? true,
              voiceBridgePort: existingAgent.voiceBridgePort ?? 3000,
              voiceBridgePublicUrl: existingAgent.voiceBridgePublicUrl ?? '',
              voiceBridgeMaxConcurrent: existingAgent.voiceBridgeMaxConcurrent ?? 5,
              voiceBridgeMaxDuration: existingAgent.voiceBridgeMaxDuration ?? 1800,
              voiceBridgeFromNumber: existingAgent.voiceBridgeFromNumber ?? '',
              // Orchestrator
              isOrchestrator: (existingAgent as Record<string, unknown>).isOrchestrator as boolean ?? false,
              orchestratorChildAgents: ((existingAgent as Record<string, unknown>).orchestratorChildAgents as AgentFormData['orchestratorChildAgents']) ?? [],
              orchestratorMaxAgents: ((existingAgent as Record<string, unknown>).orchestratorMaxAgents as number) ?? 20,
            });
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [isEditMode, agentId, connectorVersion]);

  // Fetch live models from the connector's API when connector changes
  useEffect(() => {
    if (!formData.connector) {
      setLiveModels([]);
      return;
    }
    const connector = connectors.find((c) => c.name === formData.connector);
    if (!connector) {
      setLiveModels([]);
      return;
    }
    let cancelled = false;
    setLoadingLiveModels(true);
    window.hosea.connector
      .fetchModels(connector.vendor, undefined, undefined, connector.name)
      .then((result) => {
        if (!cancelled) {
          setLiveModels(result.success && result.models ? result.models : []);
        }
      })
      .catch(() => {
        if (!cancelled) setLiveModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLiveModels(false);
      });
    return () => { cancelled = true; };
  }, [formData.connector, connectors, chatGPTStatus]);

  // Load TTS models when voice is enabled
  useEffect(() => {
    if (!formData.voiceEnabled) {
      setTTSModels([]);
      setTTSCapabilities(null);
      return;
    }
    let cancelled = false;
    window.hosea.multimedia.getAvailableTTSModels()
      .then((models) => {
        if (!cancelled) setTTSModels(models);
      })
      .catch((err) => {
        console.error('Failed to load TTS models:', err);
        if (!cancelled) setTTSModels([]);
      });
    return () => { cancelled = true; };
  }, [formData.voiceEnabled]);

  // Load TTS capabilities when voice model changes
  useEffect(() => {
    if (!formData.voiceModel) {
      setTTSCapabilities(null);
      return;
    }
    let cancelled = false;
    window.hosea.multimedia.getTTSModelCapabilities(formData.voiceModel)
      .then((caps) => {
        if (!cancelled) {
          setTTSCapabilities(caps as typeof ttsCapabilities);
          // Auto-select default voice if none selected
          if (!formData.voiceVoice && caps?.voices?.length) {
            const defaultVoice = caps.voices.find((v: { isDefault?: boolean }) => v.isDefault);
            setFormData((prev) => ({
              ...prev,
              voiceVoice: defaultVoice?.id ?? caps.voices[0]?.id ?? '',
            }));
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load TTS capabilities:', err);
        if (!cancelled) setTTSCapabilities(null);
      });
    return () => { cancelled = true; };
  }, [formData.voiceModel]);

  // Load STT models and Twilio connectors when voice bridge is enabled
  useEffect(() => {
    if (!formData.voiceBridgeEnabled) {
      setSTTModels([]);
      setBridgeTTSModels([]);
      setBridgeTTSCapabilities(null);
      setTwilioConnectors([]);
      return;
    }
    let cancelled = false;
    // Load STT models, TTS models, and Twilio connectors in parallel
    Promise.all([
      window.hosea.multimedia.getAvailableSTTModels(),
      window.hosea.multimedia.getAvailableTTSModels(),
      window.hosea.universalConnector.list(),
    ]).then(([stt, tts, uniConns]) => {
      if (!cancelled) {
        setSTTModels(stt);
        setBridgeTTSModels(tts);
        setTwilioConnectors(uniConns.filter((c: UniversalConnector) => c.vendorId === 'twilio'));
      }
    }).catch((err) => {
      console.error('Failed to load voice bridge data:', err);
    });
    return () => { cancelled = true; };
  }, [formData.voiceBridgeEnabled]);

  // Load bridge TTS voice capabilities when bridge TTS model changes
  useEffect(() => {
    if (!formData.voiceBridgeTtsModel) {
      setBridgeTTSCapabilities(null);
      return;
    }
    let cancelled = false;
    window.hosea.multimedia.getTTSModelCapabilities(formData.voiceBridgeTtsModel)
      .then((caps) => {
        if (!cancelled && caps) {
          setBridgeTTSCapabilities({ voices: caps.voices as Array<{ id: string; name: string; language: string; gender: 'male' | 'female' | 'neutral'; style?: string; isDefault?: boolean }> });
          // Auto-select default voice if none selected
          if (!formData.voiceBridgeTtsVoice && caps.voices?.length) {
            const defaultVoice = caps.voices.find((v: { isDefault?: boolean }) => v.isDefault);
            setFormData((prev) => ({
              ...prev,
              voiceBridgeTtsVoice: defaultVoice?.id ?? caps.voices[0]?.id ?? '',
            }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setBridgeTTSCapabilities(null);
      });
    return () => { cancelled = true; };
  }, [formData.voiceBridgeTtsModel]);

  // Get models for selected connector's vendor (from static registry)
  const getModelsForConnector = useCallback((): ModelInfo[] => {
    const connector = connectors.find((c) => c.name === formData.connector);
    if (!connector) return [];

    const vendorModels = modelsByVendor.find(
      (v) => v.vendor.toLowerCase() === connector.vendor.toLowerCase()
    );
    const models = vendorModels?.models || [];
    return chatGPTStatus?.usePlan && connector.vendor === 'openai' ? models.filter(model => liveModels.includes(model.id)) : models;
  }, [connectors, formData.connector, modelsByVendor, chatGPTStatus?.usePlan, liveModels]);

  // Live models not already in the registry
  const extraLiveModels = useMemo(() => {
    const registryIds = new Set(getModelsForConnector().map((m) => m.id));
    return liveModels.filter((id) => !registryIds.has(id));
  }, [liveModels, getModelsForConnector]);

  // Update maxContextTokens when model changes
  useEffect(() => {
    const models = getModelsForConnector();
    const selectedModel = models.find((m) => m.id === formData.model);
    if (selectedModel && selectedModel.contextWindow !== formData.maxContextTokens) {
      setFormData((prev) => ({
        ...prev,
        maxContextTokens: selectedModel.contextWindow,
      }));
    }
  }, [formData.model, getModelsForConnector, formData.maxContextTokens]);

  // Check if a tool is operational (has required connectors configured)
  const isToolOperational = useCallback(
    (tool: ToolInfo): boolean => {
      if (!tool.requiresConnector) return true;
      if (!tool.connectorServiceTypes || tool.connectorServiceTypes.length === 0) return true;

      // Check universal connectors (by vendorId) OR LLM provider connectors (by vendor)
      return tool.connectorServiceTypes.some(
        (serviceType) =>
          universalConnectors.some((uc) => uc.vendorId === serviceType) ||
          connectors.some((c) => c.vendor === serviceType)
      );
    },
    [universalConnectors, connectors]
  );

  // Separate tools into operational and non-operational, and group them
  const {
    builtInToolsByCategory,
    connectorToolsByConnector,
    nonOperationalTools,
    allOperationalToolNames
  } = useMemo(() => {
    const builtIn: Record<string, ToolInfo[]> = {};
    const byConnector: Record<string, ToolInfo[]> = {};
    const nonOperational: ToolInfo[] = [];
    const operationalNames: string[] = [];

    availableTools.forEach((tool) => {
      const isOperational = isToolOperational(tool);

      if (!isOperational) {
        nonOperational.push(tool);
        return;
      }

      operationalNames.push(tool.name);

      // Connector-generated tools (have connectorName)
      if (tool.connectorName) {
        if (!byConnector[tool.connectorName]) {
          byConnector[tool.connectorName] = [];
        }
        byConnector[tool.connectorName].push(tool);
      } else {
        // Built-in tools - group by category
        const category = tool.category || 'other';
        if (!builtIn[category]) {
          builtIn[category] = [];
        }
        builtIn[category].push(tool);
      }
    });

    // Sort tools within each group
    const sortFn = (a: ToolInfo, b: ToolInfo) => a.displayName.localeCompare(b.displayName);

    Object.values(builtIn).forEach(tools => tools.sort(sortFn));
    Object.values(byConnector).forEach(tools => tools.sort(sortFn));
    nonOperational.sort(sortFn);

    return {
      builtInToolsByCategory: builtIn,
      connectorToolsByConnector: byConnector,
      nonOperationalTools: nonOperational,
      allOperationalToolNames: operationalNames,
    };
  }, [availableTools, isToolOperational]);

  // Map connector names to their source (local vs backend)
  const connectorSourceMap = useMemo(() => {
    const map = new Map<string, 'local' | 'backend' | 'built-in'>();
    for (const c of connectors) {
      if (c.source) map.set(c.name, c.source);
    }
    for (const uc of universalConnectors) {
      if (uc.source) map.set(uc.name, uc.source);
    }
    return map;
  }, [connectors, universalConnectors]);

  // Track expanded sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  // Check if all tools in a group are selected
  const isGroupFullySelected = (toolNames: string[]): boolean => {
    return toolNames.every(name => formData.tools.includes(name));
  };

  // Check if some tools in a group are selected
  const isGroupPartiallySelected = (toolNames: string[]): boolean => {
    const selectedCount = toolNames.filter(name => formData.tools.includes(name)).length;
    return selectedCount > 0 && selectedCount < toolNames.length;
  };

  // Toggle all tools in a group
  const toggleGroup = (toolNames: string[], select: boolean) => {
    setFormData(prev => {
      if (select) {
        // Add all tools from group that aren't already selected
        const newTools = [...prev.tools];
        toolNames.forEach(name => {
          if (!newTools.includes(name)) {
            newTools.push(name);
          }
        });
        return { ...prev, tools: newTools };
      } else {
        // Remove all tools from group
        return { ...prev, tools: prev.tools.filter(t => !toolNames.includes(t)) };
      }
    });
  };

  // Select all / deselect all
  const allSelected = allOperationalToolNames.length > 0 &&
    allOperationalToolNames.every(name => formData.tools.includes(name));

  const toggleSelectAll = () => {
    if (allSelected) {
      setFormData(prev => ({ ...prev, tools: [] }));
    } else {
      setFormData(prev => ({ ...prev, tools: [...allOperationalToolNames] }));
    }
  };

  const handleSave = async () => {
    // Validate required fields
    if (!formData.name.trim()) {
      alert('Please enter an agent name');
      return;
    }
    if (!formData.connector) {
      alert('Please select a connector');
      return;
    }
    if (!formData.model) {
      alert('Please select a model');
      return;
    }

    setSaving(true);
    try {
      let result;
      if (isEditMode && agentId) {
        // Update existing agent
        result = await window.hosea.agentConfig.update(agentId, formData);
      } else {
        // Create new agent
        result = await window.hosea.agentConfig.create(formData);
      }

      if (result.success) {
        navigate('agents');
      } else {
        alert(`Failed to save agent: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
      alert(`Failed to save agent: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agentId) return;

    if (confirm('Are you sure you want to delete this agent?')) {
      try {
        const result = await window.hosea.agentConfig.delete(agentId);
        if (result.success) {
          navigate('agents');
        } else {
          alert(`Failed to delete agent: ${result.error}`);
        }
      } catch (error) {
        console.error('Failed to delete agent:', error);
        alert(`Failed to delete agent: ${error}`);
      }
    }
  };

  const toggleTool = (toolName: string) => {
    setFormData((prev) => ({
      ...prev,
      tools: prev.tools.includes(toolName)
        ? prev.tools.filter((t) => t !== toolName)
        : [...prev.tools, toolName],
    }));
  };

  // MCP Server handlers
  const isMCPServerSelected = (serverName: string): boolean => {
    return formData.mcpServers.some((s) => s.serverName === serverName);
  };

  const getMCPServerRef = (serverName: string): AgentMCPServerRef | undefined => {
    return formData.mcpServers.find((s) => s.serverName === serverName);
  };

  const toggleMCPServer = (serverName: string) => {
    setFormData((prev) => {
      const isSelected = prev.mcpServers.some((s) => s.serverName === serverName);
      if (isSelected) {
        return {
          ...prev,
          mcpServers: prev.mcpServers.filter((s) => s.serverName !== serverName),
        };
      } else {
        return {
          ...prev,
          mcpServers: [...prev.mcpServers, { serverName }],
        };
      }
    });
  };

  const loadMCPServerTools = async (serverName: string) => {
    if (mcpServerTools[serverName]) return; // Already loaded

    setLoadingMCPTools(serverName);
    try {
      const tools = await window.hosea.mcpServer.getTools(serverName);
      setMCPServerTools((prev) => ({
        ...prev,
        [serverName]: tools,
      }));
    } catch (error) {
      console.error(`Failed to load tools for ${serverName}:`, error);
    } finally {
      setLoadingMCPTools(null);
    }
  };

  const toggleMCPServerTool = (serverName: string, toolName: string) => {
    setFormData((prev) => {
      const serverRef = prev.mcpServers.find((s) => s.serverName === serverName);
      if (!serverRef) return prev;

      const selectedTools = serverRef.selectedTools || [];
      const isSelected = selectedTools.includes(toolName);

      const newSelectedTools = isSelected
        ? selectedTools.filter((t) => t !== toolName)
        : [...selectedTools, toolName];

      // If all tools are selected or none selected, remove the selectedTools array (use all)
      const serverTools = mcpServerTools[serverName] || [];
      const useAll = newSelectedTools.length === 0 || newSelectedTools.length === serverTools.length;

      return {
        ...prev,
        mcpServers: prev.mcpServers.map((s) =>
          s.serverName === serverName
            ? { ...s, selectedTools: useAll ? undefined : newSelectedTools }
            : s
        ),
      };
    });
  };

  const isMCPToolSelected = (serverName: string, toolName: string): boolean => {
    const serverRef = formData.mcpServers.find((s) => s.serverName === serverName);
    if (!serverRef) return false;
    // If no selectedTools specified, all tools are selected
    if (!serverRef.selectedTools) return true;
    return serverRef.selectedTools.includes(toolName);
  };

  const selectAllMCPServerTools = (serverName: string) => {
    setFormData((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.map((s) =>
        s.serverName === serverName ? { ...s, selectedTools: undefined } : s
      ),
    }));
  };

  const deselectAllMCPServerTools = (serverName: string) => {
    setFormData((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.map((s) =>
        s.serverName === serverName ? { ...s, selectedTools: [] } : s
      ),
    }));
  };

  const InfoTooltip = ({
    id,
    content,
  }: {
    id: string;
    content: string;
  }): React.ReactElement => (
    <OverlayTrigger
      placement="right"
      overlay={<Tooltip id={id}>{content}</Tooltip>}
    >
      <HelpCircle size={14} className="ms-1 text-muted" style={{ cursor: 'help' }} />
    </OverlayTrigger>
  );

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Loading..." subtitle="Loading agent configuration" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={isEditMode ? 'Edit Agent' : 'Create Agent'}
        subtitle={
          isEditMode ? 'Modify your agent configuration' : 'Set up a new AI agent'
        }
        backButton={
          <Button variant="link" className="p-0 me-2" onClick={goBack}>
            <ArrowLeft size={20} />
          </Button>
        }
      >
        {isEditMode && (
          <Button
            variant="outline-danger"
            size="sm"
            className="me-2"
            onClick={handleDelete}
          >
            <Trash2 size={14} className="me-1" />
            Delete
          </Button>
        )}
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          <Save size={16} className="me-2" />
          {saving ? 'Saving...' : 'Save Agent'}
        </Button>
      </PageHeader>

      <div className="page__content">
        {/* Tabs */}
        <Nav
          variant="tabs"
          className="mb-4"
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k || 'general')}
        >
          <Nav.Item>
            <Nav.Link eventKey="general">General</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="tools">Tools</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="mcp">
              MCP Servers
              {formData.mcpServers.length > 0 && (
                <Badge bg="primary" className="ms-2">{formData.mcpServers.length}</Badge>
              )}
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="context">Context</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="voice">Voice</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="permissions">
              Permissions
              {formData.permissionsEnabled && (
                <Badge bg="success" className="ms-2">ON</Badge>
              )}
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="orchestrator">
              Orchestrator
              {formData.isOrchestrator && (
                <Badge bg="success" className="ms-2">ON</Badge>
              )}
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {/* General Tab */}
        {activeTab === 'general' && (
          <Card>
            <Card.Body>
              <Row className="g-3">
                <Col md={6}>
                  <Form.Group>
                    <Form.Label>Agent Name</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="My Assistant"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                    />
                  </Form.Group>
                </Col>

                {/* Agent type is always 'basic' in NextGen - removed selection UI */}

                <Col md={6}>
                  <Form.Group>
                    <Form.Label>Connector (LLM Provider)</Form.Label>
                    <Form.Select
                      value={formData.connector}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          connector: e.target.value,
                          model: '', // Reset model when connector changes
                        })
                      }
                    >
                      <option value="">Select connector...</option>
                      {connectors.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.vendor}){c.source === 'backend' ? ' [backend]' : c.source === 'local' ? ' [Local]' : ''}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>

                <Col md={6}>
                  <Form.Group>
                    <Form.Label>
                      Model
                      {loadingLiveModels && (
                        <span className="text-muted ms-2" style={{ fontSize: '0.8rem' }}>
                          (fetching live models...)
                        </span>
                      )}
                    </Form.Label>
                    <Form.Select
                      value={formData.model}
                      onChange={(e) =>
                        setFormData({ ...formData, model: e.target.value })
                      }
                      disabled={!formData.connector}
                    >
                      <option value="">
                        {formData.connector
                          ? 'Select model...'
                          : 'Select a connector first'}
                      </option>
                      {getModelsForConnector().length > 0 && (
                        <optgroup label="Known Models">
                          {getModelsForConnector().map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({(m.contextWindow / 1000).toFixed(0)}K context)
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {extraLiveModels.length > 0 && (
                        <optgroup label="Available from Provider">
                          {extraLiveModels.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </Form.Select>
                    {formData.model && (
                      <Form.Text className="text-muted">
                        {
                          getModelsForConnector().find((m) => m.id === formData.model)
                            ?.description
                        }
                      </Form.Text>
                    )}
                  </Form.Group>
                </Col>

                <Col md={3}>
                  <Form.Group>
                    <Form.Label>
                      Temperature: {chatGPTStatus?.usePlan && connectors.find(c => c.name === formData.connector)?.vendor === 'openai' ? 'Provider managed by ChatGPT plan' : formData.temperature.toFixed(1)}
                    </Form.Label>
                    <Form.Range
                      min={0}
                      max={2}
                      step={0.1}
                      value={formData.temperature}
                      disabled={!!chatGPTStatus?.usePlan && connectors.find(c => c.name === formData.connector)?.vendor === 'openai'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          temperature: parseFloat(e.target.value),
                        })
                      }
                    />
                    <Form.Text className="text-muted">
                      Lower = more focused, Higher = more creative
                    </Form.Text>
                  </Form.Group>
                </Col>

                <Col md={3}>
                  <Form.Group>
                    <Form.Label>
                      Max Iterations
                      <InfoTooltip
                        id="max-iterations-info"
                        content="Maximum tool-calling iterations per run. Agent will summarize and ask to continue if limit is reached."
                      />
                    </Form.Label>
                    <Form.Control
                      type="number"
                      min={5}
                      max={200}
                      value={formData.maxIterations}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxIterations: parseInt(e.target.value) || 50,
                        })
                      }
                    />
                    <Form.Text className="text-muted">
                      Default: 50 iterations
                    </Form.Text>
                  </Form.Group>
                </Col>

                <Col xs={12}>
                  <Form.Group>
                    <Form.Label>System Instructions</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      placeholder="You are a helpful assistant..."
                      value={formData.instructions}
                      onChange={(e) =>
                        setFormData({ ...formData, instructions: e.target.value })
                      }
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <div>
            {/* Header with Select All */}
            <div className="d-flex justify-content-between align-items-center mb-3">
              <p className="text-muted mb-0">
                Select which tools this agent can use.
              </p>
              <Form.Check
                type="checkbox"
                id="select-all-tools"
                label={<span className="fw-medium">Select All</span>}
                checked={allSelected}
                onChange={toggleSelectAll}
                className="user-select-none"
              />
            </div>

            {/* Built-in Tools by Category */}
            {Object.entries(builtInToolsByCategory)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, tools]) => {
                const sectionId = `builtin-${category}`;
                const isExpanded = expandedSections[sectionId] !== false; // Default expanded
                const toolNames = tools.map(t => t.name);
                const isFullySelected = isGroupFullySelected(toolNames);
                const isPartiallySelected = isGroupPartiallySelected(toolNames);
                const selectedCount = tools.filter(t => formData.tools.includes(t.name)).length;

                return (
                  <Card key={sectionId} className="mb-2">
                    <Card.Header
                      className="py-2 d-flex align-items-center"
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleSection(sectionId)}
                    >
                      <div className="d-flex align-items-center flex-grow-1">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <Form.Check
                          type="checkbox"
                          checked={isFullySelected}
                          ref={(el: HTMLInputElement | null) => {
                            if (el) el.indeterminate = isPartiallySelected;
                          }}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleGroup(toolNames, !isFullySelected);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="ms-2 me-2"
                        />
                        <strong>{CATEGORY_LABELS[category] || category}</strong>
                        <Badge bg="secondary" className="ms-2">
                          {selectedCount}/{tools.length}
                        </Badge>
                      </div>
                    </Card.Header>
                    <Collapse in={isExpanded}>
                      <div>
                        <Card.Body className="py-2">
                          <Row className="g-2">
                            {tools.map((tool) => (
                              <Col key={tool.name} md={6} lg={4}>
                                <Card
                                  className={`h-100 ${
                                    formData.tools.includes(tool.name) ? 'border-primary' : ''
                                  }`}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => toggleTool(tool.name)}
                                >
                                  <Card.Body className="py-2 px-3">
                                    <div className="d-flex align-items-start">
                                      <Form.Check
                                        type="checkbox"
                                        checked={formData.tools.includes(tool.name)}
                                        onChange={() => toggleTool(tool.name)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="me-2"
                                      />
                                      <div className="flex-grow-1 overflow-hidden">
                                        <div className="d-flex align-items-center">
                                          <strong className="text-truncate">{tool.displayName}</strong>
                                          {tool.safeByDefault && (
                                            <Badge bg="success" className="ms-2" style={{ fontSize: '0.65rem' }}>
                                              Safe
                                            </Badge>
                                          )}
                                        </div>
                                        <small className="text-muted d-block text-truncate">
                                          {tool.description}
                                        </small>
                                      </div>
                                    </div>
                                  </Card.Body>
                                </Card>
                              </Col>
                            ))}
                          </Row>
                        </Card.Body>
                      </div>
                    </Collapse>
                  </Card>
                );
              })}

            {/* Connector Tools by Connector Name */}
            {Object.keys(connectorToolsByConnector).length > 0 && (
              <>
                <h6 className="mt-4 mb-2 text-muted">API Connector Tools</h6>
                {Object.entries(connectorToolsByConnector)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([connectorName, tools]) => {
                    const sectionId = `connector-${connectorName}`;
                    const isExpanded = expandedSections[sectionId] !== false;
                    const toolNames = tools.map(t => t.name);
                    const isFullySelected = isGroupFullySelected(toolNames);
                    const isPartiallySelected = isGroupPartiallySelected(toolNames);
                    const selectedCount = tools.filter(t => formData.tools.includes(t.name)).length;
                    // Get service type from first tool for display
                    const serviceType = tools[0]?.serviceType;

                    return (
                      <Card key={sectionId} className="mb-2">
                        <Card.Header
                          className="py-2 d-flex align-items-center"
                          style={{ cursor: 'pointer' }}
                          onClick={() => toggleSection(sectionId)}
                        >
                          <div className="d-flex align-items-center flex-grow-1">
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            <Form.Check
                              type="checkbox"
                              checked={isFullySelected}
                              ref={(el: HTMLInputElement | null) => {
                                if (el) el.indeterminate = isPartiallySelected;
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleGroup(toolNames, !isFullySelected);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="ms-2 me-2"
                            />
                            <strong>{connectorName}</strong>
                            {connectorSourceMap.get(connectorName) === 'backend' && (
                              <Badge bg="info" className="ms-2 d-inline-flex align-items-center gap-1" style={{ fontSize: '0.65rem' }}>
                                <Cloud size={10} />
                                backend
                              </Badge>
                            )}
                            {serviceType && (
                              <Badge bg="info" className="ms-2" style={{ fontSize: '0.65rem' }}>
                                {serviceType}
                              </Badge>
                            )}
                            <Badge bg="secondary" className="ms-2">
                              {selectedCount}/{tools.length}
                            </Badge>
                          </div>
                        </Card.Header>
                        <Collapse in={isExpanded}>
                          <div>
                            <Card.Body className="py-2">
                              <Row className="g-2">
                                {tools.map((tool) => (
                                  <Col key={tool.name} md={6} lg={4}>
                                    <Card
                                      className={`h-100 ${
                                        formData.tools.includes(tool.name) ? 'border-primary' : ''
                                      }`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => toggleTool(tool.name)}
                                    >
                                      <Card.Body className="py-2 px-3">
                                        <div className="d-flex align-items-start">
                                          <Form.Check
                                            type="checkbox"
                                            checked={formData.tools.includes(tool.name)}
                                            onChange={() => toggleTool(tool.name)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="me-2"
                                          />
                                          <div className="flex-grow-1 overflow-hidden">
                                            <div className="d-flex align-items-center">
                                              <strong className="text-truncate">{tool.displayName}</strong>
                                            </div>
                                            <small className="text-muted d-block text-truncate">
                                              {tool.description}
                                            </small>
                                          </div>
                                        </div>
                                      </Card.Body>
                                    </Card>
                                  </Col>
                                ))}
                              </Row>
                            </Card.Body>
                          </div>
                        </Collapse>
                      </Card>
                    );
                  })}
              </>
            )}

            {/* Unavailable Tools */}
            {nonOperationalTools.length > 0 && (
              <Card className="mt-4">
                <Card.Header
                  className="py-2 d-flex align-items-center bg-light"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleSection('unavailable')}
                >
                  <div className="d-flex align-items-center flex-grow-1">
                    {expandedSections['unavailable'] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span className="ms-2 text-muted">
                      <strong>Unavailable Tools</strong>
                    </span>
                    <Badge bg="secondary" className="ms-2">
                      {nonOperationalTools.length}
                    </Badge>
                  </div>
                </Card.Header>
                <Collapse in={expandedSections['unavailable']}>
                  <div>
                    <Card.Body className="py-2">
                      <Alert variant="warning" className="py-2 mb-3">
                        <small>
                          <AlertCircle size={14} className="me-1" />
                          These tools require connectors to be configured in{' '}
                          <strong>Connectors &gt; Universal Connectors</strong>
                        </small>
                      </Alert>
                      <Row className="g-2">
                        {nonOperationalTools.map((tool) => (
                          <Col key={tool.name} md={6} lg={4}>
                            <Card className="h-100 bg-light" style={{ opacity: 0.6 }}>
                              <Card.Body className="py-2 px-3">
                                <div className="d-flex align-items-start">
                                  <Form.Check type="checkbox" disabled className="me-2" />
                                  <div className="flex-grow-1 overflow-hidden">
                                    <div className="d-flex align-items-center">
                                      <strong className="text-truncate text-muted">
                                        {tool.displayName}
                                      </strong>
                                    </div>
                                    <small className="text-muted d-block text-truncate">
                                      Requires: {tool.connectorServiceTypes?.join(', ') || 'API connector'}
                                    </small>
                                  </div>
                                </div>
                              </Card.Body>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    </Card.Body>
                  </div>
                </Collapse>
              </Card>
            )}
          </div>
        )}

        {/* MCP Servers Tab */}
        {activeTab === 'mcp' && (
          <div>
            <p className="text-muted mb-3">
              Add MCP (Model Context Protocol) servers to extend your agent with external tools.
              You can attach entire servers or select specific tools.
            </p>

            {mcpServers.length === 0 ? (
              <Card className="text-center py-5">
                <Card.Body>
                  <Server size={48} className="text-muted mb-3" />
                  <h5>No MCP Servers Configured</h5>
                  <p className="text-muted mb-3">
                    Configure MCP servers in the Tools &gt; MCP Servers section to use them with your agents.
                  </p>
                  <Button
                    variant="outline-primary"
                    onClick={() => navigate('mcp-servers')}
                  >
                    <Server size={16} className="me-2" />
                    Go to MCP Servers
                  </Button>
                </Card.Body>
              </Card>
            ) : (
              <Row className="g-3">
                {mcpServers.map((server) => {
                  const isSelected = isMCPServerSelected(server.name);
                  const serverRef = getMCPServerRef(server.name);
                  const tools = mcpServerTools[server.name] || [];
                  const isExpanded = expandedSections[`mcp-${server.name}`];
                  const isLoadingTools = loadingMCPTools === server.name;

                  return (
                    <Col key={server.name} xs={12}>
                      <Card className={isSelected ? 'border-primary' : ''}>
                        <Card.Header className="d-flex align-items-center">
                          <Form.Check
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleMCPServer(server.name)}
                            className="me-3"
                          />
                          <div
                            className="d-flex align-items-center flex-grow-1"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              toggleSection(`mcp-${server.name}`);
                              if (!mcpServerTools[server.name]) {
                                loadMCPServerTools(server.name);
                              }
                            }}
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            <Server size={18} className="ms-2 me-2 text-primary" />
                            <div>
                              <strong>{server.displayName || server.name}</strong>
                              <Badge
                                bg={server.status === 'connected' ? 'success' : server.status === 'error' ? 'danger' : 'secondary'}
                                className="ms-2"
                              >
                                {server.status}
                              </Badge>
                              {server.toolCount !== undefined && (
                                <Badge bg="info" className="ms-1">
                                  {server.toolCount} tools
                                </Badge>
                              )}
                              {isSelected && serverRef?.selectedTools && (
                                <Badge bg="primary" className="ms-1">
                                  {serverRef.selectedTools.length} selected
                                </Badge>
                              )}
                            </div>
                          </div>
                        </Card.Header>

                        <Collapse in={isExpanded}>
                          <div>
                            <Card.Body>
                              {server.description && (
                                <p className="text-muted small mb-3">{server.description}</p>
                              )}

                              {server.status !== 'connected' ? (
                                <Alert variant="warning" className="mb-0">
                                  <AlertCircle size={16} className="me-2" />
                                  Server is not connected. Connect it in the MCP Servers page to see available tools.
                                </Alert>
                              ) : isLoadingTools ? (
                                <div className="text-center py-3">
                                  <RefreshCw size={20} className="animate-spin text-primary" />
                                  <p className="text-muted small mt-2 mb-0">Loading tools...</p>
                                </div>
                              ) : tools.length === 0 ? (
                                <Alert variant="info" className="mb-0">
                                  No tools available from this server.
                                </Alert>
                              ) : (
                                <>
                                  <div className="d-flex justify-content-between align-items-center mb-2">
                                    <small className="text-muted">
                                      <Wrench size={14} className="me-1" />
                                      {tools.length} tool{tools.length !== 1 ? 's' : ''} available
                                    </small>
                                    {isSelected && (
                                      <div>
                                        <Button
                                          variant="link"
                                          size="sm"
                                          className="p-0 me-3"
                                          onClick={() => selectAllMCPServerTools(server.name)}
                                        >
                                          Select All
                                        </Button>
                                        <Button
                                          variant="link"
                                          size="sm"
                                          className="p-0"
                                          onClick={() => deselectAllMCPServerTools(server.name)}
                                        >
                                          Deselect All
                                        </Button>
                                      </div>
                                    )}
                                  </div>

                                  <Row className="g-2">
                                    {tools.map((tool) => {
                                      const isToolSelected = isSelected && isMCPToolSelected(server.name, tool.name);
                                      return (
                                        <Col key={tool.name} md={6} lg={4}>
                                          <Card
                                            className={`h-100 ${isToolSelected ? 'border-primary' : ''}`}
                                            style={{
                                              cursor: isSelected ? 'pointer' : 'default',
                                              opacity: isSelected ? 1 : 0.6,
                                            }}
                                            onClick={() => {
                                              if (isSelected) {
                                                toggleMCPServerTool(server.name, tool.name);
                                              }
                                            }}
                                          >
                                            <Card.Body className="py-2 px-3">
                                              <div className="d-flex align-items-start">
                                                <Form.Check
                                                  type="checkbox"
                                                  checked={isToolSelected}
                                                  disabled={!isSelected}
                                                  onChange={() => {
                                                    if (isSelected) {
                                                      toggleMCPServerTool(server.name, tool.name);
                                                    }
                                                  }}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="me-2"
                                                />
                                                <div className="flex-grow-1 overflow-hidden">
                                                  <div className="d-flex align-items-center">
                                                    <code className="text-truncate small">{tool.name}</code>
                                                  </div>
                                                  {tool.description && (
                                                    <small className="text-muted d-block text-truncate">
                                                      {tool.description}
                                                    </small>
                                                  )}
                                                </div>
                                              </div>
                                            </Card.Body>
                                          </Card>
                                        </Col>
                                      );
                                    })}
                                  </Row>
                                </>
                              )}
                            </Card.Body>
                          </div>
                        </Collapse>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            )}
          </div>
        )}

        {/* Context Tab */}
        {activeTab === 'context' && (
          <>
            {/* Context Strategy */}
            <Card className="mb-4">
              <Card.Header>
                <strong>Context Strategy</strong>
                <InfoTooltip
                  id="context-strategy-info"
                  content="Determines when and how the context is compacted to stay within token limits"
                />
              </Card.Header>
              <Card.Body>
                <Row className="g-3">
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Strategy</Form.Label>
                      <Form.Select
                        value={formData.contextStrategy}
                        onChange={(e) =>
                          setFormData({ ...formData, contextStrategy: e.target.value })
                        }
                      >
                        {strategies.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.displayName} ({Math.round(s.threshold * 100)}%)
                          </option>
                        ))}
                      </Form.Select>
                      <Form.Text className="text-muted">
                        {
                          strategies.find(
                            (s) => s.name === formData.contextStrategy
                          )?.description
                        }
                      </Form.Text>
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>
                        Max Context Tokens
                        <InfoTooltip
                          id="max-context-info"
                          content="Automatically set from the selected model's context window"
                        />
                      </Form.Label>
                      <Form.Control
                        type="number"
                        value={formData.maxContextTokens}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxContextTokens: parseInt(e.target.value) || 0,
                          })
                        }
                        disabled
                      />
                      <Form.Text className="text-muted">From model</Form.Text>
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>
                        Response Reserve
                        <InfoTooltip
                          id="response-reserve-info"
                          content="Tokens reserved for the model's response"
                        />
                      </Form.Label>
                      <Form.Control
                        type="number"
                        min={1000}
                        max={32000}
                        value={formData.responseReserve}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            responseReserve: parseInt(e.target.value) || 4096,
                          })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>
              </Card.Body>
            </Card>

            {/* Features Toggles */}
            <Card className="mb-4">
              <Card.Header>
                <strong>Context Features</strong>
              </Card.Header>
              <Card.Body>
                <Row className="g-3">
                  <Col md={4} lg={2}>
                    <Form.Check
                      type="switch"
                      id="memory-enabled"
                      label="Working Memory"
                      checked={formData.workingMemoryEnabled}
                      onChange={(e) =>
                        setFormData({ ...formData, workingMemoryEnabled: e.target.checked })
                      }
                    />
                    <Form.Text className="text-muted d-block">
                      External storage for large data
                    </Form.Text>
                  </Col>

                  <Col md={4} lg={2}>
                    <Form.Check
                      type="switch"
                      id="in-context-memory-enabled"
                      label="In-Context Memory"
                      checked={formData.inContextMemoryEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          inContextMemoryEnabled: e.target.checked,
                        })
                      }
                    />
                    <Form.Text className="text-muted d-block">
                      Key-value state in context
                    </Form.Text>
                  </Col>

                  <Col md={4} lg={2}>
                    <Form.Check
                      type="switch"
                      id="dynamic-ui-enabled"
                      label="Dynamic UI"
                      checked={formData.dynamicUIEnabled}
                      onChange={(e) => {
                        const updates: Partial<AgentFormData> = { dynamicUIEnabled: e.target.checked };
                        // Auto-enable In-Context Memory when Dynamic UI is turned on
                        if (e.target.checked && !formData.inContextMemoryEnabled) {
                          updates.inContextMemoryEnabled = true;
                        }
                        setFormData({ ...formData, ...updates });
                      }}
                    />
                    <Form.Text className="text-muted d-block">
                      Side panel cards for dashboards &amp; results
                    </Form.Text>
                  </Col>

                  <Col md={4} lg={3}>
                    <Form.Check
                      type="switch"
                      id="persistent-instructions-enabled"
                      label="Persistent Instructions"
                      checked={formData.persistentInstructionsEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          persistentInstructionsEnabled: e.target.checked,
                        })
                      }
                    />
                    <Form.Text className="text-muted d-block">
                      Disk-persisted custom rules
                    </Form.Text>
                  </Col>

                  <Col md={4} lg={2}>
                    <Form.Check
                      type="switch"
                      id="user-info-enabled"
                      label="User Info"
                      checked={formData.userInfoEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          userInfoEnabled: e.target.checked,
                        })
                      }
                    />
                    <Form.Text className="text-muted d-block">
                      Persistent user preferences
                    </Form.Text>
                  </Col>

                  <Col md={4} lg={2}>
                    <Form.Check
                      type="switch"
                      id="tool-catalog-enabled"
                      label="Tool Catalog"
                      checked={formData.toolCatalogEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          toolCatalogEnabled: e.target.checked,
                        })
                      }
                    />
                    <Form.Text className="text-muted d-block">
                      Dynamic tool loading by category
                    </Form.Text>
                  </Col>

                  {/* Tool Permissions configured in Permissions tab */}
                </Row>
              </Card.Body>
            </Card>

            {/* Working Memory Settings */}
            {formData.workingMemoryEnabled && (
              <Card className="mb-4">
                <Card.Header>
                  <strong>Working Memory Settings</strong>
                  <InfoTooltip
                    id="working-memory-info"
                    content="External memory storage for large data that can be retrieved via tools"
                  />
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>
                          Max Size (MB)
                          <InfoTooltip
                            id="max-size-info"
                            content="Maximum total memory size in megabytes"
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={1}
                          max={100}
                          value={Math.round(formData.maxMemorySizeBytes / (1024 * 1024))}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              maxMemorySizeBytes:
                                (parseInt(e.target.value) || 25) * 1024 * 1024,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>

                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>
                          Max Index Entries
                          <InfoTooltip
                            id="max-index-entries-info"
                            content="Maximum entries shown in memory index. Excess low-priority entries are auto-evicted to prevent context bloat."
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={10}
                          max={100}
                          value={formData.maxMemoryIndexEntries}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              maxMemoryIndexEntries: parseInt(e.target.value) || 30,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>

                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>
                          Soft Limit (%)
                          <InfoTooltip
                            id="soft-limit-info"
                            content="Percentage of max size that triggers automatic cleanup"
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={50}
                          max={95}
                          value={formData.memorySoftLimitPercent}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              memorySoftLimitPercent: parseInt(e.target.value) || 80,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>

                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>
                          Context Allocation (%)
                          <InfoTooltip
                            id="context-allocation-info"
                            content="Percentage of context reserved for memory index"
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={5}
                          max={30}
                          value={formData.contextAllocationPercent}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              contextAllocationPercent: parseInt(e.target.value) || 10,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            )}

            {/* In-Context Memory Settings */}
            {formData.inContextMemoryEnabled && (
              <Card className="mb-4">
                <Card.Header>
                  <strong>In-Context Memory Settings</strong>
                  <InfoTooltip
                    id="in-context-memory-settings-info"
                    content="Key-value storage that appears directly in the context (LLM sees full values)"
                  />
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>
                          Max Entries
                          <InfoTooltip
                            id="max-entries-info"
                            content="Maximum number of key-value pairs to store"
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={5}
                          max={50}
                          value={formData.maxInContextEntries}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              maxInContextEntries: parseInt(e.target.value) || 20,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>

                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>
                          Max Tokens
                          <InfoTooltip
                            id="max-tokens-info"
                            content="Maximum tokens used by in-context memory"
                          />
                        </Form.Label>
                        <Form.Control
                          type="number"
                          min={1000}
                          max={16000}
                          step={500}
                          value={formData.maxInContextTokens}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              maxInContextTokens: parseInt(e.target.value) || 4000,
                            })
                          }
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            )}

            {/* Tool Catalog Settings */}
            {formData.toolCatalogEnabled && (
              <Card className="mb-4">
                <Card.Header>
                  <strong>Tool Catalog Settings</strong>
                  <InfoTooltip
                    id="tool-catalog-info"
                    content="Configure which tool categories are always available (pinned) and which are visible to the agent"
                  />
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>
                          Pinned Categories
                          <InfoTooltip
                            id="pinned-info"
                            content="Always loaded — the LLM cannot unload these"
                          />
                        </Form.Label>
                        <div className="border rounded p-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {ALL_TOOL_CATEGORIES.map((cat) => (
                            <Form.Check
                              key={cat}
                              type="checkbox"
                              id={`pinned-${cat}`}
                              label={CATEGORY_LABELS[cat] || cat}
                              checked={formData.pinnedCategories.includes(cat)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...formData.pinnedCategories, cat]
                                  : formData.pinnedCategories.filter((c) => c !== cat);
                                setFormData({ ...formData, pinnedCategories: next });
                              }}
                            />
                          ))}
                        </div>
                        <Form.Text className="text-muted">
                          Categories the agent always has access to
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>
                          Category Scope
                          <InfoTooltip
                            id="scope-info"
                            content="Restrict which categories the agent can discover. Empty = all categories visible."
                          />
                        </Form.Label>
                        <div className="border rounded p-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {ALL_TOOL_CATEGORIES.map((cat) => (
                            <Form.Check
                              key={cat}
                              type="checkbox"
                              id={`scope-${cat}`}
                              label={CATEGORY_LABELS[cat] || cat}
                              checked={formData.toolCategoryScope.length === 0 || formData.toolCategoryScope.includes(cat)}
                              onChange={(e) => {
                                let next: string[];
                                if (formData.toolCategoryScope.length === 0) {
                                  next = ALL_TOOL_CATEGORIES.filter((c) => c !== cat);
                                } else {
                                  next = e.target.checked
                                    ? [...formData.toolCategoryScope, cat]
                                    : formData.toolCategoryScope.filter((c) => c !== cat);
                                  if (next.length === ALL_TOOL_CATEGORIES.length) next = [];
                                }
                                setFormData({ ...formData, toolCategoryScope: next });
                              }}
                            />
                          ))}
                        </div>
                        <Form.Text className="text-muted">
                          Empty = all categories visible
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            )}

          </>
        )}

        {/* Voice Tab */}
        {activeTab === 'voice' && (
          <>
            <Card className="mb-4">
              <Card.Header>
                <strong>Voice / Text-to-Speech</strong>
                <InfoTooltip
                  id="voice-info"
                  content="Enable voice pseudo-streaming: agent responses will be spoken aloud sentence by sentence using TTS"
                />
              </Card.Header>
              <Card.Body>
                <Form.Check
                  type="switch"
                  id="voice-enabled"
                  label="Enable Voice"
                  checked={formData.voiceEnabled}
                  onChange={(e) =>
                    setFormData({ ...formData, voiceEnabled: e.target.checked })
                  }
                  className="mb-3"
                />
                <Form.Text className="text-muted d-block mb-3">
                  When enabled, you can toggle voiceover on the chat page to hear agent responses spoken aloud.
                </Form.Text>

                {formData.voiceEnabled && (
                  <>
                    {/* TTS Model */}
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>TTS Model</Form.Label>
                          <Form.Select
                            value={formData.voiceModel && formData.voiceConnector ? `${formData.voiceModel}::${formData.voiceConnector}` : formData.voiceModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              const sepIdx = val.indexOf('::');
                              const model = sepIdx >= 0 ? val.slice(0, sepIdx) : val;
                              const connector = sepIdx >= 0 ? val.slice(sepIdx + 2) : '';
                              setFormData({
                                ...formData,
                                voiceModel: model,
                                voiceConnector: connector || formData.voiceConnector,
                                voiceVoice: '', // Reset voice when model changes
                              });
                            }}
                          >
                            <option value="">Select a TTS model...</option>
                            {ttsModels.map((m) => (
                              <option key={`${m.name}::${m.connector}`} value={`${m.name}::${m.connector}`}>
                                {m.displayName} ({m.connector})
                              </option>
                            ))}
                          </Form.Select>
                          {ttsModels.length === 0 && (
                            <Form.Text className="text-warning">
                              No TTS models available. Configure a connector that supports TTS (e.g. OpenAI, Google).
                            </Form.Text>
                          )}
                        </Form.Group>
                      </Col>
                    </Row>

                    {/* Voice selector */}
                    {formData.voiceModel && ttsCapabilities?.voices && (
                      <Row className="g-3 mb-3">
                        <Col>
                          <Form.Label>Voice</Form.Label>
                          <div className="border rounded p-2" style={{ maxHeight: 240, overflowY: 'auto' }}>
                            <div className="d-flex flex-wrap gap-2">
                              {ttsCapabilities.voices.map((voice) => (
                                <Button
                                  key={voice.id}
                                  size="sm"
                                  variant={formData.voiceVoice === voice.id ? 'primary' : 'outline-secondary'}
                                  onClick={() => setFormData({ ...formData, voiceVoice: voice.id })}
                                >
                                  {voice.name}
                                  {voice.isDefault && ' *'}
                                </Button>
                              ))}
                            </div>
                          </div>
                          {ttsCapabilities.voices.length === 0 && (
                            <Form.Text className="text-muted">No voices available for this model</Form.Text>
                          )}
                        </Col>
                      </Row>
                    )}

                    {/* Format and Speed */}
                    <Row className="g-3">
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>Audio Format</Form.Label>
                          <Form.Select
                            value={formData.voiceFormat}
                            onChange={(e) =>
                              setFormData({ ...formData, voiceFormat: e.target.value })
                            }
                          >
                            {(ttsCapabilities?.formats || ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).map((fmt) => (
                              <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>
                            ))}
                          </Form.Select>
                          {formData.voiceFormat === 'pcm' && (
                            <Form.Text className="text-info">
                              PCM format enables low-latency streaming playback.
                            </Form.Text>
                          )}
                        </Form.Group>
                      </Col>

                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>
                            Speed: {formData.voiceSpeed.toFixed(2)}x
                          </Form.Label>
                          <Form.Range
                            min={ttsCapabilities?.speed?.min ?? 0.25}
                            max={ttsCapabilities?.speed?.max ?? 4.0}
                            step={0.25}
                            value={formData.voiceSpeed}
                            onChange={(e) =>
                              setFormData({ ...formData, voiceSpeed: parseFloat(e.target.value) })
                            }
                            disabled={ttsCapabilities?.speed?.supported === false}
                          />
                          <Form.Text className="text-muted">
                            {ttsCapabilities?.speed?.supported === false
                              ? 'Speed control not supported for this model'
                              : `${ttsCapabilities?.speed?.min ?? 0.25}x - ${ttsCapabilities?.speed?.max ?? 4.0}x`}
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                  </>
                )}
              </Card.Body>
            </Card>

            {/* Voice Bridge (Phone Calling) */}
            <Card className="mb-4">
              <Card.Header>
                <strong>Voice Bridge (Phone Calling)</strong>
                <InfoTooltip
                  id="voice-bridge-info"
                  content="Connect this agent to phone calls via Twilio. Requires a Twilio connector and a public URL (e.g. ngrok)."
                />
              </Card.Header>
              <Card.Body>
                <Form.Check
                  type="switch"
                  id="voice-bridge-enabled"
                  label="Enable Voice Bridge"
                  checked={formData.voiceBridgeEnabled}
                  onChange={(e) =>
                    setFormData({ ...formData, voiceBridgeEnabled: e.target.checked })
                  }
                  className="mb-3"
                />
                <Form.Text className="text-muted d-block mb-3">
                  When enabled, this agent can receive and handle phone calls via Twilio Media Streams.
                  Start/stop the bridge from the chat page.
                </Form.Text>

                {formData.voiceBridgeEnabled && (
                  <>
                    {/* Twilio Connector Warning */}
                    {twilioConnectors.length === 0 && (
                      <Alert variant="warning" className="mb-3">
                        <AlertCircle size={16} className="me-2" />
                        No Twilio connector found. Please configure a Twilio connector on the{' '}
                        <Alert.Link onClick={() => navigate('tool-connectors')}>
                          Tool Connectors
                        </Alert.Link>{' '}
                        page first.
                      </Alert>
                    )}

                    {/* Twilio Connector */}
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Twilio Connector</Form.Label>
                          <Form.Select
                            value={formData.voiceBridgeTwilioConnector}
                            onChange={(e) =>
                              setFormData({ ...formData, voiceBridgeTwilioConnector: e.target.value })
                            }
                          >
                            <option value="">Select Twilio connector...</option>
                            {twilioConnectors.map((c) => (
                              <option key={c.name} value={c.name}>{c.displayName || c.name}</option>
                            ))}
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>

                    {/* Realtime model detection */}
                    {(() => {
                      const selectedModelInfo = getModelsForConnector().find(m => m.id === formData.model);
                      const isRealtime = selectedModelInfo?.realtime === true;
                      const realtimeVoices = selectedModelInfo?.voices;

                      if (isRealtime) {
                        return (
                          <>
                            <div className="alert alert-info mt-3 mb-3 py-2 small">
                              Realtime model — audio is handled natively. No separate STT/TTS needed.
                            </div>
                            <h6 className="mb-2">Realtime Voice</h6>
                            <Row className="g-3 mb-3">
                              <Col>
                                <div className="d-flex flex-wrap gap-2">
                                  {(realtimeVoices ?? []).map((v) => (
                                    <Button
                                      key={v.id}
                                      size="sm"
                                      variant={(formData.voiceBridgeTtsVoice || 'alloy') === v.id ? 'primary' : 'outline-secondary'}
                                      onClick={() => setFormData({ ...formData, voiceBridgeTtsVoice: v.id })}
                                    >
                                      {v.name}
                                      {v.isDefault && ' *'}
                                    </Button>
                                  ))}
                                </div>
                                <Form.Text className="text-muted">
                                  Voice used by the realtime model for speech output.
                                </Form.Text>
                              </Col>
                            </Row>
                          </>
                        );
                      }

                      return null;
                    })()}

                    {/* STT Configuration (text pipeline only) */}
                    {!getModelsForConnector().find(m => m.id === formData.model)?.realtime && (
                    <>
                    <h6 className="mt-3 mb-2">Speech-to-Text (STT)</h6>
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>STT Model</Form.Label>
                          <Form.Select
                            value={formData.voiceBridgeSttModel && formData.voiceBridgeSttConnector
                              ? `${formData.voiceBridgeSttModel}::${formData.voiceBridgeSttConnector}`
                              : formData.voiceBridgeSttModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              const sepIdx = val.indexOf('::');
                              const model = sepIdx >= 0 ? val.slice(0, sepIdx) : val;
                              const connector = sepIdx >= 0 ? val.slice(sepIdx + 2) : '';
                              setFormData({
                                ...formData,
                                voiceBridgeSttModel: model,
                                voiceBridgeSttConnector: connector || formData.voiceBridgeSttConnector,
                              });
                            }}
                          >
                            <option value="">Select STT model...</option>
                            {sttModels.map((m) => (
                              <option key={`${m.name}::${m.connector}`} value={`${m.name}::${m.connector}`}>
                                {m.displayName} ({m.connector})
                              </option>
                            ))}
                          </Form.Select>
                          {sttModels.length === 0 && (
                            <Form.Text className="text-warning">
                              No STT models available. Configure a connector that supports STT (e.g. OpenAI).
                            </Form.Text>
                          )}
                        </Form.Group>
                      </Col>
                    </Row>

                    {/* TTS Configuration */}
                    <h6 className="mt-3 mb-2">Text-to-Speech (TTS)</h6>
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>TTS Model</Form.Label>
                          <Form.Select
                            value={formData.voiceBridgeTtsModel && formData.voiceBridgeTtsConnector
                              ? `${formData.voiceBridgeTtsModel}::${formData.voiceBridgeTtsConnector}`
                              : formData.voiceBridgeTtsModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              const sepIdx = val.indexOf('::');
                              const model = sepIdx >= 0 ? val.slice(0, sepIdx) : val;
                              const connector = sepIdx >= 0 ? val.slice(sepIdx + 2) : '';
                              setFormData({
                                ...formData,
                                voiceBridgeTtsModel: model,
                                voiceBridgeTtsConnector: connector || formData.voiceBridgeTtsConnector,
                                voiceBridgeTtsVoice: '', // Reset voice when model changes
                              });
                            }}
                          >
                            <option value="">Select TTS model...</option>
                            {bridgeTTSModels.map((m) => (
                              <option key={`${m.name}::${m.connector}`} value={`${m.name}::${m.connector}`}>
                                {m.displayName} ({m.connector})
                              </option>
                            ))}
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>

                    {/* Voice selector for bridge TTS */}
                    {formData.voiceBridgeTtsModel && bridgeTTSCapabilities?.voices && (
                      <Row className="g-3 mb-3">
                        <Col>
                          <Form.Label>Voice</Form.Label>
                          <div className="border rounded p-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
                            <div className="d-flex flex-wrap gap-2">
                              {bridgeTTSCapabilities.voices.map((voice) => (
                                <Button
                                  key={voice.id}
                                  size="sm"
                                  variant={formData.voiceBridgeTtsVoice === voice.id ? 'primary' : 'outline-secondary'}
                                  onClick={() => setFormData({ ...formData, voiceBridgeTtsVoice: voice.id })}
                                >
                                  {voice.name}
                                  {voice.isDefault && ' *'}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </Col>
                      </Row>
                    )}
                    </>
                    )}

                    {/* Call Settings */}
                    <h6 className="mt-3 mb-2">Call Settings</h6>
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Inbound Greeting</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={2}
                            value={formData.voiceBridgeGreeting}
                            onChange={(e) => setFormData({ ...formData, voiceBridgeGreeting: e.target.value })}
                            placeholder="Hello! How can I help you today?"
                          />
                          <Form.Text className="text-muted">
                            First thing the agent says when receiving a call.
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Outbound Greeting</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={2}
                            value={formData.voiceBridgeGreetingOutbound}
                            onChange={(e) => setFormData({ ...formData, voiceBridgeGreetingOutbound: e.target.value })}
                            placeholder="Hi, this is your assistant…"
                          />
                          <Form.Text className="text-muted">
                            First thing the agent says when making an outbound call. Leave empty to let the callee speak first.
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>

                    <Row className="g-3 mb-3">
                      <Col md={3}>
                        <Form.Check
                          type="switch"
                          id="voice-bridge-interruptible"
                          label="Allow interruptions"
                          checked={formData.voiceBridgeInterruptible}
                          onChange={(e) => setFormData({ ...formData, voiceBridgeInterruptible: e.target.checked })}
                        />
                        <Form.Text className="text-muted">Caller can interrupt agent mid-speech</Form.Text>
                      </Col>
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>Max Concurrent Calls</Form.Label>
                          <Form.Control
                            type="number"
                            min={1}
                            max={50}
                            value={formData.voiceBridgeMaxConcurrent}
                            onChange={(e) => setFormData({ ...formData, voiceBridgeMaxConcurrent: parseInt(e.target.value) || 5 })}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>Max Call Duration (s)</Form.Label>
                          <Form.Control
                            type="number"
                            min={60}
                            max={7200}
                            value={formData.voiceBridgeMaxDuration}
                            onChange={(e) => setFormData({ ...formData, voiceBridgeMaxDuration: parseInt(e.target.value) || 1800 })}
                          />
                        </Form.Group>
                      </Col>
                    </Row>

                    {/* Server Settings */}
                    <h6 className="mt-3 mb-2">Server Settings</h6>
                    <Row className="g-3">
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>Port</Form.Label>
                          <Form.Control
                            type="number"
                            min={1024}
                            max={65535}
                            value={formData.voiceBridgePort}
                            onChange={(e) => setFormData({ ...formData, voiceBridgePort: parseInt(e.target.value) || 3000 })}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Public URL</Form.Label>
                          <Form.Control
                            type="text"
                            value={formData.voiceBridgePublicUrl}
                            onChange={(e) => setFormData({ ...formData, voiceBridgePublicUrl: e.target.value })}
                            placeholder="https://abc123.ngrok.io"
                          />
                          <Form.Text className="text-muted">
                            Twilio needs a public URL to reach this server. Use ngrok or similar tunneling service.
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mt-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Outbound Caller ID (From Number)</Form.Label>
                          <Form.Control
                            type="tel"
                            value={formData.voiceBridgeFromNumber}
                            onChange={(e) => setFormData({ ...formData, voiceBridgeFromNumber: e.target.value })}
                            placeholder="+15551234567"
                          />
                          <Form.Text className="text-muted">
                            Your Twilio phone number for outbound calls. Must be verified in your Twilio account.
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                  </>
                )}
              </Card.Body>
            </Card>
          </>
        )}
        {/* Permissions Tab */}
        {activeTab === 'permissions' && (
          <PermissionsTabContent
            formData={formData}
            setFormData={setFormData}
            agentId={agentId ?? null}
          />
        )}

        {/* Orchestrator Tab */}
        {activeTab === 'orchestrator' && (
          <>
            <Card className="mb-3">
              <Card.Body>
                <Form.Check
                  type="switch"
                  id="orchestrator-mode"
                  label={<><strong>Orchestrator Mode</strong> — This agent will coordinate a team of child agents</>}
                  checked={formData.isOrchestrator}
                  onChange={(e) => setFormData({ ...formData, isOrchestrator: e.target.checked })}
                />
              </Card.Body>
            </Card>

            {formData.isOrchestrator && (
              <>
                {/* Child Agent Types */}
                <Card className="mb-3">
                  <Card.Body>
                    <h6 className="mb-3">Child Agent Types</h6>
                    <p className="text-muted small mb-3">
                      Add existing agents as templates. The orchestrator will be able to spawn workers from these types.
                    </p>

                    {/* Current child agents */}
                    {formData.orchestratorChildAgents.map((child, idx) => {
                      const agentInfo = availableAgents.find(a => a.id === child.agentConfigId);
                      return (
                        <div key={`${child.agentConfigId}-${child.alias}`} className="d-flex align-items-center gap-2 mb-2 p-2 border rounded">
                          <Form.Control
                            size="sm"
                            style={{ width: '150px' }}
                            value={child.alias}
                            onChange={(e) => {
                              const updated = [...formData.orchestratorChildAgents];
                              updated[idx] = { ...updated[idx], alias: e.target.value };
                              setFormData({ ...formData, orchestratorChildAgents: updated });
                            }}
                            placeholder="Alias"
                          />
                          <span className="text-muted small flex-grow-1">
                            {agentInfo ? `${agentInfo.name} (${agentInfo.model}, ${agentInfo.tools.length} tools)` : child.agentConfigId}
                          </span>
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => {
                              const updated = formData.orchestratorChildAgents.filter((_, i) => i !== idx);
                              setFormData({ ...formData, orchestratorChildAgents: updated });
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      );
                    })}

                    {/* Add child agent selector */}
                    <div className="d-flex gap-2 mt-2">
                      <Form.Select
                        size="sm"
                        value={selectedChildAgentId}
                        onChange={(e) => setSelectedChildAgentId(e.target.value)}
                        className="flex-grow-1"
                      >
                        <option value="" disabled>Select an agent to add...</option>
                        {availableAgents
                          .filter(a => !isEditMode || a.id !== agentId)  // Don't allow adding self
                          .map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.model})</option>
                          ))
                        }
                      </Form.Select>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => {
                          if (!selectedChildAgentId) return;
                          const agentInfo = availableAgents.find(a => a.id === selectedChildAgentId);
                          if (!agentInfo) return;
                          // Generate a unique alias
                          const baseAlias = agentInfo.name.toLowerCase().replace(/\s+/g, '_');
                          let alias = baseAlias;
                          let counter = 1;
                          while (formData.orchestratorChildAgents.some(c => c.alias === alias)) {
                            alias = `${baseAlias}_${counter++}`;
                          }
                          setFormData({
                            ...formData,
                            orchestratorChildAgents: [
                              ...formData.orchestratorChildAgents,
                              { agentConfigId: selectedChildAgentId, alias },
                            ],
                          });
                          setSelectedChildAgentId('');
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </Card.Body>
                </Card>

                {/* Max Workers */}
                <Card>
                  <Card.Body>
                    <Form.Group>
                      <Form.Label>Max Workers: {formData.orchestratorMaxAgents}</Form.Label>
                      <Form.Range
                        min={1}
                        max={50}
                        step={1}
                        value={formData.orchestratorMaxAgents}
                        onChange={(e) => setFormData({ ...formData, orchestratorMaxAgents: parseInt(e.target.value) })}
                      />
                      <Form.Text className="text-muted">
                        Maximum number of worker agents the orchestrator can create simultaneously.
                      </Form.Text>
                    </Form.Group>
                  </Card.Body>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Permissions tab content — toggle + full CRUD rules editor
 */
function PermissionsTabContent({
  formData,
  setFormData,
  agentId,
}: {
  formData: AgentFormData;
  setFormData: (data: AgentFormData) => void;
  agentId: string | null;
}) {
  const [rules, setRules] = useState<IPermissionRuleInfo[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);

  // Find running instance for this agent
  const resolveInstance = useCallback(async (): Promise<string | null> => {
    if (!agentId) return null;
    const instances = await window.hosea.agent.listInstances();
    const instance = instances.find((i) => i.agentConfigId === agentId);
    return instance?.instanceId ?? null;
  }, [agentId]);

  // Load rules and available tools
  const loadData = useCallback(async () => {
    const instId = await resolveInstance();
    setInstanceId(instId);
    if (!instId) {
      setRules([]);
      setAvailableTools([]);
      return;
    }
    setLoadingRules(true);
    try {
      const [rulesResult, toolsResult] = await Promise.all([
        window.hosea.agent.getPermissionRules(instId),
        window.hosea.agent.getAvailableTools(instId),
      ]);
      if (rulesResult.success && rulesResult.rules) {
        setRules(rulesResult.rules as IPermissionRuleInfo[]);
      }
      if (toolsResult.success && toolsResult.tools) {
        setAvailableTools(toolsResult.tools);
      }
    } catch (error) {
      console.error('Error loading permission data:', error);
    } finally {
      setLoadingRules(false);
    }
  }, [resolveInstance]);

  useEffect(() => {
    if (formData.permissionsEnabled) {
      loadData();
    }
  }, [formData.permissionsEnabled, loadData]);

  const handleAddRule = useCallback(async (rule: INewPermissionRule) => {
    if (!instanceId) return;
    await window.hosea.agent.addPermissionRule(instanceId, rule as any);
    loadData();
  }, [instanceId, loadData]);

  const handleUpdateRule = useCallback(async (ruleId: string, updates: Partial<IPermissionRuleInfo>) => {
    if (!instanceId) return;
    await window.hosea.agent.updatePermissionRule(instanceId, ruleId, updates as any);
    loadData();
  }, [instanceId, loadData]);

  const handleToggleRule = useCallback(async (ruleId: string, enabled: boolean) => {
    if (!instanceId) return;
    await window.hosea.agent.togglePermissionRule(instanceId, ruleId, enabled);
    loadData();
  }, [instanceId, loadData]);

  const handleDeleteRule = useCallback(async (ruleId: string) => {
    if (!instanceId) return;
    await window.hosea.agent.deletePermissionRule(instanceId, ruleId);
    loadData();
  }, [instanceId, loadData]);

  const handleClearSession = useCallback(async () => {
    if (!instanceId) return;
    await window.hosea.agent.clearSessionApprovals(instanceId);
  }, [instanceId]);

  return (
    <>
      <Card className="mb-4">
        <Card.Header>
          <strong><Shield size={16} className="me-2" />Tool Permissions</strong>
        </Card.Header>
        <Card.Body>
          <Form.Check
            type="switch"
            id="permissions-enabled"
            label="Enable tool permission prompts"
            checked={formData.permissionsEnabled}
            onChange={(e) => setFormData({ ...formData, permissionsEnabled: e.target.checked })}
          />
          <Form.Text className="text-muted d-block mb-3">
            When enabled, the agent will ask for your permission before running tools like bash, file writes, and web requests.
            Read-only tools (file reads, searches) are always allowed. Your decisions can be saved as persistent rules.
          </Form.Text>

          {formData.permissionsEnabled && (
            <>
              <hr />
              {!agentId ? (
                <Alert variant="info" className="mb-0">
                  Save the agent first, then create an instance to manage permission rules.
                </Alert>
              ) : !instanceId && !loadingRules ? (
                <Alert variant="info" className="mb-0">
                  Start a chat with this agent to manage permission rules. Rules require a running agent instance.
                </Alert>
              ) : loadingRules ? (
                <div className="text-muted text-center py-3">Loading rules...</div>
              ) : (
                <PermissionRulesEditor
                  rules={rules}
                  availableTools={availableTools}
                  onAddRule={handleAddRule}
                  onUpdateRule={handleUpdateRule}
                  onToggleRule={handleToggleRule}
                  onDeleteRule={handleDeleteRule}
                  onClearSession={handleClearSession}
                />
              )}
            </>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
