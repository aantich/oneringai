#!/usr/bin/env npx ts-node
/**
 * API Documentation Generator
 *
 * Generates API reference documentation from TypeScript source files.
 *
 * Usage:
 *   npx ts-node scripts/generate-api-docs.ts --mode public   # User-facing API
 *   npx ts-node scripts/generate-api-docs.ts --mode full     # Full internal API
 *
 * The generator:
 * - Parses TypeScript AST using ts-morph
 * - Extracts classes, interfaces, types, functions, enums
 * - Reads JSDoc comments for descriptions
 * - Organizes by category based on file path
 * - Outputs markdown documentation
 */

import { Project, SourceFile, Node, SyntaxKind, JSDoc, Type } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDeclarationSignature, hasPrivateModifier } from './declarationSignature.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

interface GeneratorConfig {
  mode: 'public' | 'full';
  outputFile: string;
  title: string;
  description: string;
}

interface CategoryConfig {
  name: string;
  description: string;
  patterns: string[]; // File path patterns to match
}

const CATEGORIES: CategoryConfig[] = [
  {
    name: 'Core',
    description: 'Core classes for authentication, agents, and providers',
    patterns: ['core/Connector', 'core/Agent', 'core/Vendor', 'core/createProvider'],
  },
  {
    name: 'Text-to-Speech (TTS)',
    description: 'Convert text to spoken audio',
    patterns: ['core/TextToSpeech', 'TTSModel', 'TTS'],
  },
  {
    name: 'Speech-to-Text (STT)',
    description: 'Transcribe audio to text',
    patterns: ['core/SpeechToText', 'STTModel', 'STT'],
  },
  {
    name: 'Image Generation',
    description: 'Generate images from text prompts',
    patterns: ['images/', 'ImageModel', 'Image', 'createImageProvider'],
  },
  {
    name: 'Video Generation',
    description: 'Generate videos from text prompts',
    patterns: ['video/', 'VideoModel', 'Video', 'createVideoProvider'],
  },
  {
    name: 'Agent Runtime',
    description: 'Run complete agent systems through vendor-neutral drivers, sessions, events, policies, and results',
    patterns: ['agent-runtime/'],
  },
  {
    name: 'Task Agents',
    description: 'Autonomous agents with planning and memory',
    patterns: ['taskAgent/', 'Task.ts', 'Memory.ts', 'Plan'],
  },
  {
    name: 'Universal Agent',
    description: 'Unified agent combining chat, planning, and execution',
    patterns: ['universalAgent/'],
  },
  {
    name: 'Context Management',
    description: 'Manage context windows and compaction strategies',
    patterns: ['context/'],
  },
  {
    name: 'Session Management',
    description: 'Persist and resume agent conversations',
    patterns: ['Session', 'storage/'],
  },
  {
    name: 'Tools & Function Calling',
    description: 'Define and execute tools for agents',
    patterns: ['Tool', 'ToolManager', 'ToolRegistry'],
  },
  {
    name: 'Streaming',
    description: 'Real-time streaming of agent responses',
    patterns: ['Stream', 'StreamEvent', 'StreamHelper'],
  },
  {
    name: 'Model Registry',
    description: 'Model metadata, pricing, and capabilities',
    patterns: ['Model.ts', 'MODEL_REGISTRY'],
  },
  {
    name: 'OAuth & External APIs',
    description: 'OAuth 2.0 authentication for external services',
    patterns: ['oauth/', 'OAuth', 'connectors/'],
  },
  {
    name: 'Resilience & Observability',
    description: 'Circuit breakers, retries, logging, and metrics',
    patterns: ['resilience/', 'observability/', 'Circuit', 'Backoff', 'Logger', 'Metrics'],
  },
  {
    name: 'Errors',
    description: 'Error types and handling',
    patterns: ['errors/', 'Error'],
  },
  {
    name: 'Utilities',
    description: 'Helper functions and utilities',
    patterns: ['utils/', 'messageBuilder'],
  },
  {
    name: 'Interfaces',
    description: 'TypeScript interfaces for extensibility',
    patterns: ['interfaces/'],
  },
  {
    name: 'Base Classes',
    description: 'Base classes for custom provider implementations',
    patterns: ['base/Base'],
  },
];

