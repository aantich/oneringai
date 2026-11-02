import React, { useEffect, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { Palette, SlidersHorizontal, Cpu, ShieldCheck, Info, Code2, ArrowUpRight } from 'lucide-react';
import { PageHeader } from '../components/layout';
import { OllamaSetupPanel } from '../components/ollama/OllamaSetupPanel';
import { HoseaBrand } from '../design-system/Brand';
import { Surface, SettingRow } from '../design-system/Primitives';
import { useAppearance } from '../design-system/AppearanceProvider';
import type { ThemePreference } from '../design-system/appearance';

type Section = 'appearance' | 'behavior' | 'local' | 'privacy' | 'developer' | 'about';
const sections = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'behavior', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'local', label: 'Local AI', icon: Cpu },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'developer', label: 'Developer', icon: Code2 },
  { id: 'about', label: 'About hosea', icon: Info },
] as const;
interface Preferences { logLevel: string; ui: { streamResponses: boolean }; routines: { maxExecutionLogs: number }; }
export function SettingsPage(): React.ReactElement {
  const { appearance, setAppearance } = useAppearance();
  const [active, setActive] = useState<Section>('appearance');
  const [version, setVersion] = useState('');
  const [config, setConfig] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([window.hosea.config.get(), window.hosea.app.getVersion()]).then(([cfg, v]) => {
      setConfig(cfg as Preferences); setVersion(v);
    }).catch(() => setError('Settings could not be loaded.'));
  }, []);
  const save = async (work: () => Promise<void>) => {
    setSaving(true); setError(null);
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  };
  const preference = async (key: string, value: unknown) => {
    await save(async () => {
      const result = await window.hosea.config.set(key, value);
      if (!result.success) throw new Error('Settings could not be saved.');
      setConfig(await window.hosea.config.get() as Preferences);
    });
  };
  return <div className="page">
    <PageHeader title="Settings" subtitle="A workspace that feels like yours." />
    <div className="page__content"><div className="h-settings">
      <nav className="h-settings__nav" aria-label="Settings categories">{sections.map(({ id, label, icon: Icon }) =>
        <button type="button" key={id} onClick={() => setActive(id)} aria-current={active === id ? 'page' : undefined}><Icon size={16} strokeWidth={1.6} />{label}</button>
      )}</nav>
      <section className="h-settings__content" aria-label={sections.find(s => s.id === active)?.label}>
        {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
        {active === 'appearance' && <>
          <h2>Make yourself at home.</h2><p className="h-settings__description">A little lighter, a little darker. Find your focus.</p>
          <div className="h-theme-picker" role="group" aria-label="Color theme">{(['light', 'dark', 'system'] as ThemePreference[]).map(theme =>
            <button type="button" className="h-theme-choice" key={theme} aria-pressed={appearance.theme === theme} disabled={saving} onClick={() => void save(() => setAppearance({ theme }))}>
              <div className={`h-theme-preview h-theme-preview--${theme}`} aria-hidden="true" /><span>{theme === 'system' ? 'Use system' : theme === 'light' ? 'Light' : 'Dark'}</span>
            </button>
          )}</div>
          <SettingRow title="Text size" description="Keep conversations and controls comfortable to read.">
            <Form.Select aria-label="Text size" value={appearance.fontSize} disabled={saving} onChange={e => void save(() => setAppearance({ fontSize: Number(e.target.value) }))}>
              {[12, 13, 14, 15, 16, 18, 20].map(size => <option key={size} value={size}>{size}px{size === 14 ? ' · Default' : ''}</option>)}
            </Form.Select>
          </SettingRow>
          <div className="h-info-note"><Palette size={17} /><span>Geist typography, a quiet neutral palette, and generous space. The same design language across every corner of hosea.</span></div>
        </>}
        {active === 'behavior' && <>
          <h2>The details of your day.</h2><p className="h-settings__description">Small preferences for the way you work.</p>
          <SettingRow title="Stream responses" description="Read along as your agent writes."><Form.Check type="switch" id="stream-responses" aria-label="Stream responses" checked={config?.ui.streamResponses ?? true} disabled={saving || !config} onChange={e => void preference('ui.streamResponses', e.target.checked)} /></SettingRow>
          <SettingRow title="Routine history" description="Keep this many execution logs. Older completed logs are cleaned up automatically."><Form.Select aria-label="Routine history limit" value={config?.routines?.maxExecutionLogs ?? 100} disabled={saving || !config} onChange={e => void preference('routines.maxExecutionLogs', Number(e.target.value))}>{Array.from(new Set([25, 50, 100, 250, 500, config?.routines?.maxExecutionLogs ?? 100])).sort((a,b) => a-b).map(n => <option key={n} value={n}>{n} executions</option>)}</Form.Select></SettingRow>
        </>}
        {active === 'local' && <><h2>A little closer to home.</h2><p className="h-settings__description">Run models on your own machine with Ollama. No cloud API key required.</p><OllamaSetupPanel /></>}
        {active === 'privacy' && <>
          <h2>Your workspace, on your terms.</h2><p className="h-settings__description">Clear boundaries around your models, tools, and data.</p>
          <Surface className="p-4"><SettingRow title="Local storage" description="Agent settings, connections, and saved sessions live in your Hosea data directory."><ShieldCheck size={20} /></SettingRow><SettingRow title="Your chosen providers" description="Prompts and tool results are sent to the model provider you configure. Connected services receive the requests you authorize."><ArrowUpRight size={20} /></SettingRow><SettingRow title="No startup telemetry" description="Hosea does not send installation or device analytics on startup."><ShieldCheck size={20} /></SettingRow></Surface>
        </>}
        {active === 'developer' && <><h2>A look under the hood.</h2><p className="h-settings__description">Diagnostics for building and troubleshooting your workspace.</p><SettingRow title="Log verbosity" description="Controls application logs. Verbose logs may contain conversation and tool data."><Form.Select aria-label="Log verbosity" value={config?.logLevel ?? 'info'} disabled={saving || !config} onChange={e => void preference('logLevel', e.target.value)}>{['trace', 'debug', 'info', 'warn', 'error', 'silent'].map(level => <option key={level} value={level}>{level}</option>)}</Form.Select></SettingRow></>}
        {active === 'about' && <Surface className="h-about"><HoseaBrand /><p>A human-oriented space for engaging agents.<br />Built with OneRingAI. Made to be yours.</p><p>Version {version || '…'} · MIT licensed</p><Button variant="outline-secondary" href="https://github.com/aantich/oneringai" target="_blank" rel="noreferrer">Explore the source <ArrowUpRight size={14} /></Button><div className="h-about__meta"><p>© 2025–2026 Anton Antic<br /><a href="mailto:anton.antich@gmail.com">anton.antich@gmail.com</a></p></div></Surface>}
      </section>
    </div></div>
  </div>;
}
