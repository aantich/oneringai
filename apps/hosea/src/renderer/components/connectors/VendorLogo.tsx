/**
 * VendorLogo Component
 *
 * Renders a vendor logo from SVG with fallback support.
 * Uses the vendor templates logo system from oneringai.
 */

import React, { useState, useEffect } from 'react';

interface VendorLogoProps {
  /** Vendor ID (e.g., 'github', 'slack') */
  vendorId: string;
  /** Logo size in pixels */
  size?: number;
  /** Optional custom color override (hex without #) */
  color?: string;
  /** CSS class name */
  className?: string;
  /** Show loading state while fetching */
  showLoading?: boolean;
}

interface VendorLogoData {
  vendorId: string;
  svg: string;
  hex: string;
  isPlaceholder: boolean;
  simpleIconsSlug?: string;
}

// Cache for logos to avoid repeated IPC calls
const logoCache = new Map<string, VendorLogoData | null>();

export function VendorLogo({
  vendorId,
  size = 24,
  color,
  className = '',
  showLoading = true,
}: VendorLogoProps): React.ReactElement {
  const [logo, setLogo] = useState<VendorLogoData | null>(logoCache.get(vendorId) ?? null);
  const [loading, setLoading] = useState(!logoCache.has(vendorId));

  useEffect(() => {
    // If already cached, use it
    if (logoCache.has(vendorId)) {
      setLogo(logoCache.get(vendorId) ?? null);
      setLoading(false);
      return;
    }

    // Fetch logo from main process
    const fetchLogo = async () => {
      try {
        const data = await window.hosea.universalConnector.getVendorLogo(vendorId);
        logoCache.set(vendorId, data);
        setLogo(data);
      } catch (error) {
        console.error(`Failed to fetch logo for ${vendorId}:`, error);
        logoCache.set(vendorId, null);
        setLogo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchLogo();
  }, [vendorId]);

  // Loading state
  if (loading && showLoading) {
    return (
      <div
        className={`vendor-logo vendor-logo--loading ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: size / 6,
          backgroundColor: 'var(--color-surface-2)',
        }}
      />
    );
  }

  // No logo available - show fallback
  if (!logo) {
    const letter = vendorId.charAt(0).toUpperCase();
    return (
      <div
        className={`vendor-logo vendor-logo--fallback ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: size / 6,
          backgroundColor: 'var(--color-surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.5,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
        }}
      >
        {letter}
      </div>
    );
  }

  // Determine fill color
  const fillColor = color || logo.hex;

  // If it's a placeholder SVG, render as-is (it has embedded colors)
  if (logo.isPlaceholder) {
    return (
      <div
        className={`vendor-logo ${className}`}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: logo.svg }}
      />
    );
  }

  // For Simple Icons SVGs, we need to add fill color
  // Simple Icons SVGs are just paths without fill, so we wrap and style them
  const svgWithColor = logo.svg.replace(
    '<svg',
    `<svg fill="#${fillColor}"`
  );

  return (
    <div
      className={`vendor-logo ${className}`}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svgWithColor }}
    />
  );
}

/**
 * Pre-fetch logos for multiple vendors (useful for lists)
 */
export async function prefetchVendorLogos(vendorIds: string[]): Promise<void> {
  const uncached = vendorIds.filter(id => !logoCache.has(id));
  if (uncached.length === 0) return;

  await Promise.all(
    uncached.map(async (vendorId) => {
      try {
        const data = await window.hosea.universalConnector.getVendorLogo(vendorId);
        logoCache.set(vendorId, data);
      } catch {
        logoCache.set(vendorId, null);
      }
    })
  );
}

/**
 * Clear the logo cache (useful when switching themes)
 */
export function clearLogoCache(): void {
  logoCache.clear();
}

export default VendorLogo;
