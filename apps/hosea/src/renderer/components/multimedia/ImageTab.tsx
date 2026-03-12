/**
 * ImageTab - Main image generation interface
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from 'react-bootstrap';
import { useNavigation } from '../../hooks/useNavigation';
import { ModelSelector, type ImageModelInfo } from './ModelSelector';
import { ConnectorSelector } from './ConnectorSelector';
import { DynamicOptionsForm, type ModelCapabilities, type VendorOptionSchema } from './DynamicOptionsForm';
import { ImageDisplay } from './ImageDisplay';

interface GenerationResult {
  success: boolean;
  data?: {
    images: Array<{
      b64_json?: string;
      url?: string;
      revisedPrompt?: string;
    }>;
  };
  error?: string;
}

// API capabilities type (from IPC)
interface APICapabilities {
  sizes: readonly string[];
  aspectRatios?: readonly string[];
  maxImagesPerRequest: number;
  outputFormats: readonly string[];
  features: {
    generation: boolean;
    editing: boolean;
    variations: boolean;
    styleControl: boolean;
    qualityControl: boolean;
    transparency: boolean;
    promptRevision: boolean;
  };
  limits: {
    maxPromptLength: number;
    maxRequestsPerMinute?: number;
  };
  vendorOptions?: Record<string, unknown>;
}

export function ImageTab(): React.ReactElement {
  const { navigate } = useNavigation();

  // State
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ImageModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelCapabilities, setModelCapabilities] = useState<ModelCapabilities | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<Array<{
    data: string;
    revisedPrompt?: string;
  }>>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
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
      setOptions({});
    }
  }, [selectedModel]);

  // Calculate estimated cost when model or options change
  useEffect(() => {
    if (selectedModel && modelCapabilities) {
      calculateCost();
    }
  }, [selectedModel, modelCapabilities, options]);

  const loadAvailableModels = async () => {
    try {
      const models = await window.hosea.multimedia.getAvailableImageModels(selectedConnector || undefined);
      setAvailableModels(models);

      // Auto-select first model if available, or reset if current model not in list
      if (models.length > 0) {
        if (!selectedModel || !models.find((m) => m.name === selectedModel)) {
          setSelectedModel(models[0].name);
        }
      } else {
        setSelectedModel(null);
      }
    } catch (err) {
      console.error('Failed to load image models:', err);
    }
  };

  const loadModelCapabilities = async (modelName: string) => {
    try {
      const apiCapabilities: APICapabilities | null = await window.hosea.multimedia.getImageModelCapabilities(modelName);
      if (!apiCapabilities) {
        setModelCapabilities(null);
        return;
      }

      // Convert API capabilities to our local type
      const capabilities: ModelCapabilities = {
        sizes: apiCapabilities.sizes,
        aspectRatios: apiCapabilities.aspectRatios,
        maxImagesPerRequest: apiCapabilities.maxImagesPerRequest,
        features: {
          qualityControl: apiCapabilities.features.qualityControl,
          styleControl: apiCapabilities.features.styleControl,
        },
        limits: {
          maxPromptLength: apiCapabilities.limits.maxPromptLength,
        },
        vendorOptions: apiCapabilities.vendorOptions as Record<string, VendorOptionSchema> | undefined,
      };

      setModelCapabilities(capabilities);

      // Reset options to defaults
      const defaults: Record<string, unknown> = {
        size: capabilities.sizes[0],
        n: 1,
      };

      // Set defaults from vendorOptions
      if (capabilities.vendorOptions) {
        for (const [key, schema] of Object.entries(capabilities.vendorOptions)) {
          if (schema && typeof schema === 'object' && 'default' in schema && schema.default !== undefined) {
            defaults[key] = schema.default;
          }
        }
      }

      // Set aspect ratio default for Google models
      if (capabilities.aspectRatios) {
        defaults.aspectRatio = capabilities.aspectRatios[0];
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
      const cost = await window.hosea.multimedia.calculateImageCost(
        selectedModel,
        Number(options.n ?? 1),
        String(options.quality ?? 'standard')
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
    if (!selectedModel || !prompt.trim()) return;

    setIsGenerating(true);
    setError(null);
    setGeneratedImages([]);
    setSelectedImageIndex(0);

    try {
      const result: GenerationResult = await window.hosea.multimedia.generateImage({
        model: selectedModel,
        prompt: prompt.trim(),
        connector: selectedConnector || undefined,
        ...options,
      });

      if (result.success && result.data?.images?.length) {
        const images = result.data.images
          .map((img) => ({
            data: img.b64_json || img.url || '',
            revisedPrompt: img.revisedPrompt,
          }))
          .filter((img) => img.data); // Filter out any empty data

        if (images.length > 0) {
          setGeneratedImages(images);
        } else {
          setError('No images returned from generation');
        }
      } else {
        setError(result.error || 'Failed to generate image');
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
        <h3 className="no-connectors-warning__title">No Image Models Available</h3>
        <p className="no-connectors-warning__description">
          Configure an OpenAI or Google connector to use image generation.
        </p>
        <Button variant="primary" onClick={() => navigate('llm-connectors')}>
          Configure Connectors
        </Button>
      </div>
    );
  }

  const maxPromptLength = modelCapabilities?.limits?.maxPromptLength ?? 4000;
  const promptPercentUsed = (prompt.length / maxPromptLength) * 100;

  return (
    <div className="image-tab">
      <div className="image-tab__controls">
        {/* Connector Selection */}
        <ConnectorSelector
          selectedConnector={selectedConnector}
          onSelectConnector={setSelectedConnector}
          disabled={isGenerating}
          mediaType="image"
        />

        {/* Model Selection */}
        <ModelSelector
          models={availableModels}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          disabled={isGenerating}
        />

        {/* Dynamic Options */}
        {modelCapabilities && (
          <DynamicOptionsForm
            capabilities={modelCapabilities}
            options={options}
            onOptionChange={handleOptionChange}
          />
        )}

        {/* Prompt Input */}
        <div className="prompt-input">
          <div className="prompt-input__label">
            <span className="prompt-input__title">Prompt</span>
            <span
              className={`prompt-input__counter ${
                promptPercentUsed > 90
                  ? 'prompt-input__counter--error'
                  : promptPercentUsed > 75
                  ? 'prompt-input__counter--warning'
                  : ''
              }`}
            >
              {prompt.length.toLocaleString()} / {maxPromptLength.toLocaleString()}
            </span>
          </div>
          <textarea
            className="prompt-input__textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, maxPromptLength))}
            placeholder="Describe the image you want to generate..."
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
                  ${estimatedCost.toFixed(3)}
                </span>
              </>
            )}
          </div>
          <button
            className="generate-button"
            onClick={handleGenerate}
            disabled={isGenerating || !selectedModel || !prompt.trim()}
            type="button"
          >
            <Sparkles size={16} />
            {isGenerating ? 'Generating...' : 'Generate Image'}
          </button>
        </div>
      </div>

      <div className="image-tab__preview">
        <ImageDisplay
          images={generatedImages}
          selectedIndex={selectedImageIndex}
          onSelectImage={setSelectedImageIndex}
          isLoading={isGenerating}
          error={error}
        />
      </div>
    </div>
  );
}
