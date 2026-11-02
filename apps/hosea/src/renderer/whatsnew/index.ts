import redesign from './hosea.md?raw';
export interface WhatsNewEntry { version: string; content: string; }
export const whatsNewEntries: WhatsNewEntry[] = [{ version: 'hosea-design-1', content: redesign }];
