# SIMPEL UNIPDU design system: "Calm"

This file sets the rules for every screen in the app. Read it before changing UI.
The goal is a quiet interface: people should see the one thing they need to act on, not every piece of data at once.

## Principles

1. **One primary action per screen.** It gets the only filled navy button. Everything else is secondary, ghost, or inside a `⋯` menu.
2. **Details on demand.** A list row shows what's needed to recognize and triage an item. IDs, phone numbers, notes and full facility lists belong in the detail view.
3. **Show status once, flag only problems.** One status per row. Say "Ruangan bentrok" when there is a conflict; say nothing when everything is fine.
4. **No decorative emoji.** Use `lucide-react` icons, and only where they help people scan (navigation, empty states, callouts, buttons that are icon-only).
5. **Sentence case, short copy.** "Ajukan peminjaman", not "+ BUAT PENGAJUAN BARU". A page never repeats its own title in a subtitle.
6. **Lines, not boxes.** Separate content with whitespace and hairlines. Use a bordered panel only when content needs a boundary.
7. **Write for a competent admin.** No page intros: no heading under the top bar, no welcome message, no sentence explaining what the page does. Hints are only for constraints people can't guess (file types, size limits) or consequences they need before acting ("Pemohon akan diberi tahu").
8. **No internal IDs.** Don't show record IDs (reservation `PJM-…`, package `PKT-…`, slide, building or email IDs) anywhere in the UI, including modal subtitles and search placeholders. Identify records by name, place and date. The one exception is asset codes on barcode labels and scan results, because staff match them against the physical label.

## Color

The accent is the navy of the Unipdu logo. Neutrals are Tailwind `slate`. Light mode only.

| Token | Hex | Use |
|---|---|---|
| `accent-50` | `#F2F6FB` | Active nav item, selected row, info callout |
| `accent-100` | `#E3ECF6` | Focus ring, avatar background |
| `accent-200` | `#C5D6EB` | Subtle accent borders |
| `accent-500` | `#2B5796` | Focus outline, info dot, links on hover |
| `accent-600` | `#1B4079` | **Primary buttons**, active tab underline, links |
| `accent-700` | `#123262` | Primary button hover, active nav text |
| `accent-800` | `#002D62` | Logo navy; rarely needed in UI |

| Neutral | Use |
|---|---|
| `white` | Page background, panels, modals |
| `slate-50` | Hover on rows and menu items, subtle fills |
| `slate-100` | Row dividers inside tables and lists |
| `slate-200` | Borders, section dividers |
| `slate-300` | Form control borders |
| `slate-400` | Placeholder text, inactive icons, counts |
| `slate-500` | Secondary text, table headers, labels |
| `slate-700` | Body text in tables and forms |
| `slate-900` | Titles, primary text |

**Status colors** are for meaning only, never decoration: `green` = done / approved / available, `amber` = waiting / needs attention, `red` = rejected / conflict / broken, `slate` = cancelled / inactive, `accent` = in progress. They appear as a **dot plus text** (`StatusBadge`) or a tinted `Callout`, never as filled pills.

## Typography

Geist Sans (loaded in `src/app/layout.tsx`).

| Role | Class |
|---|---|
| Page title (top bar) | `text-base font-semibold text-slate-900` |
| Section / modal title | `text-base font-semibold` or `text-sm font-semibold` |
| Body | `text-sm text-slate-700` (14px) |
| Secondary line | `text-[13px] text-slate-500` |
| Metadata, table headers, hints | `text-xs text-slate-500` (12px) |

- **12px is the minimum.** Never use `text-[8px]` to `text-[11px]`.
- Weights: `font-normal`, `font-medium`, `font-semibold`. No `font-bold`, `font-extrabold` or `font-black`.
- No `uppercase` or `tracking-wider` labels. Table headers are sentence case.
- Use `tabular-nums` for numbers that line up (counts, times, money).

## Layout and shape

- 4px spacing grid. Page padding comes from the shell (`px-4 py-6`, `sm:px-8 sm:py-8`); pages don't add their own.
- Forms are at most ~640px wide (`max-w-2xl` modal, or `max-w-xl` on a page).
- Radius: `rounded-md` (6px) for controls, `rounded-lg` (8px) for panels, modals and menus. Avatars are `rounded-full`.
- Borders are 1px `slate-200`. **No shadows**, except popovers and modals (`shadow-lg`, built into `Menu`, `Modal`, `Drawer`).
- Tables stay at 4–5 columns. More data goes in the detail view.

## App shell

Implemented in `src/app/dashboard/layout.tsx`; pages render inside it.

