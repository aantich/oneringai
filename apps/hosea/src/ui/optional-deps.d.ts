/**
 * Type declarations for optional peer dependencies.
 * These are dynamically imported at runtime and may not be installed.
 */

declare module 'mermaid' {
  const mermaid: {
    initialize: (config: any) => void;
    render: (id: string, code: string) => Promise<{ svg: string }>;
  };
  export default mermaid;
}

declare module 'markmap-lib' {
  export class Transformer {
    transform(content: string): { root: any; features: any };
    getUsedAssets(features: any): { styles: any; scripts: any };
  }
}

declare module 'markmap-view' {
  export class Markmap {
    static create(svg: SVGElement, options: any): Markmap;
    setData(data: any): void;
    fit(): void;
    rescale(scale: number): void;
    destroy(): void;
    svg: any;
  }
  export function loadCSS(styles: any): void;
  export function loadJS(scripts: any, options: any): Promise<void>;
}

declare module 'react-vega' {
  export const VegaLite: React.ComponentType<any>;
  export type VisualizationSpec = any;
}
