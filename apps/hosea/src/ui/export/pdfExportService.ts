import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { PDFTemplateManager } from './pdfTemplateManager.js';
import { applyVisualizationStyles, VISUALIZATION_SELECTORS } from './visualizationStyles.js';
// Runtime feature flags removed for V25 - feature always enabled

export interface PDFTemplate {
    // Header/Footer Configuration
    headerLogo?: string; // Base64 data URL, URL path, or SVG string
    headerLogoWidth?: number; // Width in pixels (default: 120)
    headerLogoHeight?: number; // Height in pixels (default: 40)
    headerLogoPosition?: 'left' | 'center' | 'right'; // Logo position (default: 'left')
    headerText?: string; // Additional header text
    footerText?: string; // Footer text (supports {{pageNumber}} and {{totalPages}})
    showPageNumbers?: boolean; // Show page numbers in footer (default: true)

    // Color Scheme
    primaryColor?: string; // Primary brand color (default: '#1a5490')
    secondaryColor?: string; // Secondary color (default: '#666666')
    accentColor?: string; // Accent color for highlights (default: '#e74c3c')
    textColor?: string; // Main text color (default: '#333333')

    // Typography
    fontFamily?: string; // Main font family (default: 'Inter, sans-serif')
    headingFont?: string; // Heading font family (default: same as fontFamily)
    fontSize?: number; // Base font size in px (default: 14)
    headingScale?: number; // Scale factor for headings (default: 1.5)

    // Layout & Spacing
    margins?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    }; // Margins in pixels (default: { top: 80, right: 60, bottom: 80, left: 60 })
    headerHeight?: number; // Header height in pixels (default: 60)
    footerHeight?: number; // Footer height in pixels (default: 40)

    // Branding
    companyName?: string; // Company name for branding
    companyTagline?: string; // Company tagline
    documentTitle?: string; // Document title (overrides default)

    // Watermark
    watermark?: string; // Watermark text or image path
    watermarkOpacity?: number; // Watermark opacity 0-1 (default: 0.1)
    watermarkPosition?: 'center' | 'diagonal' | 'corner'; // Watermark position (default: 'center')
    watermarkSize?: number; // Watermark size in pixels (default: 200)

    // Custom HTML
    prependHtml?: string; // HTML to insert at the beginning of the document
    appendHtml?: string; // HTML to insert at the end of the document

    // Custom Styles
    customCSS?: string; // Custom CSS to inject

    // Theme Name (for predefined themes)
    theme?: 'default' | 'professional' | 'modern' | 'minimal' | 'hosea';
}

export interface ExportOptions {
    filename?: string;
    format?: 'a4' | 'letter';
    orientation?: 'portrait' | 'landscape';
    quality?: number;
    onProgress?: (progress: number) => void;
    template?: PDFTemplate;
}

export class PDFExportService {
    private static readonly A4_WIDTH = 210; // mm
    private static readonly A4_HEIGHT = 297; // mm
    private static readonly A4_WIDTH_PX = 794; // A4 width at 96 DPI
    private static readonly A4_HEIGHT_PX = 1123; // A4 height at 96 DPI
    private static readonly MARGIN_PX = 60; // 20mm margins at 96 DPI
    private static readonly LETTER_WIDTH = 216; // mm
    private static readonly LETTER_HEIGHT = 279; // mm

