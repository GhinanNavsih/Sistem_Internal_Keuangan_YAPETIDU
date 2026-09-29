# UI & UX principles: the "calm interface"

A portable guide for building admin panels, dashboards and internal tools that feel quiet, fast and obvious. It describes *how to think* about screens, not a specific theme: use it with any colors, fonts or component library.

The core idea: **every element on screen has to earn its place.** The people using the tool are competent and use it daily. Show them what they need to act on, keep everything else one click away, and never explain what they can already see.

---

## 1. Principles

1. **One primary action per screen.** Only one button gets the filled, colored style. Everything else is secondary, low-emphasis, or tucked into a "more" (`⋯`) menu. If two actions compete for attention, neither wins.
2. **Details on demand.** Lists show just enough to recognise and triage an item. Everything else (IDs, contact numbers, notes, long lists) lives in a detail view one click away.
3. **Show status once. Flag only problems.** Each record has one status. Don't decorate healthy items with "OK", "Available", "In stock" badges; say something only when something is wrong ("Room conflict", "Low stock").
4. **Write for a competent user.** No page intros, welcome messages or sentences that describe the page. The page title and the content speak for themselves.
5. **Lines, not boxes.** Separate content with whitespace and thin dividers. Use a bordered container only when content genuinely needs a boundary. Cards inside cards inside cards are clutter.
6. **Consistency beats cleverness.** The same thing looks and behaves the same everywhere: one way to show status, one way to confirm a deletion, one filter row pattern, one date format.
7. **Honest UI.** Labels describe what actually happens. Numbers come from real data. Buttons that look clickable do something.

---

## 2. Page structure

**The shell**
- A sidebar for navigation, grouped into a few named sections, with short labels ("Users", not "User account management").
- A slim top bar with the **page title** on the left and a handful of global controls on the right: notifications, the one frequent global action (if any), and an avatar menu holding profile and sign out.
- Developer/testing tools (environment badges, "switch role", "reset data") never appear to normal users. Put them in the avatar menu, visible only to a super-admin.

**The page itself**
- Because the top bar already shows the title, **a page starts directly with its toolbar**, never with a heading, banner or description.
- **Toolbar pattern:** view tabs or filters on the left, the page's actions on the right (primary action last). On phones, actions sit above the tabs.
- Page padding comes from the shell, not from each page, so every page lines up.

---

## 3. Lists and tables

- **4–5 columns maximum.** If you need more, the extra data belongs in the detail view. Combine related data into one cell with a muted second line (name + email, event + location).
- **Primary text + muted secondary line** is the workhorse pattern for a cell: the thing you scan for in normal weight, context underneath in smaller grey text.
- **Actions per row:** keep the *single most likely next action* visible as a small secondary button ("Approve", "Check"). Everything else goes in a `⋯` menu. Destructive actions go last in that menu, separated by a divider.
- **Row → detail:** make the row's title clickable to open the detail view.
- **Status column:** one status badge (a colored dot + a word). If there's a meaningful sub-stage, show it as a small muted line under the status ("Approved · awaiting handover"), not as a second badge.
- **Problems inline:** a small warning line with an icon under the status, only when there is an actual problem.
- **Tabs with counts** above a list for the main states ("All 8 · Pending 1 · Approved 4 …"). Counts let people see where work is without clicking.
- **Humanise data:** "24 Sep 2026", not "2026-09-24". Times with a consistent format and unit. Money with thousands separators. Use tabular (monospaced) numbers so columns line up.
- **Order by what matters:** date lists sorted by date, queues sorted by urgency.
- **Empty states:** a quiet icon, one short line ("No pending requests"), and, only if useful, one action. Different message for "nothing exists yet" vs. "nothing matches your filter".
- **Loading:** a short "Loading…" line or skeleton, never a blank screen.

---

## 4. Detail views

- Open in a modal (or side panel) from the list; the title is the record's human name, not its ID.
- Use a **label/value list** (label column on the left, values on the right, thin dividers between rows).
- Put **problems first** as a tinted callout above the details (conflicts, rejection reasons, notes that need attention).
- Put the record's **actions in the footer**: secondary actions on the left side of the group, the primary one on the right. Destructive actions styled as red text, not a big red button, unless they're the confirmation itself.

---

## 5. Forms

- **Labels above fields, always.** Never rely on placeholder text as the label; placeholders are for examples ("e.g. Seminar on entrepreneurship").
- **Group long forms into short titled sections** ("Requester", "Event and place", "Time", "Extras"). A form with 20 unlabeled fields is a wall; four sections of five fields is a conversation.
- **Two columns only for short, related fields** (date + time, quantity + unit). Long text fields span the full width. Everything collapses to one column on phones.
- **Hints only for things people can't guess:** constraints ("PDF or image, max 5 MB"), formats, or consequences ("Sent to the requester"). Never hints that restate the label.
- **Mark required fields** consistently (a small asterisk), and don't mark optional ones "(optional)" everywhere.
- **Sensible defaults** so most forms can be submitted with minimal typing.
- **Validate where the problem is.** Show conflicts and errors next to the field or as a callout in the relevant section. Disable submit when submission can't succeed and make the button say why ("Schedule conflict" instead of "Submit").
- **Collapse secondary lists** (e.g. "Existing bookings in this room (4)") behind a disclosure so they're available but not in the way.
- **Footer:** "Cancel" (secondary) + one primary submit, right-aligned. A dangerous action in an edit form ("Delete account") sits on the far left of the footer as red text.
- **Inline "shortcut" links** next to a label are fine for power features ("Enter manually", "Fill from room data"), small and in the accent color.
- **Uploads:** show thumbnails of what's attached, each with a remove control, plus an obvious upload tile. Show progress, and block saving while uploads are running.

