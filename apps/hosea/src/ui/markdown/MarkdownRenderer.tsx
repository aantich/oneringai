/**
 * Rich Markdown Renderer with support for:
 * - GitHub Flavored Markdown (tables, strikethrough, autolinks)
 * - Syntax-highlighted code blocks with special renderers
 * - LaTeX math (inline and block) with robust preprocessing
 * - Mermaid diagrams, Markmap mindmaps, Vega/Vega-Lite charts
 *
 * Merged from Hosea (streaming context, audio/video detection, clean structure)
 * and v25 (advanced math preprocessing, box-drawing table conversion, pipe escaping).
 */

import React, { useMemo, memo, createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import type { MarkdownRendererProps } from './types.js';

import { CodeBlock } from './CodeBlock.js';

// ---------------------------------------------------------------------------
// Streaming context — allows nested CodeBlock to know if content is streaming
// and provides onInteractiveAction to InteractiveUIBlock
// ---------------------------------------------------------------------------

import type { OnInteractiveAction } from '../interactive-ui/types.js';

interface MarkdownContextValue {
  isStreaming: boolean;
  onInteractiveAction?: OnInteractiveAction;
}

const MarkdownContext = createContext<MarkdownContextValue>({ isStreaming: false });

export const useMarkdownContext = () => useContext(MarkdownContext);

// ---------------------------------------------------------------------------
// Math preprocessing utilities (from v25 — more robust than Hosea's)
// ---------------------------------------------------------------------------

/**
 * Find the matching closing brace for an opening brace, handling nested braces.
 * Ignores escaped braces.
 */
function findMatchingBrace(text: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (i > 0 && text[i - 1] === '\\') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === '\\') { backslashCount++; j--; }
      if (backslashCount % 2 === 1) continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Escape dollar signs inside text commands (like \text{}, \mathrm{}, etc.)
 * by converting $...$ to \(...\) to avoid nested dollar sign parsing issues.
 */
function escapeDollarsInTextCommands(mathContent: string): string {
  const textCommands = ['text', 'mathrm', 'mbox', 'textrm', 'textsf', 'texttt', 'textnormal', 'textsc'];
  let result = mathContent;

  for (const cmd of textCommands) {
    const cmdPattern = `\\${cmd}{`;
    let searchPos = 0;

    while (true) {
      const cmdStart = result.indexOf(cmdPattern, searchPos);
      if (cmdStart === -1) break;

      const braceStart = cmdStart + cmdPattern.length;
      const braceEnd = findMatchingBrace(result, braceStart - 1);
      if (braceEnd === -1) { searchPos = braceStart; continue; }

      const textContent = result.substring(braceStart, braceEnd);
      let escapedContent = '';
      let i = 0;
      while (i < textContent.length) {
        if (textContent[i] === '$') {
          if (i < textContent.length - 1 && textContent[i + 1] === '$') {
            escapedContent += '$$';
            i += 2;
            continue;
          }
          const dollarStart = i;
          i++;
          const closingDollar = textContent.indexOf('$', i);
          if (closingDollar !== -1 && (closingDollar === textContent.length - 1 || textContent[closingDollar + 1] !== '$')) {
            const mathExpr = textContent.substring(dollarStart + 1, closingDollar);
            escapedContent += `\\(${mathExpr}\\)`;
            i = closingDollar + 1;
          } else {
            escapedContent += '$';
            i++;
          }
        } else {
          escapedContent += textContent[i];
          i++;
        }
      }

      if (escapedContent !== textContent) {
        result = result.substring(0, braceStart) + escapedContent + result.substring(braceEnd);
        searchPos = braceStart + escapedContent.length;
      } else {
        searchPos = braceEnd + 1;
      }
    }
  }
  return result;
}

/**
 * Detect ASCII box-drawing tables and convert them to GFM markdown pipe tables.
 */
function convertBoxDrawingTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  const BOX_BORDER_CHARS = /[┌┐└┘├┤┬┴┼─╔╗╚╝╠╣╦╩╬═]/;
  const BOX_DATA_CHAR = /[│║]/;
  const isBoxLine = (line: string) => BOX_DATA_CHAR.test(line) || BOX_BORDER_CHARS.test(line);
  const isBorderLine = (line: string) => {
    const trimmed = line.trim();
    return BOX_BORDER_CHARS.test(trimmed) && !BOX_DATA_CHAR.test(trimmed) && /^[┌┐└┘├┤┬┴┼─╔╗╚╝╠╣╦╩╬═\s]+$/.test(trimmed);
  };
  const isDataLine = (line: string) => BOX_DATA_CHAR.test(line);
  const extractCells = (line: string): string[] => {
    const parts = line.split(/[│║]/);
    return parts.length >= 3 ? parts.slice(1, -1).map((c) => c.trim()) : parts.map((c) => c.trim());
  };

  const convertBlock = (blockLines: string[]): string[] => {
    const mergedRows: string[][] = [];
    let currentGroup: string[][] = [];

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      const colCount = currentGroup[0].length;
      const merged: string[] = Array(colCount).fill('');
      for (const cellRow of currentGroup) {
        for (let c = 0; c < colCount && c < cellRow.length; c++) {
          if (cellRow[c]) merged[c] = merged[c] ? `${merged[c]} ${cellRow[c]}` : cellRow[c];
        }
      }
      mergedRows.push(merged);
      currentGroup = [];
    };

    for (const line of blockLines) {
      if (isBorderLine(line)) { flushGroup(); continue; }
      if (isDataLine(line)) currentGroup.push(extractCells(line));
    }
    flushGroup();
    if (mergedRows.length === 0) return blockLines;

    const colCount = mergedRows[0].length;
    const gfmLines: string[] = [];
    gfmLines.push(`| ${mergedRows[0].map((c) => c || ' ').join(' | ')} |`);
    gfmLines.push(`|${Array(colCount).fill('---').join('|')}|`);
    for (let i = 1; i < mergedRows.length; i++) {
      const row = mergedRows[i].slice(0, colCount);
      while (row.length < colCount) row.push('');
      gfmLines.push(`| ${row.join(' | ')} |`);
    }
    return gfmLines;
  };

  let i = 0;
  while (i < lines.length) {
    if (isBoxLine(lines[i])) {
      const blockStart = i;
      while (i < lines.length && isBoxLine(lines[i])) i++;
      result.push(...convertBlock(lines.slice(blockStart, i)));
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

/**
 * Full markdown preprocessing pipeline.
 * Handles math notation normalization, box-drawing tables, verb commands, pipe escaping.
 */
function preprocessMarkdown(content: string): string {
  if (!content || typeof content !== 'string') return '';

  let processed = content;

  // Extract code blocks to prevent preprocessing from modifying their content
  const codeBlocks: Array<{ placeholder: string; content: string }> = [];
  let codeBlockIndex = 0;
  processed = processed.replace(/```[\w]*\n?[\s\S]*?```/g, (match) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlockIndex}__`;
    codeBlocks.push({ placeholder, content: match });
    codeBlockIndex++;
    return placeholder;
  });

  // Convert ASCII box-drawing tables to GFM markdown tables
  processed = convertBoxDrawingTables(processed);

  // Normalize line endings
  processed = processed.replace(/\r\n/g, '\n');

  // Convert \verb|...|
  processed = processed.replace(/\\verb\|([^\r\n|]*?)\|/g, (_match, body) => {
    const escaped = String(body).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `\`${escaped}\``;
  });

  // Normalize $$...$$ blocks — ensure proper spacing
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, mathContent) => {
    const lines = match.split('\n');
    if (lines.length >= 3 && lines[0].trim() === '$$' && lines[lines.length - 1].trim() === '$$') {
      return match; // Already properly formatted
    }
    if (!mathContent || typeof mathContent !== 'string') return match;
    try {
      const normalized = mathContent.trim().replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n');
      return `\n\n$$\n${normalized}\n$$\n\n`;
    } catch {
      return match;
    }
  });

  // Convert block math \[...\] to $$...$$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_match, mathContent) => {
    if (!mathContent || typeof mathContent !== 'string') return _match;
    try {
      const normalized = mathContent.trim().replace(/\s+/g, ' ');
      return `\n\n$$\n${normalized}\n$$\n\n`;
    } catch {
      return _match;
    }
  });

  // Convert inline math \(...\) to $...$
  let inlineMathIndex = 0;
  const inlineMathGroups: Array<{ start: number; end: number; parts: string[] }> = [];

  while (true) {
    const openPos = processed.indexOf('\\(', inlineMathIndex);
    if (openPos === -1) break;
    const closePos = processed.indexOf('\\)', openPos + 2);
    if (closePos === -1) break;

    const mathContent = processed.substring(openPos + 2, closePos).trim();
    let normalized = escapeDollarsInTextCommands(mathContent);
    if (normalized) {
      inlineMathGroups.push({ start: openPos, end: closePos + 2, parts: [normalized] });
    }
    inlineMathIndex = closePos + 2;
  }

  inlineMathGroups.reverse().forEach(({ start, end, parts }) => {
    const combined = parts.join(' ');
    processed = `${processed.substring(0, start)}$${combined}$${processed.substring(end)}`;
  });

  // Restore code blocks
  codeBlocks.forEach(({ placeholder, content }) => {
    processed = processed.replace(placeholder, () => content);
  });

  return processed;
}

