/**
 * Centralized style configuration for visualization components
 * Provides consistent styling across chat view and PDF export contexts
 */

export type VisualizationMode = 'chat' | 'pdf';

export interface VisualizationStyles {
    container: {
        width?: string;
        padding?: string;
        margin?: string;
        border?: string;
        borderRadius?: string;
        backgroundColor?: string;
        overflow?: string;
        breakInside?: string;
        pageBreakInside?: string;
        maxWidth?: string;
    };
    svg?: {
        maxWidth?: string;
        height?: string;
        width?: string;
    };
    canvas?: {
        maxWidth?: string;
        height?: string;
    };
}

export interface AllVisualizationStyles {
    vega: VisualizationStyles;
    markmap: VisualizationStyles;
    mermaid: VisualizationStyles;
    codeBlock: VisualizationStyles;
    table: VisualizationStyles;
}

/**
 * Centralized visualization styles configuration
 */
export const VISUALIZATION_STYLES: Record<VisualizationMode, AllVisualizationStyles> = {
    chat: {
        vega: {
            container: {
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                backgroundColor: '#fafafa',
                overflow: 'auto',
            },
        },
        markmap: {
            container: {
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '16px',
                margin: '24px 0',
                backgroundColor: '#fafafa',
            },
        },
        mermaid: {
            container: {
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '16px',
                margin: '24px 0',
                backgroundColor: '#fafafa',
            },
        },
        codeBlock: {
            container: {
                backgroundColor: '#f8f9fa',
                border: '1px solid #e9ecef',
                borderRadius: '4px',
                padding: '16px',
                margin: '16px 0',
            },
        },
        table: {
            container: {
                margin: '20px 0',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
            },
        },
    },
    pdf: {
        vega: {
            container: {
                maxWidth: '100%',
                overflow: 'visible',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
                margin: '0',
                padding: '0',
                border: 'none',
                borderRadius: '0',
                backgroundColor: 'transparent',
            },
            svg: {
                maxWidth: '100%',
                height: 'auto',
            },
            canvas: {
                maxWidth: '100%',
                height: 'auto',
            },
        },
        markmap: {
            container: {
                maxWidth: '100%',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
                margin: '10px 0',
                padding: '0',
            },
            svg: {
                width: '100%',
                height: 'auto',
            },
        },
        mermaid: {
            container: {
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
                margin: '10px 0',
                padding: '0',
            },
        },
        codeBlock: {
            container: {
                backgroundColor: '#f8f9fa',
                border: '1px solid #e9ecef',
                borderRadius: '4px',
                padding: '12px',
                margin: '10px 0',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
                maxWidth: '100%',
                overflow: 'visible',
            },
        },
        table: {
            container: {
                width: '100%',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
                margin: '10px 0',
                padding: '0',
            },
        },
    },
};

/**
 * CSS selectors for identifying visualization elements in the DOM
 */
export const VISUALIZATION_SELECTORS: Record<keyof AllVisualizationStyles | 'all', string[]> = {
    vega: ['.vega-container', '.vega-lite-container'],
    markmap: ['.markmap-container'],
    mermaid: ['.mermaid'],
    codeBlock: ['pre', '.code-block'],
    table: ['table'],
    get all() {
        return [...this.vega, ...this.markmap, ...this.mermaid, ...this.codeBlock, ...this.table];
    },
};

/**
 * Apply visualization styles from VISUALIZATION_STYLES to a DOM element
 */
export function applyVisualizationStyles(
    element: HTMLElement,
    type: keyof AllVisualizationStyles,
    mode: VisualizationMode,
    force = false,
): void {
    const styles = VISUALIZATION_STYLES[mode][type];
    if (!styles) return;

    const priority = force ? 'important' : '';

    if (styles.container) {
        for (const [prop, value] of Object.entries(styles.container)) {
            if (value != null) {
                const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                element.style.setProperty(cssProp, value, priority);
            }
        }
    }

    if (styles.svg) {
        const svgEl = element.querySelector('svg') as SVGElement | null;
        if (svgEl) {
            for (const [prop, value] of Object.entries(styles.svg)) {
                if (value != null) {
                    const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                    svgEl.style.setProperty(cssProp, value, priority);
                }
            }
        }
    }

    if (styles.canvas) {
        const canvasEl = element.querySelector('canvas') as HTMLCanvasElement | null;
        if (canvasEl) {
            for (const [prop, value] of Object.entries(styles.canvas)) {
                if (value != null) {
                    const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                    canvasEl.style.setProperty(cssProp, value, priority);
                }
            }
        }
    }
}
