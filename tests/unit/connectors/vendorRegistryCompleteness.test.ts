import { describe, it, expect } from 'vitest';

describe('vendor registry completeness', () => {
  it('initializes without throwing - every authorization_code template declares a refreshStrategy', async () => {
    // Importing vendors module triggers initVendorRegistry which validates
    // every authorization_code AuthTemplate has a refreshStrategy. If any
    // template is missing one, this import throws.
    await expect(import('@/connectors/vendors/index.js')).resolves.toBeTruthy();
  });

  it('all authorization_code templates have a refreshStrategy', async () => {
    const { getAllVendorTemplates } = await import('@/connectors/vendors/index.js');
    const templates = getAllVendorTemplates();
    const missing: string[] = [];
    for (const t of templates) {
      for (const auth of t.authTemplates) {
        if (auth.type === 'oauth' && auth.flow === 'authorization_code' && !auth.refreshStrategy) {
          missing.push(`${t.id}/${auth.id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
