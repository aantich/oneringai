import type { PDFTemplate } from './pdfExportService.js';

export class PDFTemplateManager {
    private static readonly DEFAULT_TEMPLATE: Required<PDFTemplate> = {
        // Header/Footer Configuration
        headerLogo: '',
        headerLogoWidth: 120,
        headerLogoHeight: 40,
        headerLogoPosition: 'left',
        headerText: '',
        footerText: 'Page {{pageNumber}} of {{totalPages}}',
        showPageNumbers: true,

        // Color Scheme
        primaryColor: '#242423',
        secondaryColor: '#666666',
        accentColor: '#767570',
        textColor: '#333333',

        // Typography
        fontFamily: 'Geist Variable, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        headingFont: 'Geist Variable, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
        headingScale: 1.5,

        // Layout & Spacing
        margins: {
            top: 80,
            right: 60,
            bottom: 80,
            left: 60,
        },
        headerHeight: 60,
        footerHeight: 40,

        // Branding
        companyName: 'hosea',
        companyTagline: '',
        documentTitle: 'Chat Export',

        // Watermark
        watermark: '',
        watermarkOpacity: 0.1,
        watermarkPosition: 'center',
        watermarkSize: 200,

        // Custom Styles
        customCSS: '',

        // Custom HTML
        prependHtml: '',
        appendHtml: '',

        // Theme
        theme: 'hosea',
    };

    /**
     * Get merged template with defaults
     */
    static async getMergedTemplate(template?: PDFTemplate): Promise<Required<PDFTemplate>> {
        if (!template) {
            return { ...this.DEFAULT_TEMPLATE };
        }

        // If theme is specified, apply predefined theme first
        let baseTemplate = { ...this.DEFAULT_TEMPLATE };
        if (template.theme && template.theme !== 'default') {
            const predefinedTheme = this.getPredefinedTheme(template.theme);
            baseTemplate = { ...baseTemplate, ...predefinedTheme };
        }

        // Merge margins properly
        const mergedMargins = {
            ...baseTemplate.margins,
            ...template.margins,
        };

        return {
            ...baseTemplate,
            ...template,
            margins: mergedMargins,
        };
    }

    /**
     * Get predefined theme configurations
     */
    static getPredefinedTheme(theme: string): Partial<PDFTemplate> {
        const themes: Record<string, Partial<PDFTemplate>> = {
            hosea: {
                primaryColor: '#242423',
                secondaryColor: '#666666',
                accentColor: '#767570',
                fontFamily:
                    'Geist Variable, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                companyName: 'hosea',
                companyTagline: '',
                headerLogo: '',
            },
            professional: {
                primaryColor: '#2c3e50',
                secondaryColor: '#7f8c8d',
                accentColor: '#3498db',
                fontFamily: 'Georgia, serif',
                companyName: '',
                companyTagline: '',
                headerLogo: '',
            },
            modern: {
                primaryColor: '#000000',
                secondaryColor: '#6c757d',
                accentColor: '#007bff',
                fontFamily: 'Helvetica, Arial, sans-serif',
                companyName: '',
                companyTagline: '',
                headerLogo: '',
            },
            minimal: {
                primaryColor: '#333333',
                secondaryColor: '#999999',
                accentColor: '#000000',
                fontFamily: 'Helvetica, Arial, sans-serif',
                margins: { top: 100, right: 80, bottom: 100, left: 80 },
                companyName: '',
                companyTagline: '',
                headerLogo: '',
            },
        };

        return themes[theme] ?? {};
    }

    /**
     * Apply template to container
     */
    static async applyTemplate(container: HTMLElement, template: PDFTemplate): Promise<void> {
        const mergedTemplate = await this.getMergedTemplate(template);

        // Apply base container styles
        this.applyContainerStyles(container, mergedTemplate);

        // Create and inject custom styles
        this.injectStyles(container, mergedTemplate);

        // Add header if configured
        await this.addHeader(container, mergedTemplate);

        // Add footer placeholder
        this.addFooterSpacer(container, mergedTemplate);

        // Add watermark if configured
        this.addWatermark(container, mergedTemplate);
    }

    private static applyContainerStyles(
        container: HTMLElement,
        template: Required<PDFTemplate>,
    ): void {
        container.style.fontFamily = template.fontFamily;
        container.style.fontSize = `${template.fontSize}px`;
        container.style.color = template.textColor;
        container.style.paddingTop = `${template.margins.top}px`;
        container.style.paddingRight = `${template.margins.right}px`;
        container.style.paddingBottom = `${template.margins.bottom}px`;
        container.style.paddingLeft = `${template.margins.left}px`;
    }

