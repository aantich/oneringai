import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { DEFAULT_APPEARANCE, normalizeAppearance, applyAppearance, type Appearance } from './appearance';

const AppearanceContext = createContext({
  appearance: DEFAULT_APPEARANCE,
  setAppearance: async (_next: Partial<Appearance>): Promise<void> => {},
});

export function AppearanceProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [appearance, update] = useState(DEFAULT_APPEARANCE);
  const current = useRef(appearance);
  useEffect(() => {
    let active = true;
    window.hosea.config.get().then(config => {
      if (!active) return;
      const next = normalizeAppearance((config as { ui?: Partial<Appearance> })?.ui);
      current.current = next;
      update(next);
      applyAppearance(next);
    }).catch(console.error);
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyAppearance(current.current);
    query.addEventListener('change', onChange);
    return () => { active = false; query.removeEventListener('change', onChange); };
  }, []);
  const setAppearance = useCallback(async (patch: Partial<Appearance>) => {
    const next = normalizeAppearance({ ...current.current, ...patch });
    for (const [key, value] of Object.entries(patch)) {
      const result = await window.hosea.config.set(`ui.${key}`, next[key as keyof Appearance]);
      if (!result.success) throw new Error('Appearance could not be saved.');
    }
    current.current = next;
    update(next);
    applyAppearance(next);
  }, []);
  return <AppearanceContext.Provider value={{ appearance, setAppearance }}>{children}</AppearanceContext.Provider>;
}
export function useAppearance() { return useContext(AppearanceContext); }