// =============================================================================
// Types for extracted documentation
// =============================================================================

interface DocItem {
  kind: 'class' | 'interface' | 'type' | 'function' | 'enum' | 'const';
  name: string;
  description: string;
  signature?: string;
  members?: DocMember[];
  examples?: string[];
  sourceFile: string;
  lineNumber: number;
  isPublic: boolean;
  isInternal: boolean;
  category?: string;
}

interface DocMember {
  kind: 'property' | 'method' | 'constructor';
  name: string;
  description: string;
  signature: string;
  isStatic: boolean;
  isOptional: boolean;
  parameters?: DocParameter[];
  returnType?: string;
}

interface DocParameter {
  name: string;
  type: string;
  description: string;
  isOptional: boolean;
  defaultValue?: string;
}

// =============================================================================
// JSDoc Parser
// =============================================================================

function getJSDocDescription(node: Node): string {
  const jsDocs = node.getJsDocs?.() || [];
  if (jsDocs.length === 0) return '';

  const jsDoc = jsDocs[0];
  const description = jsDoc.getDescription?.() || '';
  return description.trim();
}

function getJSDocTags(node: Node): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  const jsDocs = node.getJsDocs?.() || [];

  for (const jsDoc of jsDocs) {
    for (const tag of jsDoc.getTags?.() || []) {
      const tagName = tag.getTagName();
      const text = tag.getCommentText?.() || '';
      if (!tags.has(tagName)) {
        tags.set(tagName, []);
      }
      tags.get(tagName)!.push(text);
    }
  }

  return tags;
}

function hasTag(node: Node, tagName: string): boolean {
  const tags = getJSDocTags(node);
  return tags.has(tagName);
}

function getExamples(node: Node): string[] {
  const tags = getJSDocTags(node);
  return tags.get('example') || [];
}

// =============================================================================
// Type Extraction
// =============================================================================