- **Sidebar:** white, grouped (Peminjaman, Aset, Pengaturan), short sentence-case names, 18px icons. The active item is `bg-accent-50 text-accent-700`.
- **Top bar:** page title on the left. On the right: "Scan aset" (only for roles that scan), the inbox bell (a red dot when there's unread mail), and the avatar menu (profile, sign out).
- **Developer tools** (database status, switch role, reset data) are in the avatar menu for `superadmin` only. Reset requires typing `RESET`.
- The top bar already shows the page title, so pages **start with a `PageToolbar`**, not a heading or banner.

## Components

All primitives are in `src/app/components/ui/`. Import from the barrel: `import { Button, Modal } from "../../components/ui";`.

`className` on a primitive is appended, not merged. Only pass classes the primitive doesn't set itself (margin, flex, text alignment). For height and padding use the size props (`size` on buttons, `controlSize` on `Input`/`Select`). `Input`, `Select` and `Textarea` are always `w-full`: size them with a wrapper (`<div className="w-40"><Select …/></div>`). To hide a primitive responsively, wrap it too: `<span className="hidden sm:inline-flex"><Button …/></span>`.

| Primitive | Use it for | Don't |
|---|---|---|
| `Button` | Actions. `variant`: `primary` (one per screen), `secondary` (default), `ghost` (low emphasis), `danger` (destructive confirm), `danger-ghost` (destructive but secondary, e.g. "Tolak" next to "Setujui"). `size`: `sm` in toolbars and rows, `md` in forms. `icon` takes a lucide icon. Defaults to `type="button"`. | Several primary buttons side by side. Emoji in labels. |
| `IconButton` | Icon-only actions (close, delete in a list). `label` is required and becomes the tooltip. | Icon-only buttons for the main action. |
| `Menu` | Row actions behind `⋯`, the avatar menu. Items can be hidden per role with `hidden`. | Putting the row's single most likely action in the menu; keep that one visible. |
| `Modal` + `ModalFooter` | Forms and detail views. For a form, wrap the body in `<form>` and put `<ModalFooter>` inside it. Sizes `sm` / `md` / `lg` / `xl`. | Hand-rolled `fixed inset-0` overlays. |
| `Drawer` | Side panels (inbox). | Long forms. |
| `ConfirmDialog` | Destructive or irreversible actions. `requireText` for dangerous ones. | `window.confirm()`. |
| `Field`, `Input`, `Select`, `Textarea`, `Checkbox` | All form controls. `Field` gives the label, hint and error. | Uppercase labels. Placeholder text instead of a label. |
| `PageToolbar` | The first row of every page: tabs or filters on the left, actions on the right. | A banner card with a title and description. |
| `Tabs` | Switching views of the same list (status filters). Shows counts. | More than ~5 tabs. |
| `Table`, `Th`, `Tr`, `Td` | Lists of records. | Coloring whole rows; more than 5 columns. |
| `StatusBadge` | The single status of a record. Optional `detail` line for the stage ("menunggu penyerahan"). | Two status badges in one row. |
| `Callout` | A problem or an important note (conflict, missing data). | Restating what the screen already says. |
| `Panel` | Content that needs a boundary (dashboard sections, a settings group). | Wrapping every section in a card. |
| `EmptyState` | No data yet / no results. | Illustrations or emoji. |
| `DetailList`, `DetailRow` | Label/value data in detail views. | Tables for a single record. |
| `Avatar` | People. | Colored role badges. |
| `StatGroup` + `Stat` | Up to four key numbers at the top of an overview. Optional one-line `detail`. | Icons, colored numbers, captions that restate the label. |

## Page patterns

**List page** (Persetujuan, Pengguna, Fasilitas):

```tsx
<PageToolbar
  actions={<Button variant="primary" size="sm" icon={Plus}>Ajukan peminjaman</Button>}
>
  <Tabs tabs={tabs} value={tab} onChange={setTab} />
</PageToolbar>
<Table>…rows with 4–5 columns, the next action visible, the rest in <Menu />…</Table>
```

**Detail view:** a `Modal` (size `lg`) with a `DetailList`, any problems as `Callout`s, and the actions in the footer.

**Form:** a `Modal` with `<form>`. Group related fields under small section titles (`text-sm font-semibold`), two columns on desktop only for short fields, `ModalFooter` with "Batal" and one primary submit.

**Calendar:** plain grid with hairlines, today marked with the accent, events as small text rows with a status dot. No legend when `StatusBadge` colors explain themselves.

## Declutter checklist (use when converting a page)

- [ ] The page starts with `PageToolbar`, not a banner. No heading, welcome text or description of the page.
- [ ] No record IDs visible (rows, detail views, modal subtitles, placeholders). Asset codes only next to barcodes.
- [ ] One primary button. Other actions are secondary, or in a `⋯` `Menu`.
- [ ] Rows show at most 4–5 columns; IDs, phone numbers, notes and chips moved to the detail view.
- [ ] One `StatusBadge` per row. "All fine" indicators removed; problems shown as a warning.
- [ ] No emoji, no `text-[8px]`–`text-[11px]`, no `uppercase`, no `font-bold`/`extrabold`/`black`.
- [ ] Accent colors use `accent-*`; success uses `green-*`. No `emerald-*` / `teal-*`.
- [ ] Every overlay uses `Modal`, `Drawer` or `ConfirmDialog`; `confirm()` replaced for destructive actions.
- [ ] Empty lists use `EmptyState`.
- [ ] Works at 390px wide without horizontal page scroll (tables may scroll inside themselves).
- [ ] Only markup changed: state, handlers and data calls are untouched.

## Dark mode

Not supported for now. Don't add `dark:` classes; when dark mode is added, it should come from redefining the color tokens, not per-page classes.