    static async exportElementToPDF(
        element: HTMLElement,
        options: ExportOptions = {},
    ): Promise<void> {
        const {
            filename = `chat-export-${new Date().toISOString().split('T')[0]}.pdf`,
            format = 'a4',
            orientation = 'portrait',
            quality = 0.95,
            onProgress,
        } = options;

        try {
            onProgress?.(10);

            // Prepare element for export
            await this.prepareElementForExport(element);
            onProgress?.(20);

            // Wait for all visualizations to render
            await this.waitForVisualizationsToRender(element);
            onProgress?.(30);

            // Capture the element as canvas
            const canvas = await html2canvas(element, {
                scale: 2, // Higher scale for better quality
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                onclone: (clonedDocument) => {
                    // Ensure cloned element has proper styling
                    this.prepareClonedElement(clonedDocument, element);
                },
            });
            onProgress?.(70);

            // Create PDF
            const pdf = this.createPDF(format, orientation);
            await this.addCanvasToPDF(pdf, canvas, format, orientation);
            onProgress?.(90);

            // Download PDF
            pdf.save(filename);
            onProgress?.(100);
        } catch (error) {
            console.error('PDF export error:', error);
            throw new Error(`Failed to export PDF: ${(error as Error).message}`);
        }
    }

    private static async prepareElementForExport(element: HTMLElement): Promise<void> {
        // Ensure all images are loaded
        const images = element.querySelectorAll('img');
        const imagePromises = Array.from(images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = resolve; // Continue even if image fails
                setTimeout(resolve, 3000); // Timeout after 3 seconds
            });
        });

        await Promise.all(imagePromises);
    }

    private static async waitForVisualizationsToRender(element: HTMLElement): Promise<void> {
        // Wait for Mermaid diagrams
        const mermaidElements = element.querySelectorAll('.mermaid');
        if (mermaidElements.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Wait for Markmap
        const markmapElements = element.querySelectorAll('.markmap-container');
        if (markmapElements.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        // Wait for Vega charts
        const vegaElements = element.querySelectorAll(VISUALIZATION_SELECTORS.vega.join(', '));
        if (vegaElements.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // Additional wait for any remaining renders
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    private static prepareClonedElement(
        clonedDocument: Document,
        originalElement: HTMLElement,
    ): void {
        const clonedElement = clonedDocument.querySelector('body');
        if (!clonedElement) return;

        // Ensure fonts are loaded in cloned document
        const style = clonedDocument.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            * {
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            }

            /* Header formatting */
            h1 { font-size: 28px !important; font-weight: 700 !important; margin: 24px 0 16px 0 !important; line-height: 1.8 !important; letter-spacing: 0.5px !important; word-spacing: 2px !important; }
            h2 { font-size: 24px !important; font-weight: 600 !important; margin: 20px 0 12px 0 !important; line-height: 1.8 !important; letter-spacing: 0.3px !important; word-spacing: 2px !important; }
            h3 { font-size: 20px !important; font-weight: 600 !important; margin: 16px 0 10px 0 !important; line-height: 1.7 !important; letter-spacing: 0.2px !important; word-spacing: 1px !important; }
            h4 { font-size: 18px !important; font-weight: 500 !important; margin: 14px 0 8px 0 !important; line-height: 1.7 !important; letter-spacing: 0.2px !important; word-spacing: 1px !important; }
            h5 { font-size: 16px !important; font-weight: 500 !important; margin: 12px 0 6px 0 !important; line-height: 1.6 !important; letter-spacing: 0.1px !important; word-spacing: 1px !important; }
            h6 { font-size: 14px !important; font-weight: 500 !important; margin: 10px 0 4px 0 !important; line-height: 1.6 !important; letter-spacing: 0.1px !important; word-spacing: 1px !important; }

            /* Bold text */
            strong, b { font-weight: 600 !important; }

            /* Page break prevention for visualizations (using centralized selectors) */
            ${VISUALIZATION_SELECTORS.all.join(', ')} {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
            }

            /* Font families */
            .katex { font-family: KaTeX_Main, "Times New Roman", serif !important; }
            code, pre { font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace !important; }
        `;
        clonedDocument.head.appendChild(style);

        // Fix SVG elements that might not clone properly
        const svgElements = clonedElement.querySelectorAll('svg');
        svgElements.forEach((svg) => {
            svg.style.display = 'block';
            svg.style.margin = '0 auto';
        });
    }

    private static createPDF(format: string, orientation: string): jsPDF {
        const dimensions =
            format === 'letter'
                ? [this.LETTER_WIDTH, this.LETTER_HEIGHT]
                : [this.A4_WIDTH, this.A4_HEIGHT];

        return new jsPDF({
            orientation: orientation as 'portrait' | 'landscape',
            unit: 'mm',
            format: dimensions,
        });
    }

    private static async addCanvasToPDF(
        pdf: jsPDF,
        canvas: HTMLCanvasElement,
        format: string,
        orientation: string,
    ): Promise<void> {
        const imgWidth = format === 'letter' ? this.LETTER_WIDTH : this.A4_WIDTH;
        const imgHeight = format === 'letter' ? this.LETTER_HEIGHT : this.A4_HEIGHT;

        // Adjust for orientation
        const pageWidth = orientation === 'landscape' ? imgHeight : imgWidth;
        const pageHeight = orientation === 'landscape' ? imgWidth : imgHeight;

        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // Calculate scaling to fit page width
        const ratio = Math.min(
            pageWidth / (canvasWidth * 0.264583),
            pageHeight / (canvasHeight * 0.264583),
        );
        const scaledWidth = canvasWidth * 0.264583 * ratio; // Convert px to mm
        const scaledHeight = canvasHeight * 0.264583 * ratio;

        // Calculate how many pages we need
        const pagesNeeded = Math.ceil(scaledHeight / pageHeight);

        for (let i = 0; i < pagesNeeded; i++) {
            if (i > 0) {
                pdf.addPage();
            }

            // Calculate the portion of canvas to use for this page
            const sourceY = (canvasHeight / pagesNeeded) * i;
            const sourceHeight = Math.min(canvasHeight / pagesNeeded, canvasHeight - sourceY);

            // Create a temporary canvas for this page slice
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasWidth;
            tempCanvas.height = sourceHeight;

            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
                tempCtx.drawImage(
                    canvas,
                    0,
                    sourceY,
                    canvasWidth,
                    sourceHeight, // source
                    0,
                    0,
                    canvasWidth,
                    sourceHeight, // destination
                );

                const imgData = tempCanvas.toDataURL('image/jpeg', 0.95);
                const pageImgHeight = sourceHeight * 0.264583 * ratio;

                pdf.addImage(imgData, 'JPEG', 0, 0, scaledWidth, pageImgHeight);
            }
        }
    }

    static async exportMessageToPDF(
        params: {
            messageElement?: HTMLElement;
            markdownContent?: string;
        },
        options: ExportOptions = {},
    ): Promise<void> {
        const {
            filename = `message-export-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`,
            onProgress,
            template,
        } = options;

        try {
            onProgress?.(10);

            // Get merged template with defaults
            const mergedTemplate = await PDFTemplateManager.getMergedTemplate(template);

            // Create A4-formatted container
            const formattedContainer = await this.createA4FormattedContainer(
                params.messageElement!,
                template,
            );
            onProgress?.(30);

            // Wait for visualizations to render
            await this.waitForVisualizationsToRender(formattedContainer);
            onProgress?.(40);

            // Capture the formatted container
            const canvas = await html2canvas(formattedContainer, {
                scale: 2, // High quality
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                width: this.A4_WIDTH_PX,
                height: formattedContainer.offsetHeight,
            });
            onProgress?.(70);

            // Create PDF with proper A4 dimensions
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [this.A4_WIDTH, this.A4_HEIGHT],
            });

            await this.addA4CanvasToPDF(pdf, canvas, mergedTemplate);
            onProgress?.(90);

            // Clean up temporary container
            document.body.removeChild(formattedContainer);

            // Download PDF
            pdf.save(filename);
            onProgress?.(100);
        } catch (error) {
            console.error('Message PDF export error:', error);
            throw new Error(`Failed to export message PDF: ${(error as Error).message}`);
        }
    }

    private static async createA4FormattedContainer(
        messageElement: HTMLElement,
        template?: PDFTemplate,
    ): Promise<HTMLElement> {
        // Get merged template with defaults
        const mergedTemplate = await PDFTemplateManager.getMergedTemplate(template);

        // Create a temporary container with A4 dimensions
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: -9999px;
            left: -9999px;
            width: ${this.A4_WIDTH_PX}px;
            background: white;
            box-sizing: border-box;
            overflow: visible;
        `;

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.style.cssText = `
            width: 100%;
            overflow: visible;
        `;

        // Clone the message content
        const clonedContent = messageElement.cloneNode(true) as HTMLElement;

        // Remove export controls from cloned element (they shouldn't appear in PDF)
        this.removeExportControls(clonedContent);

        // Fix canvas elements that don't clone their visual content
        this.copyCanvasContent(messageElement, clonedContent);

        // Apply A4-specific styles to cloned content (this will be enhanced by template)
        this.applyA4Styling(clonedContent);

        contentWrapper.appendChild(clonedContent);
        container.appendChild(contentWrapper);

        // Add to DOM temporarily for rendering
        document.body.appendChild(container);

        // Wait for initial layout to settle
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Apply template styling (this will modify the container and add header/footer/etc)
        await PDFTemplateManager.applyTemplate(container, mergedTemplate);

        // Wait for template to be applied
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Now that DOM is rendered with template, insert smart page breaks based on actual positions
        this.insertSmartPageBreaks(container);

        // Wait for layout to re-settle after inserting spacers
        await new Promise((resolve) => setTimeout(resolve, 100));

        return container;
    }

    private static removeExportControls(clonedElement: HTMLElement): void {
        const uiControls = clonedElement.querySelectorAll('.message-ui-controls');
        uiControls.forEach((element) => element.remove());
    }

    private static copyCanvasContent(
        originalElement: HTMLElement,
        clonedElement: HTMLElement,
    ): void {
        // Get all canvas elements from both original and cloned elements
        const originalCanvases = originalElement.querySelectorAll('canvas');
        const clonedCanvases = clonedElement.querySelectorAll('canvas');

        // Copy content from each original canvas to the corresponding cloned canvas
        for (let i = 0; i < originalCanvases.length && i < clonedCanvases.length; i++) {
            const originalCanvas = originalCanvases[i];
            const clonedCanvas = clonedCanvases[i];

            if (originalCanvas && clonedCanvas) {
                try {
                    // Set the same dimensions
                    clonedCanvas.width = originalCanvas.width;
                    clonedCanvas.height = originalCanvas.height;

                    // Get context and copy the image data
                    const clonedCtx = clonedCanvas.getContext('2d');
                    if (clonedCtx) {
                        // Copy the visual content from original to cloned canvas
                        clonedCtx.drawImage(originalCanvas, 0, 0);
                    }
                } catch (error) {
                    console.warn('Failed to copy canvas content:', error);
                    // Continue with other canvases even if one fails
                }
            }
        }
    }

    private static applyA4Styling(element: HTMLElement): void {
        // Reset any responsive classes that might affect layout
        element.style.cssText += `
            max-width: 100% !important;
            width: auto !important;
        `;

        // Style all child elements for PDF
        const allElements = element.querySelectorAll('*') as NodeListOf<HTMLElement>;
        allElements.forEach((el) => {
            // Ensure text is readable
            const computedStyle = window.getComputedStyle(el);
            if (
                computedStyle.color === 'rgba(0, 0, 0, 0)' ||
                computedStyle.color === 'transparent'
            ) {
                el.style.color = '#333';
            }

            // Apply header styles explicitly
            if (el.tagName.match(/^H[1-6]$/)) {
                const level = parseInt(el.tagName.charAt(1));
                const sizes = ['28px', '24px', '20px', '18px', '16px', '14px'];
                const weights = ['700', '600', '600', '500', '500', '500'];
                const lineHeights = ['1.8', '1.8', '1.7', '1.7', '1.6', '1.6'];
                const letterSpacings = ['0.5px', '0.3px', '0.2px', '0.2px', '0.1px', '0.1px'];
                const wordSpacings = ['2px', '2px', '1px', '1px', '1px', '1px'];

                el.style.fontSize = sizes[level - 1];
                el.style.fontWeight = weights[level - 1];
                el.style.color = '#333';
                el.style.marginTop = level <= 2 ? '20px' : '16px';
                el.style.marginBottom = level <= 2 ? '12px' : '8px';
                el.style.lineHeight = lineHeights[level - 1];
                el.style.letterSpacing = letterSpacings[level - 1];
                el.style.wordSpacing = wordSpacings[level - 1];
            }

            // Ensure strong/bold elements are properly styled
            if (el.tagName === 'STRONG' || el.tagName === 'B') {
                el.style.fontWeight = '600';
            }

            // Fix any elements that might be too wide
            if (el.tagName === 'TABLE') {
                el.style.width = '100%';
                el.style.tableLayout = 'auto';
            }

            // Ensure code blocks fit properly
            if (el.tagName === 'PRE' || el.classList.contains('code-block')) {
                el.style.whiteSpace = 'pre-wrap';
                el.style.wordBreak = 'break-word';
                el.style.maxWidth = '100%';
                el.style.overflow = 'visible';
            }

            // Fix Vega/Vega-Lite charts using centralized styles (SAME AS MINDMAPS)
            if (
                el.classList.contains('vega-lite-container') ||
                el.classList.contains('vega-container')
            ) {
                applyVisualizationStyles(el, 'vega', 'pdf', true);

                // Force override inline styles - let content determine size (SAME AS MINDMAPS)
                el.style.setProperty('height', 'auto', 'important');
                el.style.setProperty('min-height', 'auto', 'important');
                el.style.setProperty('max-height', 'none', 'important');

                // Remove Vega action buttons more aggressively (including parent elements)
                const actionSelectors = [
                    '.vega-actions',
                    '[role="button"]',
                    '.vega-bind',
                    'button',
                    '.vega-menu',
                    '[class*="vega-action"]',
                    '[class*="action"]',
                    'summary',
                    'details', // Vega might use these for menus
                ];

                actionSelectors.forEach((selector) => {
                    const elements = el.querySelectorAll(selector);
                    elements.forEach((element) => {
                        // Check if it looks like a Vega action menu (three dots, export, etc)
                        const text = element.textContent || '';
                        if (
                            text.includes('\u22EF') ||
                            text.includes('...') ||
                            text.includes('Export') ||
                            element.getAttribute('aria-label')?.includes('Export') ||
                            element.getAttribute('title')?.includes('Export')
                        ) {
                            element.remove();
                        }
                    });
                });
            }

            // Fix Markmap containers using centralized styles
            if (el.classList.contains('markmap-container')) {
                applyVisualizationStyles(el, 'markmap', 'pdf', true);

                // Force override inline styles - let SVG determine size
                el.style.setProperty('height', 'auto', 'important');
                el.style.setProperty('min-height', 'auto', 'important');
                el.style.setProperty('max-height', 'none', 'important');

                // Find the SVG inside and ensure it can size properly
                const svg = el.querySelector('svg') as SVGElement;
                if (svg) {
                    // Let SVG determine its own space requirements
                    svg.style.setProperty('width', '100%', 'important');
                    svg.style.setProperty('height', 'auto', 'important');
                    svg.style.setProperty('max-height', 'none', 'important');

                    // Ensure viewBox preserves aspect ratio if present
                    if (
                        !svg.getAttribute('viewBox') &&
                        svg.getAttribute('width') &&
                        svg.getAttribute('height')
                    ) {
                        const width = svg.getAttribute('width');
                        const height = svg.getAttribute('height');
                        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
                        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                    }
                }
            }

            // Fix Mermaid diagrams using centralized styles
            if (el.classList.contains('mermaid')) {
                applyVisualizationStyles(el, 'mermaid', 'pdf', true);
            }

            // Fix tables using centralized styles
            if (el.tagName === 'TABLE') {
                applyVisualizationStyles(el, 'table', 'pdf', true);
            }

            // Fix code blocks using centralized styles
            if (el.tagName === 'PRE' || el.classList.contains('code-block')) {
                applyVisualizationStyles(el, 'codeBlock', 'pdf', true);
            }

            // Fix CodeBlockWithCopy wrapper elements that contain visualizations
            if (el.classList.contains('position-relative')) {
                const hasVisualization =
                    el.querySelector('.markmap-container') ||
                    el.querySelector('.vega-lite-container') ||
                    el.querySelector('.vega-container') ||
                    el.querySelector('.mermaid');

                if (hasVisualization) {
                    // Remove wrapper padding/margins that create unwanted space
                    el.style.setProperty('margin', '0', 'important');
                    el.style.setProperty('padding', '0', 'important');

                    // Remove the copy button from PDF export (it shouldn't be in PDF)
                    const copyButton = el.querySelector('button');
                    if (copyButton) {
                        copyButton.style.display = 'none';
                    }
                }
            }
        });
    }

    private static insertSmartPageBreaks(container: HTMLElement): void {
        // Calculate page boundaries based on A4 dimensions (accounting for margins and header)
        const containerRect = container.getBoundingClientRect();
        const headerHeight = 80; // Approximate header + margin height
        const usablePageHeight = (this.A4_HEIGHT - 30) * (this.A4_WIDTH_PX / this.A4_WIDTH); // Convert mm to px accounting for margins

        // Calculate where page breaks would naturally occur
        const pageBreakPositions: number[] = [];
        let currentPageEnd = headerHeight + usablePageHeight;

        // Calculate all page boundaries
        while (currentPageEnd < containerRect.height + 2000) {
            // Add buffer for potential content
            pageBreakPositions.push(currentPageEnd);
            currentPageEnd += usablePageHeight;
        }

        // Find all visualization elements using centralized selectors
        const visualizationSelectors = VISUALIZATION_SELECTORS.all;

        const visualizationElements: HTMLElement[] = [];
        visualizationSelectors.forEach((selector) => {
            const elements = container.querySelectorAll(selector) as NodeListOf<HTMLElement>;
            visualizationElements.push(...Array.from(elements));
        });

        // Process each visualization to check if it crosses page boundaries
        visualizationElements.forEach((element) => {
            const elementRect = element.getBoundingClientRect();
            const containerTop = container.getBoundingClientRect().top;

            // Get element position relative to container
            const elementTop = elementRect.top - containerTop;
            const elementBottom = elementTop + elementRect.height;

            // Check if element crosses any page boundary
            for (const pageBreakPosition of pageBreakPositions) {
                // If element starts before page break and ends after it, it crosses the boundary
                if (elementTop < pageBreakPosition && elementBottom > pageBreakPosition) {
                    // Calculate exactly how much space we need to push element to next page
                    const spaceToNextPage = pageBreakPosition - elementTop;

                    // Only add spacer if it's reasonable (not too much wasted space)
                    if (spaceToNextPage < usablePageHeight * 0.6) {
                        // Don't waste more than 60% of a page
                        const pageBreak = document.createElement('div');
                        pageBreak.className = 'pdf-page-break-spacer';
                        pageBreak.style.cssText = `
                            height: ${spaceToNextPage + 10}px;
                            width: 100%;
                            background: transparent;
                            margin: 0;
                            padding: 0;
                            page-break-after: avoid;
                        `;

                        // Insert the spacer before the visualization
                        element.parentNode?.insertBefore(pageBreak, element);

                        // Ensure the visualization itself has proper styling
                        element.style.pageBreakInside = 'avoid';
                        element.style.breakInside = 'avoid';

                        // Only handle the first crossing for this element
                        break;
                    }
                }
            }
        });
    }

    private static async addA4CanvasToPDF(
        pdf: jsPDF,
        canvas: HTMLCanvasElement,
        template?: Required<PDFTemplate>,
    ): Promise<void> {
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // Convert pixels to mm (at 2x scale)
        const imgWidthMM = this.A4_WIDTH;

        // Calculate page dimensions
        const baseMaxHeightPerPage = this.A4_HEIGHT - 20; // Leave some margin at bottom
        const baseMaxHeightPerPagePx = (baseMaxHeightPerPage / 0.264583) * 2; // Convert mm to px at 2x scale

        // First, calculate total pages by simulating the page splitting
        let tempY = 0;
        let totalPages = 0;
        while (tempY < canvasHeight) {
            const topMarginMM = totalPages > 0 ? 15 : 0;
            const maxHeightPerPage = baseMaxHeightPerPage - topMarginMM;
            const maxHeightPerPagePx = (maxHeightPerPage / 0.264583) * 2;
            const remainingHeight = Math.min(maxHeightPerPagePx, canvasHeight - tempY);
            tempY += remainingHeight;
            totalPages++;
        }

        let currentY = 0;
        let pageCount = 0;

        while (currentY < canvasHeight) {
            if (pageCount > 0) {
                pdf.addPage();
            }

            // Calculate how much we can fit on this page
            // For pages after the first, account for top margin
            const topMarginMM = pageCount > 0 ? 15 : 0;
            const maxHeightPerPage = baseMaxHeightPerPage - topMarginMM;
            const maxHeightPerPagePx = (maxHeightPerPage / 0.264583) * 2;

            let remainingHeight = Math.min(maxHeightPerPagePx, canvasHeight - currentY);

            // Create canvas for this page
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasWidth;
            tempCanvas.height = remainingHeight;

            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
                tempCtx.drawImage(
                    canvas,
                    0,
                    currentY,
                    canvasWidth,
                    remainingHeight,
                    0,
                    0,
                    canvasWidth,
                    remainingHeight,
                );

                const imgData = tempCanvas.toDataURL('image/jpeg', 0.95);
                const pageHeightMM = (remainingHeight * 0.264583) / 2;

                // Add top margin for pages after the first one
                const maxAllowedHeight = this.A4_HEIGHT - topMarginMM - 10; // Reserve space for bottom margin too
                const finalPageHeight = Math.min(pageHeightMM, maxAllowedHeight);

                pdf.addImage(imgData, 'JPEG', 0, topMarginMM, imgWidthMM, finalPageHeight);
            }

            // Add footer with page numbers if template is provided and enabled
            if (template?.showPageNumbers && template?.footerText) {
                this.addPageFooter(pdf, pageCount + 1, totalPages, template);
            }

            currentY += remainingHeight;
            pageCount++;
        }
    }

    /**
     * Add footer with page numbers to the current page
     */
    private static addPageFooter(
        pdf: jsPDF,
        currentPage: number,
        totalPages: number,
        template: Required<PDFTemplate>,
    ): void {
        // Replace placeholders in footer text
        const footerText = template.footerText
            .replace('{{pageNumber}}', currentPage.toString())
            .replace('{{totalPages}}', totalPages.toString());

        // Set font for footer
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(template.fontSize - 2);
        pdf.setTextColor(template.secondaryColor);

        // Calculate footer position
        const pageHeight = this.A4_HEIGHT;
        const footerY = pageHeight - 15; // 15mm from bottom
        const pageWidth = this.A4_WIDTH;

        // Center the footer text
        const textWidth = pdf.getTextWidth(footerText);
        const footerX = (pageWidth - textWidth) / 2;

        // Add the footer text
        pdf.text(footerText, footerX, footerY);
    }

    /**
     * Export multiple message elements to a single PDF
     */
    static async exportMultipleMessagesToPdf(
        params: {
            messageElements?: HTMLElement[];
            markdownContents?: string[];
        },
        options: ExportOptions = {},
    ): Promise<void> {
        const {
            filename = `bulk-export-${params.messageElements!.length}-messages-${new Date().toISOString().split('T')[0]}.pdf`,
            onProgress,
            template,
        } = options;

        try {
            onProgress?.(5);

            // Get merged template with defaults
            const mergedTemplate = await PDFTemplateManager.getMergedTemplate(template);

            // Create combined container with all message elements
            const combinedContainer = await this.createCombinedMessageElementsContainer(
                params.messageElements!,
                template,
            );
            onProgress?.(30);

            // Wait for visualizations to render
            await this.waitForVisualizationsToRender(combinedContainer);
            onProgress?.(40);

            // Capture the combined container
            const canvas = await html2canvas(combinedContainer, {
                scale: 2, // High quality
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                width: this.A4_WIDTH_PX,
                height: combinedContainer.offsetHeight,
            });
            onProgress?.(70);

            // Create PDF with proper A4 dimensions
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [this.A4_WIDTH, this.A4_HEIGHT],
            });

            await this.addA4CanvasToPDF(pdf, canvas, mergedTemplate);
            onProgress?.(90);

            // Clean up temporary container
            document.body.removeChild(combinedContainer);

            // Download PDF
            pdf.save(filename);
            onProgress?.(100);
        } catch (error) {
            console.error('Multiple message elements PDF export error:', error);
            throw new Error(`Failed to export multiple message elements PDF: ${(error as Error).message}`);
        }
    }

    /**
     * Create a combined container with multiple message elements
     */
    private static async createCombinedMessageElementsContainer(
        messageElements: HTMLElement[],
        template?: PDFTemplate,
    ): Promise<HTMLElement> {
        // Get merged template with defaults
        const mergedTemplate = await PDFTemplateManager.getMergedTemplate(template);

        // Create a temporary container with A4 dimensions
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: -9999px;
            left: -9999px;
            width: ${this.A4_WIDTH_PX}px;
            background: white;
            box-sizing: border-box;
            overflow: visible;
        `;

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.style.cssText = `
            width: 100%;
            overflow: visible;
        `;

        // Process each message element
        messageElements.forEach((element, index) => {
            // Clone the original element (this contains the fully rendered content)
            const clonedElement = element.cloneNode(true) as HTMLElement;

            // Fix canvas elements that don't clone their visual content
            this.copyCanvasContent(element, clonedElement);

            // Create message wrapper
            const messageWrapper = document.createElement('div');
            messageWrapper.style.cssText = `
                margin-bottom: ${index === messageElements.length - 1 ? '0' : '40px'};
                padding: 20px;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                background: #fafafa;
            `;

            // Add message header
            const messageHeader = document.createElement('div');
            messageHeader.style.cssText = `
                margin-bottom: 16px;
                padding-bottom: 8px;
                border-bottom: 1px solid #ddd;
                color: ${mergedTemplate.primaryColor};
                font-weight: 600;
                font-size: ${mergedTemplate.fontSize + 2}px;
            `;
            messageHeader.textContent = `Message ${index + 1} of ${messageElements.length}`;

            // Remove export controls from cloned element (they shouldn't appear in PDF)
            this.removeExportControls(clonedElement);

            // Apply A4-specific styles to cloned content
            this.applyA4Styling(clonedElement);

            messageWrapper.appendChild(messageHeader);
            messageWrapper.appendChild(clonedElement);
            contentWrapper.appendChild(messageWrapper);
        });

        container.appendChild(contentWrapper);

        // Add to DOM temporarily for rendering
        document.body.appendChild(container);

        // Wait for initial layout to settle
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Apply template styling (this will modify the container and add header/footer/etc)
        await PDFTemplateManager.applyTemplate(container, mergedTemplate);

        // Wait for template to be applied
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Now that DOM is rendered with template, insert smart page breaks based on actual positions
        this.insertSmartPageBreaks(container);

        // Wait for layout to re-settle after inserting spacers
        await new Promise((resolve) => setTimeout(resolve, 100));

        return container;
    }

    private static downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}
