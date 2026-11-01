export interface DocxTemplate {
    // Header/Footer Configuration
    headerText?: string;
    footerText?: string;
    showPageNumbers?: boolean;

    // Color Scheme
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    textColor?: string;

    // Typography
    fontFamily?: string;
    headingFont?: string;
    fontSize?: number;
    headingScale?: number;

    // Layout & Spacing
    margins?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    };

    // Branding
    companyName?: string;
    companyTagline?: string;
    documentTitle?: string;

    // Theme Name
    theme?: 'default' | 'professional' | 'modern' | 'minimal' | 'everworker';
}

export class DocxTemplateManager {
    /**
     * Get predefined template by name
     */
    static getTemplate(templateName: string): DocxTemplate {
        const templates: Record<string, DocxTemplate> = {
            default: this.getDefaultTemplate(),
            professional: this.getProfessionalTemplate(),
            modern: this.getModernTemplate(),
            minimal: this.getMinimalTemplate(),
            everworker: this.getEverworkerTemplate(),
        };

        return templates[templateName] || templates.default;
    }

    static getDefaultTemplate(): DocxTemplate {
        return {
            headerText: '',
            footerText: '',
            showPageNumbers: true,
            primaryColor: '2E74B5',
            secondaryColor: '666666',
            accentColor: 'E74C3C',
            textColor: '333333',
            fontFamily: 'Calibri',
            fontSize: 11,
            headingScale: 1.5,
            margins: {
                top: 1,
                right: 1,
                bottom: 1,
                left: 1,
            },
        };
    }

    static getProfessionalTemplate(): DocxTemplate {
        return {
            ...this.getDefaultTemplate(),
            fontFamily: 'Times New Roman',
            headingFont: 'Arial',
            fontSize: 12,
            primaryColor: '1F4788',
            margins: {
                top: 1.25,
                right: 1.25,
                bottom: 1.25,
                left: 1.25,
            },
        };
    }

    static getModernTemplate(): DocxTemplate {
        return {
            ...this.getDefaultTemplate(),
            fontFamily: 'Arial',
            headingFont: 'Arial',
            fontSize: 11,
            primaryColor: '4285F4',
            secondaryColor: '5F6368',
            margins: {
                top: 0.75,
                right: 0.75,
                bottom: 0.75,
                left: 0.75,
            },
        };
    }

    static getMinimalTemplate(): DocxTemplate {
        return {
            showPageNumbers: false,
            primaryColor: '000000',
            secondaryColor: '666666',
            textColor: '000000',
            fontFamily: 'Helvetica',
            fontSize: 10,
            margins: {
                top: 0.5,
                right: 0.5,
                bottom: 0.5,
                left: 0.5,
            },
        };
    }

    static getEverworkerTemplate(): DocxTemplate {
        return {
            headerText: 'EVERWORKER AI Platform',
            footerText: 'Generated with EVERWORKER',
            showPageNumbers: true,
            primaryColor: '1a5490',
            secondaryColor: '666666',
            accentColor: 'e74c3c',
            textColor: '333333',
            fontFamily: 'Inter',
            headingFont: 'Inter',
            fontSize: 11,
            headingScale: 1.4,
            margins: {
                top: 1,
                right: 0.8,
                bottom: 1,
                left: 0.8,
            },
            companyName: 'EVERWORKER',
            companyTagline: 'AI-Powered Agent Platform',
        };
    }

    /**
     * Merge template with defaults
     */
    static getMergedTemplate(template?: DocxTemplate): Required<DocxTemplate> {
        const defaultTemplate = this.getDefaultTemplate();
        const selectedTemplate = template?.theme
            ? this.getTemplate(template.theme)
            : template || {};

        return {
            headerText: selectedTemplate.headerText ?? defaultTemplate.headerText ?? '',
            footerText: selectedTemplate.footerText ?? defaultTemplate.footerText ?? '',
            showPageNumbers:
                selectedTemplate.showPageNumbers ?? defaultTemplate.showPageNumbers ?? true,
            primaryColor: selectedTemplate.primaryColor ?? defaultTemplate.primaryColor ?? '2E74B5',
            secondaryColor:
                selectedTemplate.secondaryColor ?? defaultTemplate.secondaryColor ?? '666666',
            accentColor: selectedTemplate.accentColor ?? defaultTemplate.accentColor ?? 'E74C3C',
            textColor: selectedTemplate.textColor ?? defaultTemplate.textColor ?? '333333',
            fontFamily: selectedTemplate.fontFamily ?? defaultTemplate.fontFamily ?? 'Calibri',
            headingFont:
                selectedTemplate.headingFont ??
                selectedTemplate.fontFamily ??
                defaultTemplate.fontFamily ??
                'Calibri',
            fontSize: selectedTemplate.fontSize ?? defaultTemplate.fontSize ?? 11,
            headingScale: selectedTemplate.headingScale ?? defaultTemplate.headingScale ?? 1.5,
            margins: {
                top: selectedTemplate.margins?.top ?? defaultTemplate.margins?.top ?? 1,
                right: selectedTemplate.margins?.right ?? defaultTemplate.margins?.right ?? 1,
                bottom: selectedTemplate.margins?.bottom ?? defaultTemplate.margins?.bottom ?? 1,
                left: selectedTemplate.margins?.left ?? defaultTemplate.margins?.left ?? 1,
            },
            companyName: selectedTemplate.companyName ?? '',
            companyTagline: selectedTemplate.companyTagline ?? '',
            documentTitle: selectedTemplate.documentTitle ?? '',
            theme: selectedTemplate.theme ?? 'default',
        };
    }
}

export const CorporateTemplates = {
    EVERWORKER: DocxTemplateManager.getEverworkerTemplate(),
    PROFESSIONAL: DocxTemplateManager.getProfessionalTemplate(),
    MODERN: DocxTemplateManager.getModernTemplate(),
    MINIMAL: DocxTemplateManager.getMinimalTemplate(),
    DEFAULT: DocxTemplateManager.getDefaultTemplate(),
};
