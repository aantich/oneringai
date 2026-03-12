/**
 * VideoTab - Main video generation interface
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from 'react-bootstrap';
import { useNavigation } from '../../hooks/useNavigation';
import { VideoDisplay, type VideoStatus } from './VideoDisplay';
import { ImageDropzone } from './ImageDropzone';
import { ConnectorSelector } from './ConnectorSelector';

// Video model info type
interface VideoModelInfo {
  name: string;
  displayName: string;
  vendor: string;
  description?: string;
  durations: number[];
  resolutions: string[];
  maxFps: number;
  audio: boolean;
  imageToVideo: boolean;
  pricing?: {
    perSecond: number;
    currency: string;
  };
}

// Video model capabilities type
interface VideoModelCapabilities {
  durations: number[];
  resolutions: string[];
  aspectRatios?: string[];
  maxFps: number;
  audio: boolean;
  imageToVideo: boolean;
  videoExtension: boolean;
  frameControl: boolean;
  features: {
    upscaling: boolean;
    styleControl: boolean;
    negativePrompt: boolean;
    seed: boolean;
  };
  pricing?: {
    perSecond: number;
    currency: string;
  };
}

// Vendor display info
const vendorLabels: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google',
  grok: 'Grok (xAI)',
};

export function VideoTab(): React.ReactElement {
  const { navigate } = useNavigation();

  // State
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<VideoModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelCapabilities, setModelCapabilities] = useState<VideoModelCapabilities | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [prompt, setPrompt] = useState('');
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  // Generation state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<VideoStatus>('idle');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [videoData, setVideoData] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Polling ref
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const loadAvailableModels = async () => {
    try {
      const models = await window.hosea.multimedia.getAvailableVideoModels(selectedConnector || undefined);
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
      console.error('Failed to load video models:', err);
    }
  };

  const loadModelCapabilities = async (modelName: string) => {
    try {
      const capabilities = await window.hosea.multimedia.getVideoModelCapabilities(modelName);
      if (!capabilities) {
        setModelCapabilities(null);
        return;
      }

      setModelCapabilities(capabilities);

      // Reset options to defaults
      const defaults: Record<string, unknown> = {
        duration: capabilities.durations[Math.floor(capabilities.durations.length / 2)] || capabilities.durations[0],
      };

      // Set default resolution if available
      if (capabilities.resolutions.length > 0) {
        defaults.resolution = capabilities.resolutions[0];
      }

      // Set default aspect ratio if available (for Google Veo models)
      if (capabilities.aspectRatios && capabilities.aspectRatios.length > 0) {
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
      const duration = Number(options.duration ?? 8);
      const cost = await window.hosea.multimedia.calculateVideoCost(selectedModel, duration);
      setEstimatedCost(cost);
    } catch {
      setEstimatedCost(null);
    }
  };

  const handleOptionChange = useCallback((key: string, value: unknown) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const startPolling = (jobId: string) => {
    // Poll every 10 seconds
    pollIntervalRef.current = setInterval(async () => {
      try {
        const result = await window.hosea.multimedia.getVideoStatus(jobId);

        if (!result.success) {
          setError(result.error || 'Failed to get status');
          setGenerationStatus('failed');
          stopPolling();
          return;
        }

        if (result.status === 'completed') {
          stopPolling();
          setGenerationStatus('completed');
          setGenerationProgress(100);

          // Always download server-side (Google URLs require auth headers)
          const downloadResult = await window.hosea.multimedia.downloadVideo(jobId);
          if (downloadResult.success && downloadResult.data) {
            setVideoData(downloadResult.data);
          } else if (downloadResult.error) {
            setError(downloadResult.error);
            setGenerationStatus('failed');
          }
        } else if (result.status === 'failed') {
          stopPolling();
          setGenerationStatus('failed');
          setError(result.error || 'Video generation failed');
        } else {
          // Still processing
          setGenerationStatus(result.status === 'pending' ? 'pending' : 'processing');
          setGenerationProgress(result.progress || 0);
        }
      } catch (err) {
        console.error('Error polling video status:', err);
        // Don't stop polling on network errors - retry
      }
    }, 10000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleGenerate = async () => {
    if (!selectedModel || !prompt.trim()) return;

    // Reset state
    setError(null);
    setVideoData(null);
    setVideoUrl(null);
    setGenerationStatus('pending');
    setGenerationProgress(0);

    try {
      // Build vendor options for Google models
      const vendorOptions: Record<string, unknown> = {};
      if (options.negativePrompt) {
        vendorOptions.negativePrompt = options.negativePrompt;
      }
      if (options.personGeneration) {
        vendorOptions.personGeneration = options.personGeneration;
      }

      const result = await window.hosea.multimedia.generateVideo({
        model: selectedModel,
        prompt: prompt.trim(),
        connector: selectedConnector || undefined,
        duration: Number(options.duration),
        resolution: options.resolution ? String(options.resolution) : undefined,
        aspectRatio: options.aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | undefined,
        image: referenceImage || undefined,
        seed: options.seed ? Number(options.seed) : undefined,
        vendorOptions: Object.keys(vendorOptions).length > 0 ? vendorOptions : undefined,
      });

      if (result.success && result.jobId) {
        setCurrentJobId(result.jobId);
        startPolling(result.jobId);
      } else {
        setError(result.error || 'Failed to start video generation');
        setGenerationStatus('failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setGenerationStatus('failed');
    }
  };

  const handleCancel = async () => {
    if (currentJobId) {
      stopPolling();
      await window.hosea.multimedia.cancelVideoJob(currentJobId);
      setCurrentJobId(null);
      setGenerationStatus('idle');
      setGenerationProgress(0);
    }
  };

  const handleDownload = async () => {
    if (videoUrl) {
      // Open URL in new tab
      window.open(videoUrl, '_blank');
      return;
    }

    if (videoData) {
      // Convert base64 to blob for download (CSP blocks data: URLs)
      try {
        const base64 = videoData.startsWith('data:')
          ? videoData.split(',')[1]
          : videoData;
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `generated-video-${Date.now()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Cleanup
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        console.error('Failed to download video:', err);
      }
    }
  };

  // Group models by vendor
  const modelsByVendor = availableModels.reduce<Record<string, VideoModelInfo[]>>((acc, model) => {
    const vendor = model.vendor;
    if (!acc[vendor]) {
      acc[vendor] = [];
    }
    acc[vendor].push(model);
    return acc;
  }, {});

  // Check if we have any connectors
  if (availableModels.length === 0) {
    return (
      <div className="no-connectors-warning">
        <div className="no-connectors-warning__icon">
          <AlertTriangle size={32} />
        </div>
        <h3 className="no-connectors-warning__title">No Video Models Available</h3>
        <p className="no-connectors-warning__description">
          Configure an OpenAI or Google connector to use video generation.
        </p>
        <Button variant="primary" onClick={() => navigate('llm-connectors')}>
          Configure Connectors
        </Button>
      </div>
    );
  }

  const selectedModelInfo = availableModels.find((m) => m.name === selectedModel);
  const isGenerating = generationStatus === 'pending' || generationStatus === 'processing';
  const maxPromptLength = 4000; // Default max prompt length
  const promptPercentUsed = (prompt.length / maxPromptLength) * 100;

  return (
    <div className="video-tab">
      <div className="video-tab__controls">
        {/* Connector Selection */}
        <ConnectorSelector
          selectedConnector={selectedConnector}
          onSelectConnector={setSelectedConnector}
          disabled={isGenerating}
          mediaType="video"
        />

        {/* Model Selection */}
        <div className="model-selector">
          <label className="model-selector__label" htmlFor="video-model-select">
            Model
          </label>
          <select
            id="video-model-select"
            className="model-selector__select"
            value={selectedModel || ''}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isGenerating}
          >
            <option value="">Select a model...</option>
            {Object.entries(modelsByVendor).map(([vendor, vendorModels]) => (
              <optgroup key={vendor} label={vendorLabels[vendor] || vendor}>
                {vendorModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.displayName}
                    {model.audio && ' (with audio)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedModelInfo?.description && (
            <div className="model-selector__info">
              <span>{selectedModelInfo.description}</span>
            </div>
          )}
        </div>

        {/* Generation Options */}
        {modelCapabilities && (
          <div className="options-form">
            <h4 className="options-form__title">Generation Options</h4>
            <div className="options-form__grid">
              {/* Duration */}
              <div className="options-form__field">
                <label className="options-form__label">Duration</label>
                <select
                  className="options-form__select"
                  value={String(options.duration)}
                  onChange={(e) => handleOptionChange('duration', Number(e.target.value))}
                  disabled={isGenerating}
                >
                  {modelCapabilities.durations.map((d) => (
                    <option key={d} value={d}>
                      {d} seconds
                    </option>
                  ))}
                </select>
              </div>

              {/* Aspect Ratio (for Google Veo models) */}
              {modelCapabilities.aspectRatios && modelCapabilities.aspectRatios.length > 0 && (
                <div className="options-form__field">
                  <label className="options-form__label">Aspect Ratio</label>
                  <select
                    className="options-form__select"
                    value={String(options.aspectRatio || modelCapabilities.aspectRatios[0])}
                    onChange={(e) => handleOptionChange('aspectRatio', e.target.value)}
                    disabled={isGenerating}
                  >
                    {modelCapabilities.aspectRatios.map((ar) => (
                      <option key={ar} value={ar}>
                        {ar === '16:9' ? '16:9 (Landscape)' : ar === '9:16' ? '9:16 (Portrait)' : ar}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Resolution (only show if model has resolution options) */}
              {modelCapabilities.resolutions.length > 0 && (
                <div className="options-form__field">
                  <label className="options-form__label">Resolution</label>
                  <select
                    className="options-form__select"
                    value={String(options.resolution || modelCapabilities.resolutions[0])}
                    onChange={(e) => handleOptionChange('resolution', e.target.value)}
                    disabled={isGenerating}
                  >
                    {modelCapabilities.resolutions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                        {(r === '1080p' || r === '4k') && ' (requires 8s)'}
                      </option>
                    ))}
                  </select>
                  {/* Show warning if high resolution selected with non-8s duration */}
                  {(options.resolution === '1080p' || options.resolution === '4k') &&
                   Number(options.duration) !== 8 && (
                    <div className="options-form__hint options-form__hint--warning">
                      {options.resolution} requires 8 second duration
                    </div>
                  )}
                </div>
              )}

              {/* Negative Prompt (Google only) */}
              {modelCapabilities.features.negativePrompt && (
                <div className="options-form__field options-form__field--full">
                  <label className="options-form__label">Negative Prompt</label>
                  <input
                    type="text"
                    className="options-form__input"
                    value={String(options.negativePrompt ?? '')}
                    onChange={(e) => handleOptionChange('negativePrompt', e.target.value)}
                    placeholder="What to avoid in the video..."
                    disabled={isGenerating}
                  />
                </div>
              )}

              {/* Seed (if supported) */}
              {modelCapabilities.features.seed && (
                <div className="options-form__field">
                  <label className="options-form__label">Seed (optional)</label>
                  <input
                    type="number"
                    className="options-form__input"
                    value={String(options.seed ?? '')}
                    onChange={(e) => handleOptionChange('seed', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="Random seed"
                    disabled={isGenerating}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reference Image (Image-to-Video) */}
        {selectedModelInfo?.imageToVideo && (
          <ImageDropzone
            onImageSelect={setReferenceImage}
            disabled={isGenerating}
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
            placeholder="Describe the video you want to generate..."
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
                  ${estimatedCost.toFixed(2)}
                </span>
              </>
            )}
          </div>
          {isGenerating ? (
            <button
              className="generate-button generate-button--cancel"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
          ) : (
            <button
              className="generate-button"
              onClick={handleGenerate}
              disabled={!selectedModel || !prompt.trim()}
              type="button"
            >
              <Sparkles size={16} />
              Generate Video
            </button>
          )}
        </div>
      </div>

      <div className="video-tab__preview">
        <VideoDisplay
          status={generationStatus}
          progress={generationProgress}
          videoData={videoData}
          videoUrl={videoUrl}
          error={error}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
}