    private static injectStyles(container: HTMLElement, template: Required<PDFTemplate>): void {
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            :root {
                --primary-color: ${template.primaryColor};
                --secondary-color: ${template.secondaryColor};
                --accent-color: ${template.accentColor};
                --text-color: ${template.textColor};
                --font-family: ${template.fontFamily};
                --heading-font: ${template.headingFont};
                --font-size: ${template.fontSize}px;
            }
            h1, h2, h3, h4, h5, h6 {
                font-family: var(--heading-font) !important;
                color: var(--primary-color) !important;
                font-weight: 600 !important;
            }
            h1 {
                font-size: ${template.fontSize * template.headingScale * 2}px !important;
                border-bottom: 2px solid var(--primary-color);
                padding-bottom: 8px;
                margin-bottom: 20px !important;
            }
            h2 {
                font-size: ${template.fontSize * template.headingScale * 1.6}px !important;
                color: var(--secondary-color) !important;
                margin-top: 24px !important;
                margin-bottom: 16px !important;
            }
            h3 {
                font-size: ${template.fontSize * template.headingScale * 1.3}px !important;
                margin-top: 20px !important;
                margin-bottom: 12px !important;
            }
            .markmap-container, .mermaid {
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 16px;
                margin: 24px 0;
                background: #fafafa;
            }
            table {
                border-collapse: collapse;
                border: 1px solid var(--secondary-color);
                margin: 20px 0;
            }
            table th {
                background-color: var(--primary-color);
                color: white;
                padding: 12px;
                font-weight: 600;
            }
            table td {
                padding: 10px 12px;
                border: 1px solid #ddd;
            }
            table tr:nth-child(even) {
                background-color: #f9f9f9;
            }
            pre, .code-block {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 4px;
                padding: 16px;
                font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
                font-size: ${template.fontSize - 2}px;
                margin: 16px 0;
            }
            a {
                color: var(--accent-color);
                text-decoration: none;
            }
            strong, b {
                color: var(--primary-color);
                font-weight: 600;
            }
            blockquote {
                border-left: 4px solid var(--accent-color);
                margin: 16px 0;
                padding-left: 16px;
                font-style: italic;
                color: var(--secondary-color);
            }
            ${template.customCSS}
        `;
        container.appendChild(styleEl);
    }

    private static async addHeader(
        container: HTMLElement,
        template: Required<PDFTemplate>,
    ): Promise<void> {
        if (!template.headerLogo && !template.headerText && !template.companyName) {
            return;
        }

        const header = document.createElement('div');
        header.className = 'pdf-template-header';
        header.style.cssText = `
            width: 100%;
            height: ${template.headerHeight}px;
            display: flex;
            flex-direction: column;
            margin-bottom: 20px;
        `;

        const headerContent = document.createElement('div');
        headerContent.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            flex-grow: 1;
        `;

        const logoSection = document.createElement('div');
        logoSection.style.cssText = `
            display: flex;
            align-items: center;
            gap: 16px;
        `;

        if (template.headerLogo) {
            const logo = await this.createLogoElement(template.headerLogo, template);
            logoSection.appendChild(logo);
        }

        if (template.companyName) {
            const companyInfo = document.createElement('div');
            companyInfo.style.cssText = `display: flex; flex-direction: column;`;

            const companyName = document.createElement('div');
            companyName.textContent = template.companyName;
            companyName.style.cssText = `
                font-weight: 700;
                font-size: ${template.fontSize + 4}px;
                color: ${template.primaryColor};
                line-height: 1.2;
            `;
            companyInfo.appendChild(companyName);

            if (template.companyTagline) {
                const tagline = document.createElement('div');
                tagline.textContent = template.companyTagline;
                tagline.style.cssText = `
                    font-size: ${template.fontSize - 2}px;
                    color: ${template.secondaryColor};
                    line-height: 1.2;
                `;
                companyInfo.appendChild(tagline);
            }

            logoSection.appendChild(companyInfo);
        }

        const textSection = document.createElement('div');
        textSection.style.cssText = `text-align: right; color: ${template.secondaryColor};`;

        if (template.documentTitle) {
            const title = document.createElement('div');
            title.textContent = template.documentTitle;
            title.style.cssText = `
                font-weight: 600;
                font-size: ${template.fontSize + 2}px;
                color: ${template.primaryColor};
                margin-bottom: 4px;
            `;
            textSection.appendChild(title);
        }

        const exportDate = document.createElement('div');
        exportDate.textContent = new Date().toLocaleString();
        exportDate.style.cssText = `font-size: ${template.fontSize - 2}px;`;
        textSection.appendChild(exportDate);

        if (template.headerText) {
            const additionalText = document.createElement('div');
            additionalText.textContent = template.headerText;
            additionalText.style.cssText = `font-size: ${template.fontSize - 1}px; margin-top: 4px;`;
            textSection.appendChild(additionalText);
        }

        headerContent.appendChild(logoSection);
        headerContent.appendChild(textSection);

        const separatorLine = document.createElement('div');
        separatorLine.style.cssText = `border-bottom: 2px solid ${template.primaryColor}; width: 100%;`;

        header.appendChild(headerContent);
        header.appendChild(separatorLine);

        container.insertBefore(header, container.firstChild);
    }