// ---------------------------------------------------------------------------
// Markdown component overrides
// ---------------------------------------------------------------------------

// Audio/video extensions for media link detection (from Hosea)
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.opus', '.pcm', '.webm'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];

function hasExtension(url: string, extensions: string[]): boolean {
  const lower = url.toLowerCase().split('?')[0]!;
  return extensions.some((ext) => lower.endsWith(ext));
}

/** Code component that reads streaming state and interactive action handler from context */
function CodeComponent({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { isStreaming, onInteractiveAction } = useMarkdownContext();
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const code = String(children).replace(/\n$/, '');
  const isInline = !match && !code.includes('\n');

  if (isInline) {
    return <code className="inline-code">{children}</code>;
  }
  return <CodeBlock language={language} code={code} isStreaming={isStreaming} onInteractiveAction={onInteractiveAction} />;
}

const markdownComponents: Components = {
  code: CodeComponent,

  table({ children }) {
    return (
      <div className="table-responsive">
        <table className="markdown-table">{children}</table>
      </div>
    );
  },

  a({ href, children, ...props }) {
    if (href && hasExtension(href, AUDIO_EXTENSIONS)) {
      return <audio controls className="markdown-audio"><source src={href} /></audio>;
    }
    if (href && hasExtension(href, VIDEO_EXTENSIONS)) {
      return <video controls className="markdown-video"><source src={href} /></video>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },

  img({ src, alt, ...props }) {
    if (src && hasExtension(src, AUDIO_EXTENSIONS)) {
      return <audio controls className="markdown-audio"><source src={src} /></audio>;
    }
    if (src && hasExtension(src, VIDEO_EXTENSIONS)) {
      return <video controls className="markdown-video"><source src={src} /></video>;
    }
    return <img src={src} alt={alt || ''} className="markdown-image" loading="lazy" {...props} />;
  },

  blockquote({ children }) {
    return <blockquote className="markdown-blockquote">{children}</blockquote>;
  },

  hr() { return <hr className="markdown-hr" />; },

  ul({ children }) { return <ul className="markdown-list">{children}</ul>; },
  ol({ children }) { return <ol className="markdown-list markdown-list--ordered">{children}</ol>; },

  h1({ children }) { return <h1 className="markdown-heading markdown-h1">{children}</h1>; },
  h2({ children }) { return <h2 className="markdown-heading markdown-h2">{children}</h2>; },
  h3({ children }) { return <h3 className="markdown-heading markdown-h3">{children}</h3>; },
  h4({ children }) { return <h4 className="markdown-heading markdown-h4">{children}</h4>; },
  h5({ children }) { return <h5 className="markdown-heading markdown-h5">{children}</h5>; },
  h6({ children }) { return <h6 className="markdown-heading markdown-h6">{children}</h6>; },

  p({ children }) { return <p className="markdown-paragraph">{children}</p>; },
};

// ---------------------------------------------------------------------------
// KaTeX configuration
// ---------------------------------------------------------------------------

const KATEX_MACROS = {
  '\\arcsinh': '\\operatorname{arcsinh}',
  '\\arccosh': '\\operatorname{arccosh}',
  '\\arctanh': '\\operatorname{arctanh}',
  '\\arccoth': '\\operatorname{arccoth}',
  '\\arcsech': '\\operatorname{arcsech}',
  '\\arccsch': '\\operatorname{arccsch}',
  '\\sgn': '\\operatorname{sgn}',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  children,
  className = '',
  isStreaming = false,
  onInteractiveAction,
}: MarkdownRendererProps): React.ReactElement {
  const rawContent = content ?? children ?? '';

  const processedContent = useMemo(() => {
    try {
      return preprocessMarkdown(rawContent);
    } catch (error) {
      console.error('Error preprocessing markdown:', error);
      return rawContent;
    }
  }, [rawContent]);

  const contextValue = useMemo(() => ({ isStreaming, onInteractiveAction }), [isStreaming, onInteractiveAction]);

  return (
    <MarkdownContext.Provider value={contextValue}>
      <div className={`markdown-content ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            [rehypeKatex, {
              throwOnError: false,
              strict: false,
              trust: true,
              macros: KATEX_MACROS,
            }],
          ]}
          components={markdownComponents}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
});

export default MarkdownRenderer;