function formatType(type: Type | undefined): string {
  if (!type) return 'unknown';
  let text = type.getText();

  // Clean up import() paths to just show the type name
  // e.g., import("/Users/.../Agent").AgentConfig -> AgentConfig
  text = text.replace(/import\("[^"]+"\)\./g, '');

  // Clean up long paths in type references
  text = text.replace(/\/[^/]+\/[^/]+\/[^/]+\//g, '');

  return text;
}

function extractParameters(node: any): DocParameter[] {
  const params: DocParameter[] = [];
  const parameters = node.getParameters?.() || [];
  const tags = getJSDocTags(node);
  const paramDocs = tags.get('param') || [];

  for (const param of parameters) {
    const name = param.getName();
    const type = formatType(param.getType());
    const isOptional = param.isOptional() || param.hasInitializer();
    const defaultValue = param.getInitializer()?.getText();

    // Find description from @param tag
    let description = '';
    for (const doc of paramDocs) {
      const match = doc.match(new RegExp(`^${name}\\s+(.+)`, 's'));
      if (match) {
        description = match[1].trim();
        break;
      }
    }

    params.push({ name, type, description, isOptional, defaultValue });
  }

  return params;
}

// =============================================================================
// Node Extractors
// =============================================================================

function extractClass(node: any, sourceFile: SourceFile): DocItem {
  const name = node.getName() || 'Anonymous';
  const members: DocMember[] = [];

  // Constructor
  const constructors = node.getConstructors();
  for (const ctor of constructors) {
    if (hasPrivateModifier(ctor)) continue;
    members.push({
      kind: 'constructor',
      name: 'constructor',
      description: getJSDocDescription(ctor),
      signature: getDeclarationSignature(ctor),
      isStatic: false,
      isOptional: false,
      parameters: extractParameters(ctor),
    });
  }

  // Methods (instance and static)
  const seenMethods = new Set<string>();
  for (const method of node.getMethods()) {
    const methodKey = `${method.isStatic() ? 'static:' : ''}${method.getName()}`;
    if (method.getName().startsWith('_')) continue; // Skip private-by-convention
    if (seenMethods.has(methodKey)) continue; // Skip duplicates

    // Skip private methods in public mode
    if (hasPrivateModifier(method)) continue;

    seenMethods.add(methodKey);

    members.push({
      kind: 'method',
      name: method.getName(),
      description: getJSDocDescription(method),
      signature: getDeclarationSignature(method),
      isStatic: method.isStatic(),
      isOptional: false,
      parameters: extractParameters(method),
      returnType: formatType(method.getReturnType()),
    });
  }

  // Properties
  for (const prop of node.getProperties()) {
    if (prop.getName().startsWith('_')) continue;
    if (prop.getName().startsWith('#')) continue; // Skip private fields
    if (hasPrivateModifier(prop)) continue;

    members.push({
      kind: 'property',
      name: prop.getName(),
      description: getJSDocDescription(prop),
      signature: `${prop.getName()}: ${formatType(prop.getType())}`,
      isStatic: prop.isStatic(),
      isOptional: prop.hasQuestionToken?.() || false,
    });
  }

  return {
    kind: 'class',
    name,
    description: getJSDocDescription(node),
    members,
    examples: getExamples(node),
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

function extractInterface(node: any, sourceFile: SourceFile): DocItem {
  const name = node.getName() || 'Anonymous';
  const members: DocMember[] = [];

  for (const prop of node.getProperties()) {
    members.push({
      kind: 'property',
      name: prop.getName(),
      description: getJSDocDescription(prop),
      signature: prop.getText(),
      isStatic: false,
      isOptional: prop.hasQuestionToken?.() || false,
    });
  }

  for (const method of node.getMethods()) {
    members.push({
      kind: 'method',
      name: method.getName(),
      description: getJSDocDescription(method),
      signature: method.getText(),
      isStatic: false,
      isOptional: method.hasQuestionToken?.() || false,
      parameters: extractParameters(method),
      returnType: formatType(method.getReturnType()),
    });
  }

  return {
    kind: 'interface',
    name,
    description: getJSDocDescription(node),
    members,
    examples: getExamples(node),
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

function extractTypeAlias(node: any, sourceFile: SourceFile): DocItem {
  const name = node.getName();
  const typeNode = node.getTypeNode();
  const signature = typeNode ? typeNode.getText() : 'unknown';

  return {
    kind: 'type',
    name,
    description: getJSDocDescription(node),
    signature: `type ${name} = ${signature}`,
    examples: getExamples(node),
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

function extractFunction(node: any, sourceFile: SourceFile): DocItem {
  const name = node.getName() || 'anonymous';

  return {
    kind: 'function',
    name,
    description: getJSDocDescription(node),
    signature: getDeclarationSignature(node),
    examples: getExamples(node),
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

function extractEnum(node: any, sourceFile: SourceFile): DocItem {
  const name = node.getName();
  const members: DocMember[] = [];

  for (const member of node.getMembers()) {
    members.push({
      kind: 'property',
      name: member.getName(),
      description: getJSDocDescription(member),
      signature: member.getValue()?.toString() || '',
      isStatic: false,
      isOptional: false,
    });
  }

  return {
    kind: 'enum',
    name,
    description: getJSDocDescription(node),
    members,
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

function extractVariableAsConst(node: any, sourceFile: SourceFile): DocItem | null {
  const declarations = node.getDeclarations();
  if (declarations.length === 0) return null;

  const decl = declarations[0];
  const name = decl.getName();
  const initializer = decl.getInitializer();

  // Only extract object literals (like Vendor, LLM_MODELS)
  if (!initializer || initializer.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return null;
  }

  const members: DocMember[] = [];
  for (const prop of initializer.getProperties?.() || []) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const propName = prop.getName?.();
      const propInit = prop.getInitializer?.();
      if (propName && propInit) {
        members.push({
          kind: 'property',
          name: propName,
          description: '',
          signature: propInit.getText(),
          isStatic: false,
          isOptional: false,
        });
      }
    }
  }

  return {
    kind: 'const',
    name,
    description: getJSDocDescription(node),
    members: members.length > 0 ? members : undefined,
    sourceFile: sourceFile.getFilePath(),
    lineNumber: node.getStartLineNumber(),
    isPublic: !hasTag(node, 'internal'),
    isInternal: hasTag(node, 'internal'),
  };
}

// =============================================================================
// Public API Extraction (from index.ts exports)
// =============================================================================

function getPublicExports(project: Project, indexPaths: readonly string[]): Set<string> {
  const publicNames = new Set<string>();
  for (const indexPath of indexPaths) {
    const indexFile = project.getSourceFile(indexPath);

    if (!indexFile) {
      console.error(`Could not find public entry file: ${indexPath}`);
      continue;
    }

    // Get all named export declarations from each documented package subpath.
    for (const exportDecl of indexFile.getExportDeclarations()) {
      for (const namedExport of exportDecl.getNamedExports()) {
        publicNames.add(namedExport.getName());
      }
    }

    // Preserve support for direct export statements handled by older ts-morph
    // versions and formatting variants.
    for (const stmt of indexFile.getStatements()) {
      const text = stmt.getText();
      const matches = text.matchAll(/export\s+(?:type\s+)?{\s*([^}]+)\s*}/g);
      for (const match of matches) {
        const names = match[1].split(',').map((n) => n.trim().split(' as ')[0].trim());
        names.forEach((n) => publicNames.add(n));
      }
    }
  }

  return publicNames;
}

// =============================================================================
// Category Assignment
// =============================================================================

function assignCategory(item: DocItem): string {
  const filePath = item.sourceFile;

  for (const category of CATEGORIES) {
    for (const pattern of category.patterns) {
      if (filePath.includes(pattern) || item.name.includes(pattern.replace('.ts', ''))) {
        return category.name;
      }
    }
  }

  return 'Other';
}

// =============================================================================
// Markdown Generation
// =============================================================================

function escapeMarkdown(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateMemberDoc(member: DocMember, indent: string = ''): string {
  const lines: string[] = [];
  const staticPrefix = member.isStatic ? 'static ' : '';
  const optionalSuffix = member.isOptional ? '?' : '';

  if (member.kind === 'constructor') {
    lines.push(`${indent}#### \`constructor\``);
  } else if (member.kind === 'method') {
    lines.push(`${indent}#### \`${staticPrefix}${member.name}()${optionalSuffix}\``);
  } else {
    lines.push(`${indent}#### \`${staticPrefix}${member.name}${optionalSuffix}\``);
  }

  if (member.description) {
    lines.push('');
    lines.push(`${indent}${member.description}`);
  }

  if (member.signature) {
    lines.push('');
    lines.push(`${indent}\`\`\`typescript`);
    lines.push(`${indent}${escapeMarkdown(member.signature)}`);
    lines.push(`${indent}\`\`\``);
  }

  if (member.parameters && member.parameters.length > 0) {
    lines.push('');
    lines.push(`${indent}**Parameters:**`);
    for (const param of member.parameters) {
      const opt = param.isOptional ? ' *(optional)*' : '';
      const def = param.defaultValue ? ` (default: \`${param.defaultValue}\`)` : '';
      lines.push(`${indent}- \`${param.name}\`: \`${escapeMarkdown(param.type)}\`${opt}${def}`);
      if (param.description) {
        lines.push(`${indent}  ${param.description}`);
      }
    }
  }

  if (member.returnType && member.kind === 'method') {
    lines.push('');
    lines.push(`${indent}**Returns:** \`${escapeMarkdown(member.returnType)}\``);
  }

  return lines.join('\n');
}

function generateItemDoc(item: DocItem): string {
  const lines: string[] = [];

  // Header with kind badge
  const kindBadge = `\`${item.kind}\``;
  lines.push(`### ${item.name} ${kindBadge}`);
  lines.push('');

  // Source link
  const relativePath = item.sourceFile.replace(/.*\/src\//, 'src/');
  lines.push(`📍 [\`${relativePath}:${item.lineNumber}\`](${relativePath})`);
  lines.push('');

  // Description
  if (item.description) {
    lines.push(item.description);
    lines.push('');
  }

  // Signature (for types, functions)
  if (item.signature && !item.members) {
    lines.push('```typescript');
    lines.push(escapeMarkdown(item.signature));
    lines.push('```');
    lines.push('');
  }

  // Examples
  if (item.examples && item.examples.length > 0) {
    lines.push('**Example:**');
    lines.push('');
    for (const example of item.examples) {
      // Clean up example - it may already have code blocks
      if (example.includes('```')) {
        lines.push(example);
      } else {
        lines.push('```typescript');
        lines.push(example.trim());
        lines.push('```');
      }
    }
    lines.push('');
  }

  // Members (for classes, interfaces, enums)
  if (item.members && item.members.length > 0) {
    // Group by kind
    const constructors = item.members.filter((m) => m.kind === 'constructor');
    const staticMethods = item.members.filter((m) => m.kind === 'method' && m.isStatic);
    const instanceMethods = item.members.filter((m) => m.kind === 'method' && !m.isStatic);
    const properties = item.members.filter((m) => m.kind === 'property');

    if (constructors.length > 0) {
      lines.push('<details>');
      lines.push('<summary><strong>Constructor</strong></summary>');
      lines.push('');
      for (const member of constructors) {
        lines.push(generateMemberDoc(member));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    if (staticMethods.length > 0) {
      lines.push('<details>');
      lines.push('<summary><strong>Static Methods</strong></summary>');
      lines.push('');
      for (const member of staticMethods) {
        lines.push(generateMemberDoc(member));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    if (instanceMethods.length > 0) {
      lines.push('<details>');
      lines.push('<summary><strong>Methods</strong></summary>');
      lines.push('');
      for (const member of instanceMethods) {
        lines.push(generateMemberDoc(member));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    if (properties.length > 0) {
      lines.push('<details>');
      lines.push('<summary><strong>Properties</strong></summary>');
      lines.push('');
      lines.push('| Property | Type | Description |');
      lines.push('|----------|------|-------------|');
      for (const member of properties) {
        const opt = member.isOptional ? '?' : '';
        const desc = member.description || '-';
        lines.push(`| \`${member.name}${opt}\` | \`${escapeMarkdown(member.signature)}\` | ${desc} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function generateMarkdown(items: DocItem[], config: GeneratorConfig): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${config.title}`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Mode:** ${config.mode}`);
  lines.push('');
  lines.push(config.description);
  lines.push('');

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');

  const byCategory = new Map<string, DocItem[]>();
  for (const item of items) {
    const category = item.category || 'Other';
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(item);
  }

  // Sort categories by CATEGORIES order
  const sortedCategories = [...byCategory.keys()].sort((a, b) => {
    const aIndex = CATEGORIES.findIndex((c) => c.name === a);
    const bIndex = CATEGORIES.findIndex((c) => c.name === b);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  for (const category of sortedCategories) {
    const categoryItems = byCategory.get(category)!;
    const anchor = category.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
    lines.push(`- [${category}](#${anchor}) (${categoryItems.length} items)`);
  }
  lines.push('');

  // Content by category
  for (const category of sortedCategories) {
    const categoryItems = byCategory.get(category)!;
    const categoryConfig = CATEGORIES.find((c) => c.name === category);

    lines.push(`## ${category}`);
    lines.push('');
    if (categoryConfig?.description) {
      lines.push(categoryConfig.description);
      lines.push('');
    }

    // Sort items: classes first, then interfaces, then types, then functions
    const sortOrder = { class: 0, interface: 1, enum: 2, type: 3, function: 4, const: 5 };
    categoryItems.sort((a, b) => {
      const aOrder = sortOrder[a.kind] ?? 99;
      const bOrder = sortOrder[b.kind] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });

    for (const item of categoryItems) {
      lines.push(generateItemDoc(item));
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Main Generator
// =============================================================================

async function generateApiDocs(config: GeneratorConfig): Promise<void> {
  console.log(`\n🔍 Generating ${config.mode} API documentation...\n`);

  const projectRoot = path.resolve(__dirname, '..');
  const srcPath = path.join(projectRoot, 'src');
  const publicEntryPaths = [
    path.join(srcPath, 'index.ts'),
    path.join(srcPath, 'agent-runtime', 'index.ts'),
    path.join(srcPath, 'agent-runtime', 'codex.ts'),
  ];

  // Initialize ts-morph project
  const project = new Project({
    tsConfigFilePath: path.join(projectRoot, 'tsconfig.json'),
  });

  // Get public exports if in public mode
  const publicExports = config.mode === 'public' ? getPublicExports(project, publicEntryPaths) : null;

  if (publicExports) {
    console.log(`📦 Found ${publicExports.size} public exports\n`);
  }

  // Collect all documentation items
  const items: DocItem[] = [];
  const sourceFiles = project.getSourceFiles(`${srcPath}/**/*.ts`);

  console.log(`📂 Processing ${sourceFiles.length} source files...\n`);

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();

    // Skip test files and .d.ts files
    if (filePath.includes('.test.') || filePath.includes('.spec.') || filePath.endsWith('.d.ts')) {
      continue;
    }

    // Classes
    for (const node of sourceFile.getClasses()) {
      const item = extractClass(node, sourceFile);

      // Filter by mode
      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }

    // Interfaces
    for (const node of sourceFile.getInterfaces()) {
      const item = extractInterface(node, sourceFile);

      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }

    // Type aliases
    for (const node of sourceFile.getTypeAliases()) {
      const item = extractTypeAlias(node, sourceFile);

      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }

    // Functions
    for (const node of sourceFile.getFunctions()) {
      const item = extractFunction(node, sourceFile);

      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }

    // Enums
    for (const node of sourceFile.getEnums()) {
      const item = extractEnum(node, sourceFile);

      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }

    // Const objects (like Vendor, LLM_MODELS)
    for (const node of sourceFile.getVariableStatements()) {
      const item = extractVariableAsConst(node, sourceFile);
      if (!item) continue;

      if (config.mode === 'public' && publicExports && !publicExports.has(item.name)) {
        continue;
      }
      if (config.mode === 'public' && item.isInternal) {
        continue;
      }

      item.category = assignCategory(item);
      items.push(item);
    }
  }

  console.log(`📝 Extracted ${items.length} documentation items\n`);

  // Generate markdown
  const markdown = generateMarkdown(items, config);

  // Write output
  const outputPath = path.join(projectRoot, config.outputFile);
  fs.writeFileSync(outputPath, markdown);

  console.log(`✅ Generated: ${config.outputFile}`);
  console.log(`   Items: ${items.length}`);
  console.log(`   Size: ${(markdown.length / 1024).toFixed(1)} KB\n`);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(): GeneratorConfig {
  const args = process.argv.slice(2);
  let mode: 'public' | 'full' = 'public';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1] as 'public' | 'full';
    }
  }

  if (mode === 'public') {
    return {
      mode: 'public',
      outputFile: 'API_REFERENCE.md',
      title: '@everworker/oneringai - API Reference',
      description: `
This document provides a complete reference for the public API of \`@everworker/oneringai\`.

For usage examples and tutorials, see the [User Guide](./USER_GUIDE.md).

> **Note:** This documentation is auto-generated from source code. Items marked with \`@internal\` are excluded.
`.trim(),
    };
  } else {
    return {
      mode: 'full',
      outputFile: 'docs/INTERNAL_API.md',
      title: '@everworker/oneringai - Internal API Reference',
      description: `
This document provides a complete reference for ALL APIs in \`@everworker/oneringai\`, including internal implementations.

> **Warning:** Internal APIs may change without notice. For stable APIs, see [API_REFERENCE.md](../API_REFERENCE.md).
`.trim(),
    };
  }
}

// Run
const config = parseArgs();
generateApiDocs(config).catch(console.error);
