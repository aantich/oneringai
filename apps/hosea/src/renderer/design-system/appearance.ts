export type ThemePreference = 'light' | 'dark' | 'system';
export interface Appearance { theme: ThemePreference; fontSize: number; }
export const DEFAULT_APPEARANCE: Appearance = { theme: 'light', fontSize: 14 };

export function normalizeAppearance(input: Partial<Appearance> | null | undefined): Appearance {
  const theme = input?.theme;
  return {
    theme: theme === 'dark' || theme === 'system' ? theme : 'light',
    fontSize: typeof input?.fontSize === 'number' && Number.isFinite(input.fontSize)
      ? Math.min(20, Math.max(12, input.fontSize)) : 14,
  };
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
export function applyAppearance(appearance: Appearance): void {
  const theme = resolveTheme(appearance.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.fontSize = `${appearance.fontSize}px`;
}