---

## 6. Buttons and actions

**Hierarchy (use exactly these, consistently):**
| Kind | Use for |
|---|---|
| Primary (filled accent) | The one main action of the screen or form. |
| Secondary (outlined) | Normal actions, row actions, "Cancel". |
| Ghost (text only) | Low-emphasis actions, toolbar extras, "Add another". |
| Danger (filled red) | Only the final "Yes, delete" in a confirmation. |
| Danger ghost (red text) | Destructive actions that aren't the confirmation step. |

- **Label with a verb**, sentence case, short: "Add user", "Approve", "Print labels". Not "SUBMIT", "Click here", "OK".
- **Icon-only buttons** must have an accessible label and a tooltip. Use them only for universally understood actions (close, more, previous/next, delete in a list).
- **Loading state** on buttons that trigger slow work (spinner inside, disabled while running).
- **Default button type is "button",** not "submit", so buttons inside forms never submit by accident. Only the real submit is a submit.
- **Confirm destructive actions** with a dialog that states the consequence in plain words ("This room will be removed from the building."). For catastrophic actions (wipe data), require typing a word like `RESET`.
- **Never use the browser's native `confirm()`/`alert()`** for new UI; they look broken and can't be styled or explained.

---

## 7. Filters and search

- **Search first, then a few filters**, in one row above the list. Search placeholder says what's searchable ("Search name, email or ID number").
- **Main states as tabs** (with counts); **secondary dimensions as dropdowns** (building, role, category). If there are more than ~5 values, it's a dropdown, not tabs or a row of pill buttons.
- **Consistent widths:** search ~256px, dropdowns sized to their content (~160–220px); full width on phones, two dropdowns side by side.
- **Period navigation** (for calendars): "‹ Today ›" with the current period label, grouped on the right.
- Filters persist while navigating the same page and reset to sensible defaults on load.
- Hide controls that don't apply to the current view (e.g. no week navigation on a plain list).

---

## 8. Status and feedback

- **Status = colored dot + word.** Not filled pills, not all-caps badges, not emoji. The word carries the meaning; the dot helps scanning.
- **Status colors are for meaning only:** green = done/approved/available, amber = waiting/needs attention, red = rejected/conflict/broken, grey = cancelled/inactive, accent = in progress. Never use them decoratively.
- **Callouts** (tinted box with an icon) for problems and important notes inside forms and detail views. One sentence where possible.
- **Success feedback** is short and specific ("Password updated."). No celebration emoji.
- **Counts as quiet signals:** a small number next to a tab or section title, a red dot on the notification bell; not flashing banners.

---

## 9. Copy and microcopy

- **Sentence case everywhere** (titles, buttons, labels, tabs). No ALL CAPS, no Title Case For Everything.
- **Short over complete.** "Pending" beats "Waiting for approval from the general affairs bureau". Put the long version in the detail view if it matters.
- **One term per concept** across the whole product. If it's "Booking" in one place, it's never "Reservation" or "Request" elsewhere.
- **No internal identifiers** in the UI: database IDs, record codes, technical status keys. Identify records by name, place and date. Exception: codes people physically match against (barcode labels, printed tickets), shown only where they're used.
- **No jargon from the implementation** ("Firestore", "sync", "payload") in user-facing screens.
- **Confirmations state consequences,** not questions of courage ("Are you SURE?!").
- **Placeholders are examples,** not instructions.

---

## 10. Visual rules (theme-independent)

- **One accent color** for primary actions, active navigation, links and focus. Everything else is neutral grey.
- **White (or near-white) background; hairline borders** (1px light grey) instead of shadows. Shadows only on things that float: menus, modals, drawers.
- **A small, fixed type scale:** page title, section title, body (~14px), secondary (~13px), metadata (~12px). **Nothing smaller than 12px.**
- **Three weights max:** regular, medium, semibold. No bold/extra-bold/black.
- **No uppercase, letter-spaced labels.** Table headers are small, grey, sentence case.
- **A 4px spacing grid;** generous whitespace between sections, tight spacing inside a group.
- **Consistent radius:** small for controls, slightly larger for panels and modals.
- **One icon set,** one stroke width, one or two sizes. Icons support labels; they rarely replace them.
- **No emoji** as icons or decoration.
- **Photos are content, not decoration:** show them large where they matter (hero, gallery, cards), small and consistent elsewhere (thumbnails), with a neutral placeholder when missing or broken.

---

## 11. Responsive behavior

