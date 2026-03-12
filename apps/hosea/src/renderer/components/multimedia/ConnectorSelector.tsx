/**
 * ConnectorSelector - Dropdown for selecting a multimedia-capable connector
 * Filters connectors to those with vendors that support multimedia (openai, google, grok)
 */

import React, { useState, useEffect } from 'react';

const MULTIMEDIA_VENDORS = new Set(['openai', 'google', 'google-vertex', 'grok']);

const vendorLabels: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google',
  'google-vertex': 'Google Vertex',
  grok: 'Grok (xAI)',
};

interface ConnectorInfo {
  name: string;
  vendor: string;
  source?: 'local' | 'everworker' | 'built-in';
}

interface ConnectorSelectorProps {
  selectedConnector: string | null;
  onSelectConnector: (connectorName: string | null) => void;
  disabled?: boolean;
  mediaType?: 'image' | 'video' | 'tts';
}

export function ConnectorSelector({
  selectedConnector,
  onSelectConnector,
  disabled = false,
}: ConnectorSelectorProps): React.ReactElement {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);

  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    try {
      const allConnectors = await window.hosea.connector.list();
      const multimediaConnectors = allConnectors.filter((c) =>
        MULTIMEDIA_VENDORS.has(c.vendor.toLowerCase())
      );
      setConnectors(multimediaConnectors);

      // Auto-select first if none selected and only one available
      if (!selectedConnector && multimediaConnectors.length === 1) {
        onSelectConnector(multimediaConnectors[0].name);
      }
      // Auto-select first if none selected
      if (!selectedConnector && multimediaConnectors.length > 0) {
        onSelectConnector(multimediaConnectors[0].name);
      }
    } catch (err) {
      console.error('Failed to load connectors:', err);
    }
  };

  // Group by vendor
  const connectorsByVendor = connectors.reduce<Record<string, ConnectorInfo[]>>((acc, c) => {
    const vendor = c.vendor.toLowerCase();
    if (!acc[vendor]) {
      acc[vendor] = [];
    }
    acc[vendor].push(c);
    return acc;
  }, {});

  if (connectors.length === 0) {
    return <></>;
  }

  // Don't show selector if only one connector
  if (connectors.length === 1) {
    return <></>;
  }

  return (
    <div className="model-selector">
      <label className="model-selector__label" htmlFor="connector-select">
        Connector
      </label>
      <select
        id="connector-select"
        className="model-selector__select"
        value={selectedConnector || ''}
        onChange={(e) => onSelectConnector(e.target.value || null)}
        disabled={disabled}
      >
        <option value="">All connectors</option>
        {Object.entries(connectorsByVendor).map(([vendor, vendorConnectors]) =>
          vendorConnectors.length === 1 ? (
            vendorConnectors.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({vendorLabels[vendor] || vendor})
              </option>
            ))
          ) : (
            <optgroup key={vendor} label={vendorLabels[vendor] || vendor}>
              {vendorConnectors.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.source === 'everworker' ? ' (EW)' : ''}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>
    </div>
  );
}
