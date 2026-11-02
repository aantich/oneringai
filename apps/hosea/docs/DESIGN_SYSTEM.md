# hosea design system

Hosea is a quiet desktop workspace: warm neutrals, strong typography, fine borders,
and space around the work. Black and white are the primary colors. Semantic
success, warning, and failure states retain restrained color so they remain useful.

## Foundations

`src/renderer/styles/variables.css` is the source of truth for colors, typography,
spacing, radii, motion, and layering. Use semantic roles for new UI:

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--h-canvas` | Workspace background | `#ffffff` | `#20201f` |
| `--h-sidebar` | Quiet navigation / inset areas | `#f6f5f3` | `#191918` |
| `--h-surface` | Panels and input surfaces | `#ffffff` | `#242423` |
| `--h-ink` | Primary text | `#20201e` | `#eeede9` |
| `--h-muted` | Secondary text | `#767570` | `#a3a29a` |
| `--h-line` | Dividers and subtle borders | `#e8e7e3` | `#363631` |
| `--h-accent` | Primary action | `#242423` | `#eeede9` |
| `--h-on-accent` | Text/icon on primary action | `#ffffff` | `#242423` |

Pair foregrounds with their semantic backgrounds. Do not assume “white” means
white in dark mode. The existing `--color-*` and Bootstrap variable names bridge
to these foundations, keeping existing agent, media, tool, and history screens
consistent. Do not add independent page accent palettes.

- **Type:** locally bundled Geist Variable (`@fontsource-variable/geist`, OFL-1.1;
  its license ships with the dependency). No Google Fonts/network request.
- **Text scale:** 14px default, 12–20px selectable. Use rem for text where possible.
- **Spacing:** 4px unit; 8/12px within controls, 16/24px within panels, 32px page padding.
- **Shape:** 9px controls, 14px surfaces, 22px composer, circular icon send button.
- **Motion:** 120/180ms interaction transitions, disabled for reduced-motion users.
- **Icons:** Lucide, generally 16–20px and 1.5–1.75px stroke. No emoji navigation.

## Reusable components

`src/renderer/design-system/` contains:

- `Brand.tsx`: `HoseaMark` (original open-arch h) and `HoseaBrand` wordmark. The mark
  uses `currentColor` and scales in either theme without duplicating assets.
- `Primitives.tsx`: `Surface`, `ActionCard`, and `SettingRow` for panels, actionable
  shortcuts, and preference rows. Action cards are real buttons with destinations.
- `Welcome.tsx`: one welcome layout shared by empty and configured conversations.
  Suggestion tiles populate the composer; they do not submit prompts automatically.
- `AppearanceProvider.tsx`: persisted preferences and OS theme change subscription.
- `appearance.ts`: normalization, theme resolution, and DOM application helpers.

Use the existing React Bootstrap controls for buttons, forms, modals, menus,
alerts, and tabs. `styles/design-system.css` styles them through the shared tokens;
there is no second widget framework. Page scaffolding remains `PageHeader` and
`PageContainer` from `components/layout`.

```tsx
import { Button } from 'react-bootstrap';
import { Surface, SettingRow } from '../design-system/Primitives';

<Surface className="p-4">
  <SettingRow title="An actual preference" description="Explain what this changes.">
    <Button variant="outline-secondary" onClick={openPreferences}>Configure</Button>
  </SettingRow>
</Surface>
```

Use `primary` for the main action, `outline-secondary` for secondary actions, and
`danger` only for destructive actions. Include hover, disabled, focus, loading,
and failure behavior. Icon-only buttons need an accessible name. Keep visible
keyboard focus. Sidebar collapse, advanced disclosure, theme buttons, and chat
controls expose their accessible state. Maintain contrast and text wrapping at
larger font sizes; do not hide long labels solely to make a screenshot fit.

## Logo and native assets

The mark is an original lowercase h drawn as an open arch. The wordmark is always
**hosea**. `assets/icon.svg` is the canonical native icon: warm white on a charcoal
rounded square. Run `npm run icons:generate` to regenerate PNG, ICNS, and ICO.
Renderer SVG exports live under `src/renderer/assets`; live UI uses `Brand.tsx` so
its color follows appearance. Keep the path geometry consistent with the native
icon. These assets belong to the app's MIT-licensed source.

## Verify a change

Run `npm run design` for an isolated Electron workspace. Check light/dark/system,
text size, sidebar collapse/advanced navigation, the conversation welcome screen,
connections, settings, agents/editor, and a provider form. Check keyboard focus,
long text, and the minimum 880×600 window. Existing sessions, credentials, and
normal app preferences are outside the preview directory.

`npm run test:design` covers appearance normalization/application and the storage
and backend feature gates. A filesystem integration test writes matching session,
routine, instruction, permission, and media data in two workspaces and verifies
that preview writes cannot read or overwrite normal workspace state. `npm run typecheck` and `npm run build` cover renderer,
preload, and main-process integration. Native visual inspection is still required;
these tests do not claim OS-wide installer or provider execution coverage.