    private static async createLogoElement(
        logoSource: string,
        template: Required<PDFTemplate>,
    ): Promise<HTMLElement> {
        const logoContainer = document.createElement('div');
        logoContainer.style.cssText = `
            width: ${template.headerLogoWidth}px;
            height: ${template.headerLogoHeight}px;
            display: flex;
            align-items: center;
            justify-content: ${template.headerLogoPosition === 'center' ? 'center' : template.headerLogoPosition === 'right' ? 'flex-end' : 'flex-start'};
        `;

        if (logoSource.startsWith('data:') || logoSource.startsWith('http')) {
            const img = document.createElement('img');
            img.src = logoSource;
            img.style.cssText = `
                max-width: ${template.headerLogoWidth}px;
                max-height: ${template.headerLogoHeight}px;
                object-fit: contain;
            `;
            logoContainer.appendChild(img);
        } else if (logoSource.includes('<svg') || logoSource.startsWith('<svg')) {
            logoContainer.innerHTML = logoSource;
            const svg = logoContainer.querySelector('svg');
            if (svg) {
                svg.style.width = `${template.headerLogoWidth}px`;
                svg.style.height = `${template.headerLogoHeight}px`;
            }
        } else if (logoSource) {
            const img = document.createElement('img');
            img.src = logoSource;
            img.style.cssText = `
                max-width: ${template.headerLogoWidth}px;
                max-height: ${template.headerLogoHeight}px;
                object-fit: contain;
            `;
            logoContainer.appendChild(img);
        }

        return logoContainer;
    }

    private static addFooterSpacer(container: HTMLElement, template: Required<PDFTemplate>): void {
        if (!template.showPageNumbers && !template.footerText) {
            return;
        }

        const footerSpacer = document.createElement('div');
        footerSpacer.className = 'pdf-template-footer-spacer';
        footerSpacer.style.cssText = `height: ${template.footerHeight}px; margin-top: 40px;`;
        container.appendChild(footerSpacer);
    }

    private static addWatermark(container: HTMLElement, template: Required<PDFTemplate>): void {
        if (!template.watermark) {
            return;
        }

        const watermark = document.createElement('div');
        watermark.className = 'pdf-template-watermark';

        const baseStyles = `
            position: fixed;
            pointer-events: none;
            user-select: none;
            opacity: ${template.watermarkOpacity};
            z-index: 1;
            color: ${template.secondaryColor};
            font-size: ${template.watermarkSize / 10}px;
            font-weight: 100;
        `;

        switch (template.watermarkPosition) {
            case 'diagonal':
                watermark.style.cssText = `${baseStyles} top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: ${template.watermarkSize / 8}px; white-space: nowrap;`;
                break;
            case 'corner':
                watermark.style.cssText = `${baseStyles} bottom: 20px; right: 20px; font-size: ${template.fontSize}px;`;
                break;
            case 'center':
            default:
                watermark.style.cssText = `${baseStyles} top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: ${template.watermarkSize / 6}px; text-align: center;`;
                break;
        }

        if (
            template.watermark.startsWith('data:') ||
            template.watermark.startsWith('http') ||
            template.watermark.includes('<')
        ) {
            const img = document.createElement('img');
            img.src = template.watermark;
            img.style.cssText = `max-width: ${template.watermarkSize}px; max-height: ${template.watermarkSize}px; object-fit: contain;`;
            watermark.appendChild(img);
        } else {
            watermark.textContent = template.watermark;
        }

        container.appendChild(watermark);
    }
}

export const CorporateTemplates = {
    HOSEA: {
        theme: 'hosea' as const,
    },
    PROFESSIONAL: {
        theme: 'professional' as const,
        primaryColor: '#2c3e50',
        fontFamily: 'Georgia, serif',
    },
    MODERN: {
        theme: 'modern' as const,
        primaryColor: '#000000',
        accentColor: '#007bff',
        fontFamily: 'Helvetica, Arial, sans-serif',
    },
    MINIMAL: {
        theme: 'minimal' as const,
        primaryColor: '#333333',
        margins: { top: 100, right: 80, bottom: 100, left: 80 },
    },
};
