/**
 * TTSTab - Text-to-Speech generation interface
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from 'react-bootstrap';
import { useNavigation } from '../../hooks/useNavigation';
import { ModelSelector, type ImageModelInfo } from './ModelSelector';
import { ConnectorSelector } from './ConnectorSelector';
import { VoiceSelector, type VoiceInfo } from './VoiceSelector';
import { AudioPlayer } from './AudioPlayer';

// Use ImageModelInfo for TTS models (similar structure)
type TTSModelInfo = ImageModelInfo;

interface TTSCapabilities {
  voices: VoiceInfo[];
  formats: string[];
  languages: string[];
  speed: {
    supported: boolean;
    min?: number;
    max?: number;
    default?: number;
  };
  features: {
    streaming: boolean;
    ssml: boolean;
    emotions: boolean;
    voiceCloning: boolean;
    wordTimestamps: boolean;
    instructionSteering?: boolean;
  };
  limits: {
    maxInputLength: number;
    maxRequestsPerMinute?: number;
  };
  vendorOptions?: Record<string, unknown>;
}

export function TTSTab(): React.ReactElement {
  const { navigate } = useNavigation();

  // State
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<TTSModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelCapabilities, setModelCapabilities] = useState<TTSCapabilities | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<string>('mp3');
  const [error, setError] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  // Load available models when connector changes
  useEffect(() => {
    loadAvailableModels();
  }, [selectedConnector]);

  // Load model capabilities when model changes
  useEffect(() => {
    if (selectedModel) {
      loadModelCapabilities(selectedModel);
    } else {
      setModelCapabilities(null);
      setSelectedVoice(null);
      setOptions({});
    }
  }, [selectedModel]);

  // Auto-select first voice when capabilities load
  useEffect(() => {
    if (modelCapabilities?.voices?.length && !selectedVoice) {
      // Try to find default voice, otherwise use first
      const defaultVoice = modelCapabilities.voices.find((v) => v.isDefault);
      setSelectedVoice(defaultVoice?.id ?? modelCapabilities.voices[0]?.id ?? null);
    }
  }, [modelCapabilities, selectedVoice]);

  // Calculate estimated cost when text/model changes
  useEffect(() => {
    if (selectedModel && text.length > 0) {
      calculateCost();
    } else {
      setEstimatedCost(null);
    }
  }, [selectedModel, text]);

  const loadAvailableModels = async () => {
    try {
      const models = await window.hosea.multimedia.getAvailableTTSModels(selectedConnector || undefined);
      // Map to ImageModelInfo format for ModelSelector
      const mappedModels: TTSModelInfo[] = models.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        vendor: m.vendor,
        description: m.description,
        maxPromptLength: m.maxInputLength,
        maxImagesPerRequest: 1,
      }));
      setAvailableModels(mappedModels);

      // Auto-select first model if available, or reset if current model not in list
      if (models.length > 0) {
        if (!selectedModel || !mappedModels.find((m) => m.name === selectedModel)) {
          setSelectedModel(models[0].name);
        }
      } else {
        setSelectedModel(null);
      }
    } catch (err) {
      console.error('Failed to load TTS models:', err);
    }
  };

  const loadModelCapabilities = async (modelName: string) => {
    try {
      const capabilities = await window.hosea.multimedia.getTTSModelCapabilities(modelName);
      if (!capabilities) {
        setModelCapabilities(null);
        return;
      }

      setModelCapabilities(capabilities as TTSCapabilities);

      // Reset voice selection when model changes
      setSelectedVoice(null);

      // Set default options
      const defaults: Record<string, unknown> = {
        format: capabilities.formats[0] || 'mp3',
      };

      // Add speed default if supported
      if (capabilities.speed.supported && capabilities.speed.default) {
        defaults.speed = capabilities.speed.default;
      }

      setOptions(defaults);
    } catch (err) {
      console.error('Failed to load model capabilities:', err);
      setModelCapabilities(null);
    }
  };

  const calculateCost = async () => {
    if (!selectedModel) return;

    try {
      const cost = await window.hosea.multimedia.calculateTTSCost(
        selectedModel,
        text.length
      );
      setEstimatedCost(cost);
    } catch {
      setEstimatedCost(null);
    }
  };

  const handleOptionChange = useCallback((key: string, value: unknown) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleGenerate = async () => {
    if (!selectedModel || !text.trim() || !selectedVoice) return;

    setIsGenerating(true);
    setError(null);
    setAudioData(null);

    try {
      const result = await window.hosea.multimedia.synthesizeSpeech({
        model: selectedModel,
        text: text.trim(),
        voice: selectedVoice,
        connector: selectedConnector || undefined,
        format: options.format as string,
        speed: options.speed as number | undefined,
        vendorOptions: options.instructions
          ? { instructions: options.instructions }
          : undefined,
      });

      if (result.success && result.data) {
        setAudioData(result.data.audio);
        setAudioFormat(result.data.format);
      } else {
        setError(result.error || 'Failed to synthesize speech');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  // Check if we have any connectors
  if (availableModels.length === 0) {
    return (
      <div className="no-connectors-warning">
        <div className="no-connectors-warning__icon">
          <AlertTriangle size={32} />
        </div>
        <h3 className="no-connectors-warning__title">No TTS Models Available</h3>
        <p className="no-connectors-warning__description">
          Configure an OpenAI or Google connector to use text-to-speech.
        </p>
        <Button variant="primary" onClick={() => navigate('llm-connectors')}>
          Configure Connectors
        </Button>
      </div>
    );
  }

  const maxInputLength = modelCapabilities?.limits?.maxInputLength ?? 4096;
  const textPercentUsed = (text.length / maxInputLength) * 100;

  return (
    <div className="tts-tab">
      <div className="tts-tab__controls">
        {/* Connector Selection */}
        <ConnectorSelector
          selectedConnector={selectedConnector}
          onSelectConnector={setSelectedConnector}
          disabled={isGenerating}
          mediaType="tts"
        />

        {/* Model Selection */}
        <ModelSelector
          models={availableModels}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          disabled={isGenerating}
        />

        {/* Voice Selection */}
        {modelCapabilities && (
          <VoiceSelector
            voices={modelCapabilities.voices}
            selectedVoice={selectedVoice}
            onVoiceSelect={setSelectedVoice}
            disabled={isGenerating}
          />
        )}

        {/* Options */}
        {modelCapabilities && (
          <div className="options-form">
            <h4 className="options-form__title">Options</h4>
            <div className="options-form__grid">
              {/* Output Format */}
              <div className="options-form__field">
                <label className="options-form__label">Output Format</label>
                <select
                  className="options-form__select"
                  value={(options.format as string) || modelCapabilities.formats[0]}
                  onChange={(e) => handleOptionChange('format', e.target.value)}
                  disabled={isGenerating}
                >
                  {modelCapabilities.formats.map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {/* Speed Control (if supported) */}
              {modelCapabilities.speed.supported && (
                <div className="options-form__field">
                  <label className="options-form__label">
                    Speed: {(options.speed as number) || modelCapabilities.speed.default || 1}x
                  </label>
                  <div className="options-form__slider">
                    <input
                      type="range"
                      min={modelCapabilities.speed.min || 0.25}
                      max={modelCapabilities.speed.max || 4}
                      step={0.25}
                      value={(options.speed as number) || modelCapabilities.speed.default || 1}
                      onChange={(e) => handleOptionChange('speed', parseFloat(e.target.value))}
                      disabled={isGenerating}
                    />
                    <span className="options-form__slider-value">
                      {(options.speed as number) || modelCapabilities.speed.default || 1}x
                    </span>
                  </div>
                </div>
              )}

              {/* Instructions (for gpt-4o-mini-tts) */}
              {modelCapabilities.features.instructionSteering && (
                <div className="options-form__field options-form__field--full">
                  <label className="options-form__label">
                    Voice Instructions
                    <span className="options-form__hint"> (e.g., "speak calmly and slowly")</span>
                  </label>
                  <textarea
                    className="options-form__textarea"
                    value={(options.instructions as string) || ''}
                    onChange={(e) => handleOptionChange('instructions', e.target.value)}
                    placeholder="Describe how you want the voice to sound..."
                    disabled={isGenerating}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Input */}
        <div className="prompt-input">
          <div className="prompt-input__label">
            <span className="prompt-input__title">Text to Synthesize</span>
            <span
              className={`prompt-input__counter ${
                textPercentUsed > 90
                  ? 'prompt-input__counter--error'
                  : textPercentUsed > 75
                  ? 'prompt-input__counter--warning'
                  : ''
              }`}
            >
              {text.length.toLocaleString()} / {maxInputLength.toLocaleString()}
            </span>
          </div>
          <textarea
            className="prompt-input__textarea"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, maxInputLength))}
            placeholder="Enter the text you want to convert to speech..."
            disabled={isGenerating || !selectedModel}
          />
        </div>

        {/* Generate Button */}
        <div className="generate-section">
          <div className="generate-section__cost">
            {estimatedCost !== null && (
              <>
                Est. cost:{' '}
                <span className="generate-section__cost-value">
                  ${estimatedCost.toFixed(4)}
                </span>
              </>
            )}
          </div>
          <button
            className="generate-button"
            onClick={handleGenerate}
            disabled={isGenerating || !selectedModel || !text.trim() || !selectedVoice}
            type="button"
          >
            <Sparkles size={16} />
            {isGenerating ? 'Generating...' : 'Generate Speech'}
          </button>
        </div>
      </div>

      <div className="tts-tab__preview">
        <AudioPlayer
          audioData={audioData}
          format={audioFormat}
          isLoading={isGenerating}
          error={error}
        />
      </div>
    </div>
  );
}