- **Test at two widths: ~1440px and ~390px.** No horizontal page scrolling at either; wide tables may scroll inside their own container.
- **Columns collapse into rows on phones:** hide secondary columns and fold their key info (date, status) into the main cell.
- **Row actions move into the `⋯` menu** on phones.
- **Toolbars stack:** actions above tabs; filters go full width, dropdowns two per row.
- **Sidebar becomes a slide-over** with a backdrop; the top bar keeps only icon versions of its controls.
- **Modals scroll from the top** when taller than the screen; never vertically center content that can overflow (its top becomes unreachable).

---

## 12. Accessibility basics

- Visible focus outline on every interactive element (accent color, offset).
- Every input has a real label; icon-only buttons have `aria-label` + tooltip.
- `Esc` closes menus, modals and lightboxes; clicking the backdrop closes modals.
- Menus and popovers are positioned so they're never clipped by scrolling containers.
- Click targets at least ~32px; text contrast meets WCAG AA.
- Status is never conveyed by color alone (the dot always comes with a word).

---

## 13. Roles and permissions

- **Show only what the current role can do.** Hide actions the user can't take instead of showing disabled ones that lead nowhere.
- **Tailor the home screen per role:** approvers see what's waiting for approval; field staff see their queue; requesters see their own requests. No empty panels that can never fill for that role.
- **Testing and admin tooling is invisible to everyone but the super-admin.**

---

## 14. Things to avoid (anti-patterns)

| Avoid | Do instead |
|---|---|
| Page intros, welcome banners, "This page lets you…" | Start with the toolbar. |
| A subtitle that repeats the title | Nothing. |
| Several filled/colored buttons side by side | One primary; the rest secondary or in a menu. |
| Rainbow badges for categories and types | Muted text ("Staff · Imported"). |
| "OK / Available / In stock" badges on every row | Show only problems. |
| Two or three statuses per row | One status + optional muted stage line. |
| Emoji in labels, buttons, headings | Icons from one set, or just text. |
| 8–11px text, ALL CAPS labels, extra-bold everywhere | 12px minimum, sentence case, 3 weights. |
| Database IDs and record codes in lists and titles | Names, places, dates. |
| Duplicate controls (profile in sidebar *and* top bar) | One place for each thing. |
| Stats cards that repeat tab counts | Remove them, or show genuinely new numbers. |
| Invented or hard-coded "marketing" numbers | Live counts from real data. |
| Labels that misdescribe the action ("Reset defaults" that deletes everything) | Name the real effect. |
| Native `confirm()` / `alert()` for destructive actions | A confirmation dialog stating the consequence. |
| Dev tools and environment badges visible to all users | Super-admin-only menu. |
| Dead links, filters with hard-coded options that don't match data | Derive options from data; test every link. |
| Nested cards, heavy shadows, gradients behind content | Hairlines, whitespace, flat surfaces. |
| Showing everything "just in case" | Details on demand. |

---

## 15. How to implement it in a new project

1. **Write a short design doc in the repo first** (tokens, type scale, component list, page patterns, a conversion checklist). Point the project's contributor/agent instructions at it.
2. **Define tokens** (accent scale, neutrals, status colors) in one place; never hard-code colors in pages.
3. **Build a small set of primitives before any page:** Button, IconButton, Input/Select/Textarea/Checkbox with Field (label + hint + error), Modal + ModalFooter, Drawer, ConfirmDialog, Menu, Tabs, PageToolbar, Table (Th/Tr/Td), StatusBadge/StatusDot, Callout, EmptyState, DetailList, Stat, Avatar, Lightbox. Pages should be assembled almost entirely from these.
4. **Size and variant props instead of class overrides.** If your styling system doesn't merge conflicting classes, passing overrides like a second height or width produces random results. Wrap components to size them; add props for sizes and variants.
5. **Share display helpers** (date/time formatting, status mapping, labels) across pages so the same data always reads the same.
6. **Convert one pilot page first**, review it with the users, adjust the primitives and the doc, then roll out page by page.
7. **When restyling an existing app, change markup only.** Keep state, handlers and data calls untouched; it keeps the redesign safe to ship.
8. **Verify visually** after each page: screenshots at desktop and phone width, check for console errors and horizontal overflow.

---

## 16. Pre-ship checklist (per screen)

- [ ] Starts with a toolbar; no heading, banner or description of the page.
- [ ] Exactly one primary button.
- [ ] Lists have ≤5 columns; secondary info is in the detail view.
- [ ] One status per record; healthy states aren't badged; problems are flagged.
- [ ] No internal IDs visible (except codes people match physically).
- [ ] No emoji, no text below 12px, no uppercase labels, no bold/extra-bold.
- [ ] Every overlay uses the shared modal/drawer/confirm components; no native `confirm()`.
- [ ] Destructive actions confirmed with a stated consequence.
- [ ] Empty, loading and error states designed.
- [ ] Labels are sentence case, short, verb-first for actions, consistent terms.
- [ ] Works at 390px wide with no horizontal page scroll.
- [ ] Only the actions the current role can take are visible.
