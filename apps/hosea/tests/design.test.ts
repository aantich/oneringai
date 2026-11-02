import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { getHoseaDataDir, isBackendEnabled, isDesignPreview } from '../src/main/runtimeConfig.js';
import { normalizeAppearance, resolveTheme, applyAppearance } from '../src/renderer/design-system/appearance.js';

test('normal and preview launches keep storage separate without importing credentials', () => {
  assert.equal(getHoseaDataDir({}, '/user'), join('/user', '.hosea'));
  assert.equal(getHoseaDataDir({ HOSEA_DATA_DIR: './.preview-data' }, '/user'), resolve('.preview-data'));
  assert.equal(getHoseaDataDir({ HOSEA_DATA_DIR: '  ' }, '/user'), join('/user', '.hosea'));
});
test('backend auth and proxying are dormant unless explicitly enabled', () => {
  for (const value of [undefined, '', '0', 'false', 'true']) {
    assert.equal(isBackendEnabled({ HOSEA_ENABLE_BACKEND: value }), false);
  }
  assert.equal(isBackendEnabled({ HOSEA_ENABLE_BACKEND: '1' }), true);
  assert.equal(isBackendEnabled({ HOSEA_ENABLE_BACKEND: '1', HOSEA_DESIGN_PREVIEW: '1' }), false);
  assert.equal(isDesignPreview({ HOSEA_DESIGN_PREVIEW: '1' }), true);
});
test('saved appearance handles absent and out-of-range settings', () => {
  assert.deepEqual(normalizeAppearance(undefined), { theme: 'light', fontSize: 14 });
  assert.deepEqual(normalizeAppearance({ theme: 'dark', fontSize: 18 }), { theme: 'dark', fontSize: 18 });
  assert.equal(normalizeAppearance({ fontSize: Infinity }).fontSize, 14);
  assert.equal(normalizeAppearance({ fontSize: NaN }).fontSize, 14);
  assert.equal(normalizeAppearance({ fontSize: 99 }).fontSize, 20);
  assert.equal(normalizeAppearance({ fontSize: 2 }).fontSize, 12);
});
test('explicit appearance wins over OS changes; system tracks them', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});
test('appearance updates native form scheme, semantic theme, and text scaling together', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const element = { dataset: {} as Record<string, string>, style: { colorScheme: '', fontSize: '' } };
  let systemDark = true;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: element } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: systemDark }) } });
  try {
    applyAppearance({ theme: 'system', fontSize: 18 });
    assert.deepEqual(element, { dataset: { theme: 'dark' }, style: { colorScheme: 'dark', fontSize: '18px' } });
    systemDark = false;
    applyAppearance({ theme: 'system', fontSize: 14 });
    assert.equal(element.dataset.theme, 'light');
    assert.equal(element.style.colorScheme, 'light');
    applyAppearance({ theme: 'dark', fontSize: 16 });
    assert.equal(element.dataset.theme, 'dark');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
