// Buffer polyfill is handled by the build system
// No manual polyfill needed for browser environment

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
    ImageRun,
    ExternalHyperlink,
    PageBreak,
    Header,
    Footer,
    PageNumber,
    NumberFormat,
    LevelFormat,
    convertInchesToTwip,
    ISectionPropertiesOptions,
} from 'docx';
import { DocxTemplate } from './docxTemplateManager.js';
import { DocxImageHelper } from './docxImageHelper.js';

export interface DocxExportOptions {
    filename?: string;
    onProgress?: (progress: number) => void;
    template?: DocxTemplate;
}

export class DocxExportService {
    /**
     * Insert a single image into a DOCX document from various sources
     */
    static async insertImageToDocx(
        imageSource: File | string | HTMLCanvasElement | Blob,
        filename: string = `image-document-${new Date().toISOString().split('T')[0]}.docx`,
        options: {
            title?: string;
            caption?: string;
            width?: number;
            height?: number;
            template?: DocxTemplate;
        } = {},
    ): Promise<void> {
        try {
            const { title, caption, width, height, template } = options;

            console.log('Creating DOCX with image insertion...');

            // Insert image using DocxImageHelper
            let imageResult;
            if (imageSource instanceof File) {
                imageResult = await DocxImageHelper.insertImageFromFile(imageSource, {
                    width,
                    height,
                });
            } else if (typeof imageSource === 'string') {
                if (imageSource.startsWith('data:')) {
                    imageResult = await DocxImageHelper.insertImageFromDataUrl(imageSource, {
                        width,
                        height,
                    });
                } else {
                    imageResult = await DocxImageHelper.insertImageFromUrl(imageSource, {
                        width,
                        height,
                    });
                }
            } else if (imageSource instanceof HTMLCanvasElement) {
                imageResult = await DocxImageHelper.insertImageFromCanvas(imageSource, {
                    width,
                    height,
                });
            } else if (imageSource instanceof Blob) {
                imageResult = await DocxImageHelper.insertImageFromBlob(imageSource, {
                    width,
                    height,
                });
            } else {
                throw new Error('Unsupported image source type');
            }

            const sections: (Paragraph | Table)[] = [];

            // Add title if provided
            if (title) {
                sections.push(
                    new Paragraph({
                        text: title,
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 },
                    }),
                );
            }

            // Add image
            sections.push(
                new Paragraph({
                    children: [imageResult.imageRun],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 200 },
                }),
            );

