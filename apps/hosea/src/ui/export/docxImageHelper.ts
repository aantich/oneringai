/**
 * DocxImageHelper - Reliable image insertion utilities for Word documents
 * Provides robust methods for inserting images into DOCX files with proper format handling
 */

import { ImageRun } from 'docx';

export interface ImageInsertOptions {
    width?: number;
    height?: number;
    maintainAspectRatio?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number; // 0.1 to 1.0 for JPEG
}

export interface ImageInsertResult {
    imageRun: ImageRun;
    actualWidth: number;
    actualHeight: number;
    format: string;
    size: number; // in bytes
}

export class DocxImageHelper {
    /**
     * Insert image from File object
     */
    static async insertImageFromFile(
        file: File,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        const arrayBuffer = await file.arrayBuffer();
        const format = this.getImageFormat(file.type || file.name);

        return this.createImageRun(arrayBuffer, format, options);
    }

    /**
     * Insert image from URL (fetch and convert)
     */
    static async insertImageFromUrl(
        url: string,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        try {
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const format = this.getImageFormat(response.headers.get('content-type') || url);

            return this.createImageRun(arrayBuffer, format, options);
        } catch (error: any) {
            throw new Error(`Failed to load image from URL: ${error.message}`);
        }
    }

    /**
     * Insert image from base64 data URL
     */
    static async insertImageFromDataUrl(
        dataUrl: string,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        // Parse data URL: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...
        const matches = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
        if (!matches) {
            throw new Error('Invalid data URL format');
        }

        const [, formatType, base64Data] = matches;
        const format = this.getImageFormat(formatType);

        // Convert base64 to ArrayBuffer
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return this.createImageRun(bytes.buffer, format, options);
    }

    /**
     * Insert image from Canvas element
     */
    static async insertImageFromCanvas(
        canvas: HTMLCanvasElement,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        return new Promise((resolve, reject) => {
            const quality = options.quality || 0.92;
            const format = 'jpeg';

            try {
                // Create composite canvas with white background for JPEG conversion
                const compositeCanvas = document.createElement('canvas');
                compositeCanvas.width = canvas.width;
                compositeCanvas.height = canvas.height;
                const ctx = compositeCanvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                // Fill with white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

                // Draw the original canvas on top
                ctx.drawImage(canvas, 0, 0);

                // Convert to blob using toBlob method
                compositeCanvas.toBlob(
                    async (blob) => {
                        if (!blob) {
                            reject(new Error('Failed to create blob from canvas'));
                            return;
                        }

                        try {
                            const arrayBuffer = await blob.arrayBuffer();
                            const result = await this.createImageRun(arrayBuffer, format, options);
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                    },
                    `image/${format}`,
                    quality,
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Insert image from Blob
     */
    static async insertImageFromBlob(
        blob: Blob,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        const arrayBuffer = await blob.arrayBuffer();
        const format = this.getImageFormat(blob.type);

        return this.createImageRun(arrayBuffer, format, options);
    }

    /**
     * Core method to create ImageRun from ArrayBuffer
     */
    private static async createImageRun(
        arrayBuffer: ArrayBuffer,
        format: string,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        // Get image dimensions if not provided
        const imageDimensions = await this.getImageDimensions(arrayBuffer, format);

        // Calculate final dimensions
        const dimensions = this.calculateDimensions(
            imageDimensions.width,
            imageDimensions.height,
            options,
        );

        // Convert ArrayBuffer to Uint8Array for docx library
        const uint8Array = new Uint8Array(arrayBuffer);

        // Create ImageRun
        try {
            const imageRun = new ImageRun({
                data: uint8Array,
                transformation: {
                    width: dimensions.width,
                    height: dimensions.height,
                },
                type: format as any,
            });

            return {
                imageRun,
                actualWidth: dimensions.width,
                actualHeight: dimensions.height,
                format,
                size: arrayBuffer.byteLength,
            };
        } catch (error: any) {
            throw new Error(`Failed to create ImageRun: ${error.message}`);
        }
    }

    /**
     * Calculate dimensions with aspect ratio preservation
     */
    private static calculateDimensions(
        originalWidth: number,
        originalHeight: number,
        options: ImageInsertOptions,
    ): { width: number; height: number } {
        let {
            width,
            height,
            maxWidth = 600,
            maxHeight = 800,
            maintainAspectRatio = true,
        } = options;

        // If specific dimensions provided and aspect ratio doesn't matter
        if (width && height && !maintainAspectRatio) {
            return { width, height };
        }

        // Calculate aspect ratio
        const aspectRatio = originalWidth / originalHeight;

        // If only width provided
        if (width && !height) {
            height = width / aspectRatio;
        }

        // If only height provided
        if (height && !width) {
            width = height * aspectRatio;
        }

        // If no dimensions provided, use original but constrain to max
        if (!width && !height) {
            width = originalWidth;
            height = originalHeight;
        }

        // Apply max constraints while maintaining aspect ratio
        if (width! > maxWidth) {
            width = maxWidth;
            if (maintainAspectRatio) {
                height = width / aspectRatio;
            }
        }

        if (height! > maxHeight) {
            height = maxHeight;
            if (maintainAspectRatio) {
                width = height * aspectRatio;
            }
        }

        return {
            width: Math.round(width!),
            height: Math.round(height!),
        };
    }

    /**
     * Get image dimensions from binary data
     */
    private static async getImageDimensions(
        arrayBuffer: ArrayBuffer,
        format: string,
    ): Promise<{ width: number; height: number }> {
        return new Promise((resolve) => {
            const blob = new Blob([arrayBuffer], { type: `image/${format}` });
            const url = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                // Fallback dimensions if image loading fails
                resolve({ width: 400, height: 300 });
            };
            img.src = url;
        });
    }

    /**
     * Determine image format from MIME type or filename
     */
    private static getImageFormat(input: string): string {
        if (!input) return 'jpeg';

        const normalized = input.toLowerCase();

        // All formats converted to JPEG for maximum docx compatibility
        if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpeg';
        if (normalized.includes('png')) return 'jpeg';
        if (normalized.includes('gif')) return 'jpeg';
        if (normalized.includes('webp')) return 'jpeg';
        if (normalized.includes('bmp')) return 'jpeg';

        if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'jpeg';
        if (normalized.endsWith('.png')) return 'jpeg';
        if (normalized.endsWith('.gif')) return 'jpeg';

        return 'jpeg';
    }

    /**
     * Insert image from SVG element by converting to canvas first
     */
    static async insertImageFromSVG(
        svgElement: SVGSVGElement,
        options: ImageInsertOptions = {},
    ): Promise<ImageInsertResult> {
        return new Promise((resolve, reject) => {
            try {
                // Get SVG dimensions
                const rect = svgElement.getBoundingClientRect();
                const width = rect.width || svgElement.width.baseVal?.value || 800;
                const height = rect.height || svgElement.height.baseVal?.value || 400;

                // Create canvas to render SVG
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('Failed to get canvas context for SVG conversion'));
                    return;
                }

                // Fill with white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);

                // Convert SVG to image data with proper encoding
                const svgData = new XMLSerializer().serializeToString(svgElement);
                const svgDataUrl =
                    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);

                const img = new Image();
                img.onload = async () => {
                    try {
                        ctx.drawImage(img, 0, 0, width, height);
                        const result = await this.insertImageFromCanvas(canvas, options);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                };
                img.onerror = () => {
                    reject(new Error('Failed to load SVG as image'));
                };

                img.crossOrigin = 'anonymous';
                img.src = svgDataUrl;
            } catch (error) {
                reject(error);
            }
        });
    }
}