            // Add caption if provided
            if (caption) {
                sections.push(
                    new Paragraph({
                        children: [new TextRun({ text: caption, italics: true })],
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 100, after: 200 },
                    }),
                );
            }

            // Add image details
            sections.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `Image Details: ${imageResult.actualWidth} x ${imageResult.actualHeight} pixels, ${imageResult.format.toUpperCase()}, ${(imageResult.size / 1024).toFixed(1)} KB`,
                            color: '666666',
                        }),
                    ],
                    alignment: AlignmentType.LEFT,
                    spacing: { before: 400 },
                }),
            );

            // Create document
            const doc = new Document({
                sections: [
                    {
                        properties: this.getDocumentProperties(template),
                        headers: template ? this.createHeaders(template) : undefined,
                        footers: template ? this.createFooters(template) : undefined,
                        children: sections,
                    },
                ],
                styles: this.getDocumentStyles(template),
            });

            // Generate and download
            const blob = await Packer.toBlob(doc);
            this.downloadBlob(blob, filename);

            console.log('DOCX with image created successfully');
        } catch (error) {
            console.error('Failed to create DOCX with image:', error);
            throw new Error(`Failed to create DOCX with image: ${(error as Error).message}`);
        }
    }

    /**
     * Export a single message element to DOCX format
     */
    static async exportMessageToDocx(
        params: {
            messageElement?: HTMLElement;
            markdownContent?: string;
        },
        options: DocxExportOptions = {},
    ): Promise<void> {
        const {
            filename = `message-export-${new Date().toISOString().split('T')[0]}.docx`,
            onProgress,
            template,
        } = options;

        try {
            onProgress?.(10);

            // Process the message content
            const sections = await this.processMessageElement(params.messageElement!, template);
            onProgress?.(40);

            // Create the document
            const doc = new Document({
                sections: [
                    {
                        properties: this.getDocumentProperties(template),
                        headers: template ? this.createHeaders(template) : undefined,
                        footers: template ? this.createFooters(template) : undefined,
                        children: sections,
                    },
                ],
                styles: this.getDocumentStyles(template),
                numbering: this.getNumberingConfig(),
            });
            onProgress?.(70);

            // Generate and download the document
            const blob = await Packer.toBlob(doc);
            onProgress?.(90);

            this.downloadBlob(blob, filename);
            onProgress?.(100);
        } catch (error) {
            console.error('DOCX export error:', error);
            throw new Error(`Failed to export DOCX: ${(error as Error).message}`);
        }
    }

    /**
     * Export multiple message elements to a single DOCX file
     */
    static async exportMultipleMessageElementsToDocx(
        params: {
            messageElements?: HTMLElement[];
            markdownContents?: string[];
        },
        options: DocxExportOptions = {},
    ): Promise<void> {
        const {
            filename = `bulk-export-${params.messageElements!.length}-messages-${new Date().toISOString().split('T')[0]}.docx`,
            onProgress,
            template,
        } = options;

        try {
            onProgress?.(5);

            const allSections: (Paragraph | Table)[] = [];

            // Process each message element
            for (let i = 0; i < params.messageElements!.length; i++) {
                const element = params.messageElements![i];

                // Add message header
                allSections.push(
                    new Paragraph({
                        text: `Message ${i + 1} of ${params.messageElements!.length}`,
                        heading: HeadingLevel.HEADING_2,
                        spacing: { before: 400, after: 200 },
                    }),
                );

                // Process message content
                const sections = await this.processMessageElement(element, template);
                allSections.push(...sections);

                // Add page break between messages (except for the last one)
                if (i < params.messageElements!.length - 1) {
                    allSections.push(
                        new Paragraph({
                            children: [new PageBreak()],
                        }),
                    );
                }

                onProgress?.(30 + (40 * (i + 1)) / params.messageElements!.length);
            }

            // Create the document
            const doc = new Document({
                sections: [
                    {
                        properties: this.getDocumentProperties(template),
                        headers: template ? this.createHeaders(template) : undefined,
                        footers: template ? this.createFooters(template) : undefined,
                        children: allSections,
                    },
                ],
                styles: this.getDocumentStyles(template),
                numbering: this.getNumberingConfig(),
            });
            onProgress?.(80);

            // Generate and download the document
            const blob = await Packer.toBlob(doc);
            onProgress?.(95);

            this.downloadBlob(blob, filename);
            onProgress?.(100);
        } catch (error) {
            console.error('Multiple messages DOCX export error:', error);
            throw new Error(`Failed to export multiple messages to DOCX: ${(error as Error).message}`);
        }
    }

    /**
     * Process a message element and convert it to DOCX elements
     */
    private static async processMessageElement(
        element: HTMLElement,
        template?: DocxTemplate,
    ): Promise<(Paragraph | Table)[]> {
        const result: (Paragraph | Table)[] = [];

        console.log('Processing message element for DOCX export');

        // Mark original elements with unique IDs before cloning
        const originalVisualizations = element.querySelectorAll('canvas, svg');
        originalVisualizations.forEach((element, index) => {
            element.setAttribute('data-viz-id', `viz_${index}`);
        });

        // Clone element to work with copy and preserve original (viz IDs will be copied)
        const clonedElement = element.cloneNode(true) as HTMLElement;

        // Remove export controls if present from clone (dropdown buttons)
        const exportControls = clonedElement.querySelectorAll('.dropdown, .btn-group');
        exportControls.forEach((control) => {
            // Only remove if it contains export-related elements
            if (control.querySelector('[title*="Export"], [title*="export"]')) {
                control.remove();
            }
        });

        // Wait for visualizations to render on original element
        await this.waitForVisualizationsToRender(element);

        // Remove visualization elements from cloned element to prevent garbled text
        this.removeVisualizationsFromClone(clonedElement);

        // Process visualizations from original element and get image map
        const imageMap = await this.processVisualizations(element);

        // Process text content with image placeholders
        await this.processMarkdownContent(clonedElement, result, imageMap);

        return result;
    }

    /**
     * Remove visualization elements from cloned element to prevent garbled text
     */
    private static removeVisualizationsFromClone(clonedElement: HTMLElement): void {
        console.log('Removing visualization elements from cloned element...');

        // Process all visualization elements in document order (they already have viz IDs from cloning)
        const visualizations = clonedElement.querySelectorAll('canvas, svg');
        console.log(`Found ${visualizations.length} canvas/svg elements in cloned element`);

        visualizations.forEach((element) => {
            const tagName = element.tagName.toUpperCase();
            console.log(`Processing element with tagName: ${tagName}`);

            // Apply same filtering logic as processVisualizations to ensure counts match
            if (tagName === 'CANVAS') {
                const canvas = element as HTMLCanvasElement;
                // Skip tiny canvases (same logic as processVisualizations)
                // Note: cloned canvases may have 0 dimensions, so we always process them
                console.log(`Canvas dimensions in clone: ${canvas.width}x${canvas.height}`);
            } else if (tagName === 'SVG') {
                const svg = element as SVGSVGElement;
                // Check if this is a small SVG that would be skipped in processVisualizations
                // Use attributes since getBoundingClientRect won't work on unattached elements
                const widthAttr = svg.getAttribute('width');
                const heightAttr = svg.getAttribute('height');
                const viewBox = svg.getAttribute('viewBox');

                // Try to determine if this is a small icon
                const classList = svg.classList.toString();
                if (classList.includes('bi-') || classList.includes('icon')) {
                    console.log(`Skipping icon SVG`);
                    return;
                }

                // Check explicit small dimensions
                if (
                    (widthAttr && parseInt(widthAttr) < 100) ||
                    (heightAttr && parseInt(heightAttr) < 100)
                ) {
                    // But only skip if BOTH dimensions are small (matching processVisualizations logic)
                    if (
                        widthAttr &&
                        heightAttr &&
                        parseInt(widthAttr) < 100 &&
                        parseInt(heightAttr) < 100
                    ) {
                        console.log(`Skipping small SVG: ${widthAttr}x${heightAttr}`);
                        return;
                    }
                }
            }

            // Replace element with placeholder using its existing viz ID
            const vizId = element.getAttribute('data-viz-id');
            if (!vizId) {
                console.warn(`No viz ID found for ${tagName} element, skipping`);
                return;
            }
            console.log(`Replacing ${tagName.toLowerCase()} element with placeholder for ${vizId}`);
            const placeholder = document.createElement('p');
            placeholder.textContent = ''; // Empty text - we only need the data attribute
            placeholder.setAttribute('data-image-placeholder', vizId);
            element.parentNode?.replaceChild(placeholder, element);
        });

        console.log('Visualization elements replaced with placeholders');
    }

    /**
     * Wait for visualizations to render
     */
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
        const vegaElements = element.querySelectorAll('.vega-lite-container, .vega-container');
        if (vegaElements.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // Additional wait for any remaining renders
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    /**
     * Process visualizations by finding canvas and SVG elements and converting them to DOCX images
     */
    private static async processVisualizations(
        element: HTMLElement,
    ): Promise<Map<string, ImageRun>> {
        console.log('Finding canvas and SVG elements for DOCX export...');

        const imageMap = new Map<string, ImageRun>();

        // Process all visualization elements in document order
        const visualizations = element.querySelectorAll('canvas, svg');

        console.log(`Found ${visualizations.length} visualization elements`);

        for (const vizElement of visualizations) {
            try {
                const tagName = vizElement.tagName.toUpperCase();
                if (tagName === 'CANVAS') {
                    const canvas = vizElement as HTMLCanvasElement;

                    // Skip tiny or invalid canvases
                    if (canvas.width < 50 || canvas.height < 50) {
                        console.log(`Skipping small canvas: ${canvas.width}x${canvas.height}`);
                        continue;
                    }

                    console.log(`Processing canvas: ${canvas.width}x${canvas.height}`);

                    // Use DocxImageHelper to convert canvas to DOCX image
                    const imageResult = await DocxImageHelper.insertImageFromCanvas(canvas, {
                        maxWidth: 600,
                        maxHeight: 800,
                        maintainAspectRatio: true,
                    });

                    // Store image with viz ID
                    const vizId = vizElement.getAttribute('data-viz-id');
                    if (vizId) {
                        imageMap.set(vizId, imageResult.imageRun);
                    }

                    console.log(
                        `Successfully processed canvas image: ${imageResult.actualWidth}x${imageResult.actualHeight}, ${(imageResult.size / 1024).toFixed(1)}KB`,
                    );
                } else if (tagName === 'SVG') {
                    const svg = vizElement as SVGSVGElement;

                    // Skip tiny SVGs or those that are likely icons
                    const rect = svg.getBoundingClientRect();
                    const width = rect.width || svg.width.baseVal?.value || 0;
                    const height = rect.height || svg.height.baseVal?.value || 0;

                    if (!(width > 100 || height > 100)) {
                        console.log(`Skipping small SVG: ${width}x${height}`);
                        continue;
                    }

                    console.log(`Processing SVG: ${width}x${height}`);

                    // Try to convert SVG to ImageRun
                    try {
                        const imageResult = await DocxImageHelper.insertImageFromSVG(svg, {
                            maxWidth: 600,
                            maxHeight: 800,
                            maintainAspectRatio: true,
                        });

                        // Store image with viz ID
                        const vizId = vizElement.getAttribute('data-viz-id');
                        if (vizId) {
                            imageMap.set(vizId, imageResult.imageRun);
                        }

                        console.log(
                            `Successfully processed SVG image: ${imageResult.actualWidth}x${imageResult.actualHeight}, ${(imageResult.size / 1024).toFixed(1)}KB`,
                        );
                    } catch (svgError) {
                        console.log(`SVG conversion failed, skipping: ${(svgError as Error).message}`);
                        // Continue with other visualizations
                    }
                }
            } catch (error) {
                console.error(`Failed to process ${vizElement.tagName}:`, (error as Error).message);
            }
        }

        console.log(`Visualization processing complete: ${imageMap.size} images collected`);
        return imageMap;
    }

    /**
     * Process markdown content and convert to DOCX elements
     */
    private static async processMarkdownContent(
        element: HTMLElement,
        result: (Paragraph | Table)[],
        imageMap?: Map<string, ImageRun>,
    ): Promise<void> {
        // Debug: Check for placeholder elements
        const placeholders = element.querySelectorAll('[data-image-placeholder]');
        console.log(
            `Found ${placeholders.length} placeholder elements with data-image-placeholder`,
        );
        placeholders.forEach((p) => {
            console.log(
                `Placeholder: ${p.getAttribute('data-image-placeholder')}, tagName: ${p.tagName}`,
            );
        });

        // Process different types of content
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null);

        let node: Node | null;
        const processedNodes = new Set<Node>();

        while ((node = walker.nextNode())) {
            const el = node as HTMLElement;

            // Skip if already processed
            if (processedNodes.has(el)) continue;

            // Skip processed visualizations
            if (
                el.textContent === '[VISUALIZATION_PROCESSED]' ||
                el.innerHTML === '[VISUALIZATION_PROCESSED]'
            ) {
                continue;
            }

            // Skip if parent contains visualization placeholder
            if (el.closest('[VISUALIZATION_PROCESSED]')) {
                continue;
            }

            // Process based on element type
            if (el.tagName.match(/^H[1-6]$/)) {
                result.push(this.createHeading(el));
                processedNodes.add(el);
            } else if (el.tagName === 'P') {
                // Check if paragraph is an image placeholder
                const placeholderId = el.getAttribute('data-image-placeholder');
                if (placeholderId) {
                    console.log(`Found P element with placeholder: ${placeholderId}`);
                    if (imageMap) {
                        const imageRun = imageMap.get(placeholderId);
                        console.log(
                            `Looking for image in map: ${placeholderId}, found: ${imageRun ? 'YES' : 'NO'}`,
                        );
                        if (imageRun) {
                            result.push(
                                new Paragraph({
                                    children: [imageRun],
                                    alignment: AlignmentType.CENTER,
                                    spacing: { before: 200, after: 200 },
                                }),
                            );
                        }
                    }
                    // Skip this placeholder element completely - don't process as text
                    processedNodes.add(el);
                    continue;
                }

                const paragraph = this.createParagraph(el);
                if (paragraph) {
                    result.push(paragraph);
                    processedNodes.add(el);
                }
            } else if (el.tagName === 'UL' || el.tagName === 'OL') {
                result.push(...this.createList(el));
                processedNodes.add(el);
                // Mark list items as processed
                el.querySelectorAll('li').forEach((li) => processedNodes.add(li));
            } else if (el.tagName === 'TABLE') {
                const table = this.createTable(el);
                if (table) {
                    result.push(table);
                    processedNodes.add(el);
                    // Mark table elements as processed
                    el.querySelectorAll('tr, td, th').forEach((cell) => processedNodes.add(cell));
                }
            } else if (el.tagName === 'PRE' || el.classList.contains('code-block')) {
                // Skip visualization code blocks
                const content = el.textContent?.toLowerCase() || '';
                if (
                    content.includes('```vega') ||
                    content.includes('```markmap') ||
                    content.includes('```mermaid') ||
                    content.includes('"$schema"') || // Vega schema
                    content.includes('flowchart') ||
                    content.includes('gantt')
                ) {
                    // Skip - this is visualization code
                    continue;
                }
                // Process regular code blocks
                result.push(this.createCodeBlock(el));
                processedNodes.add(el);
            } else if (el.tagName === 'BLOCKQUOTE') {
                result.push(this.createBlockquote(el));
                processedNodes.add(el);
            }
        }
    }

    /**
     * Create a heading paragraph
     */
    private static createHeading(element: HTMLElement): Paragraph {
        const level = parseInt(element.tagName.charAt(1));
        const headingLevel = [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4,
            HeadingLevel.HEADING_5,
            HeadingLevel.HEADING_6,
        ][level - 1];

        return new Paragraph({
            text: element.textContent || '',
            heading: headingLevel,
            spacing: { before: 240, after: 120 },
        });
    }

    /**
     * Create a regular paragraph with inline formatting
     */
    private static createParagraph(element: HTMLElement): Paragraph | null {
        const children = this.processInlineElements(element);

        if (children.length === 0) return null;

        return new Paragraph({
            children,
            spacing: { after: 120 },
        });
    }

    /**
     * Process inline elements (bold, italic, links, etc.)
     */
    private static processInlineElements(element: HTMLElement): (TextRun | ExternalHyperlink)[] {
        const result: (TextRun | ExternalHyperlink)[] = [];

        const processNode = (node: Node, isBold = false, isItalic = false) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || '';
                if (text.trim()) {
                    result.push(
                        new TextRun({
                            text,
                            bold: isBold,
                            italics: isItalic,
                        }),
                    );
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                const newBold = isBold || el.tagName === 'STRONG' || el.tagName === 'B';
                const newItalic = isItalic || el.tagName === 'EM' || el.tagName === 'I';

                if (el.tagName === 'A' && el.hasAttribute('href')) {
                    result.push(
                        new ExternalHyperlink({
                            link: el.getAttribute('href') || '',
                            children: [
                                new TextRun({
                                    text: el.textContent || '',
                                    bold: newBold,
                                    italics: newItalic,
                                    color: '0563C1',
                                    underline: {},
                                }),
                            ],
                        }),
                    );
                } else if (el.tagName === 'CODE' && el.parentElement?.tagName !== 'PRE') {
                    result.push(
                        new TextRun({
                            text: el.textContent || '',
                            font: 'Courier New',
                            color: 'DD4A68',
                        }),
                    );
                } else {
                    for (const child of el.childNodes) {
                        processNode(child, newBold, newItalic);
                    }
                }
            }
        };

        for (const child of element.childNodes) {
            processNode(child);
        }

        return result;
    }

    /**
     * Create list items
     */
    private static createList(element: HTMLElement): Paragraph[] {
        const paragraphs: Paragraph[] = [];
        const isOrdered = element.tagName === 'OL';
        const items = element.querySelectorAll('li');

        items.forEach((item, index) => {
            paragraphs.push(
                new Paragraph({
                    children: this.processInlineElements(item as HTMLElement),
                    bullet: isOrdered
                        ? {
                              level: 0,
                          }
                        : {
                              level: 0,
                          },
                    spacing: { after: 60 },
                }),
            );
        });

        return paragraphs;
    }

    /**
     * Create a table from HTML table element
     */
    private static createTable(element: HTMLElement): Table | null {
        const rows = element.querySelectorAll('tr');
        if (rows.length === 0) return null;

        const tableRows: TableRow[] = [];

        rows.forEach((row) => {
            const cells = row.querySelectorAll('td, th');
            const tableCells: TableCell[] = [];

            cells.forEach((cell) => {
                const cellElement = cell as HTMLElement;
                tableCells.push(
                    new TableCell({
                        children: [
                            new Paragraph({
                                children: this.processInlineElements(cellElement),
                                alignment: AlignmentType.LEFT,
                            }),
                        ],
                        width: {
                            size: 100 / cells.length,
                            type: WidthType.PERCENTAGE,
                        },
                        shading:
                            cell.tagName === 'TH'
                                ? {
                                      fill: 'E7E6E6',
                                  }
                                : undefined,
                    }),
                );
            });

            tableRows.push(
                new TableRow({
                    children: tableCells,
                }),
            );
        });

        return new Table({
            rows: tableRows,
            width: {
                size: 100,
                type: WidthType.PERCENTAGE,
            },
            borders: {
                top: { style: BorderStyle.SINGLE, size: 1 },
                bottom: { style: BorderStyle.SINGLE, size: 1 },
                left: { style: BorderStyle.SINGLE, size: 1 },
                right: { style: BorderStyle.SINGLE, size: 1 },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
                insideVertical: { style: BorderStyle.SINGLE, size: 1 },
            },
        });
    }

    /**
     * Create a code block
     */
    private static createCodeBlock(element: HTMLElement): Paragraph {
        return new Paragraph({
            children: [
                new TextRun({
                    text: element.textContent || '',
                    font: 'Courier New',
                    size: 20,
                }),
            ],
            spacing: { before: 120, after: 120 },
            indent: { left: convertInchesToTwip(0.5) },
            shading: {
                fill: 'F5F5F5',
            },
        });
    }

    /**
     * Create a blockquote
     */
    private static createBlockquote(element: HTMLElement): Paragraph {
        // Wrap inline elements with italic styling for blockquote
        const inlineElements = this.processInlineElements(element);
        const italicChildren = inlineElements.map((child) => {
            if (child instanceof TextRun) {
                return new TextRun({
                    text: (child as any).root?.[1]?.text || '',
                    italics: true,
                    color: '666666',
                });
            }
            return child;
        });
        return new Paragraph({
            children: italicChildren,
            spacing: { before: 120, after: 120 },
            indent: { left: convertInchesToTwip(0.5) },
        });
    }

    /**
     * Get document properties based on template
     */
    private static getDocumentProperties(template?: DocxTemplate): ISectionPropertiesOptions {
        return {
            page: {
                margin: {
                    top: convertInchesToTwip(template?.margins?.top || 1),
                    right: convertInchesToTwip(template?.margins?.right || 1),
                    bottom: convertInchesToTwip(template?.margins?.bottom || 1),
                    left: convertInchesToTwip(template?.margins?.left || 1),
                },
            },
        };
    }

    /**
     * Create document headers
     */
    private static createHeaders(template: DocxTemplate): { default: Header } {
        const children: Paragraph[] = [];

        if (template.headerText) {
            children.push(
                new Paragraph({
                    text: template.headerText,
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 200 },
                }),
            );
        }

        return {
            default: new Header({
                children,
            }),
        };
    }

    /**
     * Create document footers
     */
    private static createFooters(template: DocxTemplate): { default: Footer } {
        const children: Paragraph[] = [];

        if (template.showPageNumbers) {
            children.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun('Page '),
                        new TextRun({
                            children: [PageNumber.CURRENT],
                        }),
                        new TextRun(' of '),
                        new TextRun({
                            children: [PageNumber.TOTAL_PAGES],
                        }),
                    ],
                }),
            );
        }

        if (template.footerText) {
            children.push(
                new Paragraph({
                    text: template.footerText,
                    alignment: AlignmentType.CENTER,
                }),
            );
        }

        return {
            default: new Footer({
                children,
            }),
        };
    }

    /**
     * Get document styles
     */
    private static getDocumentStyles(template?: DocxTemplate): any {
        return {
            default: {
                document: {
                    run: {
                        font: template?.fontFamily || 'Calibri',
                        size: (template?.fontSize || 11) * 2, // Half-points
                        color: template?.textColor || '000000',
                    },
                    paragraph: {
                        spacing: {
                            line: 276, // 1.15 line spacing
                        },
                    },
                },
                heading1: {
                    run: {
                        font: template?.headingFont || template?.fontFamily || 'Calibri',
                        size: 32,
                        bold: true,
                        color: template?.primaryColor || '2E74B5',
                    },
                },
                heading2: {
                    run: {
                        font: template?.headingFont || template?.fontFamily || 'Calibri',
                        size: 28,
                        bold: true,
                        color: template?.primaryColor || '2E74B5',
                    },
                },
                heading3: {
                    run: {
                        font: template?.headingFont || template?.fontFamily || 'Calibri',
                        size: 24,
                        bold: true,
                        color: template?.primaryColor || '2E74B5',
                    },
                },
            },
        };
    }

    /**
     * Get numbering configuration for lists
     */
    private static getNumberingConfig(): any {
        return {
            config: [
                {
                    reference: 'default-bullet',
                    levels: [
                        {
                            level: 0,
                            format: LevelFormat.BULLET,
                            text: '\u2022',
                            alignment: AlignmentType.LEFT,
                            style: {
                                paragraph: {
                                    indent: {
                                        left: convertInchesToTwip(0.5),
                                        hanging: convertInchesToTwip(0.25),
                                    },
                                },
                            },
                        },
                    ],
                },
                {
                    reference: 'default-numbering',
                    levels: [
                        {
                            level: 0,
                            format: LevelFormat.DECIMAL,
                            text: '%1.',
                            alignment: AlignmentType.LEFT,
                            style: {
                                paragraph: {
                                    indent: {
                                        left: convertInchesToTwip(0.5),
                                        hanging: convertInchesToTwip(0.25),
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        };
    }

    /**
     * Convert blob to base64
     */
    private static blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Download blob as file
     */
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
