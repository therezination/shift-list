# Shift List style standard

First draft (2026-11-20), derived from the code (`style.css`, `index.html`, `src/app.js`, `src/store.js`, `manifest.webmanifest`) and not yet read through by Rez. Inferred rather than found written down: the tap-target minimums, the spacing and radius scales, the type scale, and every voice rule in section 6. Only the palette roles have a comment in `style.css`. Correct them here if they are wrong.

The look and voice that already exist. Work to this; judge against it. This repo is public: never put codes, passwords, names of people or places, or the starting checklist's contents in examples.

## 1. What it is

A one-handed phone checklist for a work shift: portrait, installed to the home screen, offline, no accounts. Plain HTML, CSS and ES modules. One stylesheet (`style.css`), no framework, no web fonts. Screens are built in `src/app.js` with the `h()` helper. User text always goes in as text nodes.

## 2. Colour roles (`:root` in `style.css`)

Bright blue, white and dark navy. Light by default; dark navy when the phone is in dark mode.

| Variable | Light | Dark | Role |
|---|---|---|---|
| `--brand` | `#00b1e7` | same | header bar, `theme-color`, manifest, icon tile |
| `--on-brand` | `#00263a` | same | text and icons on the header; dark fill for the update bar and cash total |
| `--bg` | `#f2f6f9` | `#071824` | page |
| `--card` | `#ffffff` | `#0e2636` | cards, sheet, bottom bar |
| `--raise` | `#e8f0f5` | `#163448` | fields, badges, tool buttons, empty bar track |
| `--line` | `#d3dee6` | `#21445b` | 1 px borders and row dividers |
| `--text` | `#14242f` | `#e8f3f9` | body text; toast background (inverted) |
| `--muted` | `#536777` | `#93b0c2` | hints, labels, done titles, unchecked box border |
| `--accent` | `#00b1e7` | same | ticks, primary buttons, progress, active tab pill, focus ring |
| `--on-accent` | `#00263a` | same | text on accent (navy, never white) |
| `--warn` | `#ffb454` | same | the "late" badge only (text `#2a1800` on it) |
| `--danger` | `#c0392b` | `#ff8a80` | destructive buttons, recording border and dot |

- New colours go in `:root` (and the dark block if they differ); no raw hex in rules except the existing exceptions (`#fff` on navy, `#2a1800` on warn, shadows).
- Amber means "past its time", never "failed". There is no green "success" colour; done is shown with the accent tick, muted text and strike-through.
- Shadows are only for things that float: dragged card `0 10px 28px rgba(0,0,0,.3)`, update bar, cash total. Sheet backdrop `rgba(0,0,0,.55)`.

## 3. Type

- System stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, 16px / 1.4 body. Inputs inherit it.
- Numbers people read at a glance (times, counts, totals, codes) use the mono stack `ui-monospace, "Cascadia Mono", Consolas, monospace`, bold: 16 code, 18 delivery time, 22 recording timer, 24–26 counters, 32 cash total.
- Scale in px: 11–11.5 tab labels and counts; 12 badges, `small`, box labels; 13 header subline, field labels, history day headings (uppercase, 0.04em); 14 hints, chips, small buttons, toast; 15 empty states, log rows; 16 body; 18 sheet titles, section heads, big buttons; 22 header title.
- Weights: 500 for secondary titles, 600 for titles, buttons and labels, 700 for numbers, tab counts and toast buttons. No italics.

## 4. Size, spacing, shape

- **Tap targets.** Main buttons and fields 46 px high (`.btn`, inputs, `select`); big buttons 60. Chips 40 high × 44 wide; tool buttons 40 × 40; counter and cash buttons 52. Tick column 56 wide with a 28 px box. Tabs at least 58 high. Rows with a tick box (`.tickrow`) 44. Smallest allowed: 36 for text links and the toast's Undo. Native checkboxes are 22 px inside a padded row.
- **Spacing.** Steps of 2, 4, 6, 8, 10, 12, 14, 16 px. Page gutter 16, gap between cards 10, card padding 12–14, sheet padding 20/16 with 14 between parts. Content column max 640 px, centred. Respect `env(safe-area-inset-*)` top and bottom.
- **Radius.** `--radius` 14 for cards and tasks; 12 for buttons, fields, toast, thumbnails at 84 px; 10 for tool buttons; 9 for the tick box; 8 for small thumbs and toast button; 999 (pill) for chips, badges, bars and the tab icon pill; sheet top corners 20.
- Borders are 1 px `--line`; dashed only for "add" buttons; 2 px only for the tick box and the dark-mode cash total.

## 5. Components and states

- **Header** (`#top`): sticky, brand blue, title (ellipsised) over a 13 px subline "date · n of m done". Chips on it: translucent white, `on` = navy with white text. Back is a `‹` chip; options are `⋮`.
- **Bottom bar** (`#tabs`): five fixed places, an outline icon (24 px, stroke 1.8, round caps) over a label. Active = icon in an accent pill and full-colour label. Counts sit in a small inverted pill at the icon's top right.
- **Task card**: tick column, body (title + badges), optional chevron or edit tools. Done: muted, struck-through title. Skipped: opacity 0.6. Not due today: 0.55. Badges are small pills: neutral on `--raise`; `late` amber; `next` and `in` accent.
- **Buttons**: `.btn` neutral card; `primary` accent fill; `danger` red text; `ghost` no fill; `outline`; `small` borderless muted; `add` dashed, muted, label starts with "+ ". Disabled: opacity 0.3–0.6.
- **Sheets**: a bottom `<dialog>` with an `h2` title, content, then an `.actions` row right-aligned (Cancel first, the confirming button last; a ghost danger button pushed left).
- **Toast**: inverted pill above the bottom bar, 2.4 s; 6 s when it carries an Undo button.
- **Update bar**: navy, full width above the tabs, one tap reloads.
- **Delete**: things Undo can bring back delete at once with an Undo toast; things it cannot need a second tap ("Tap again to delete", 3 s) or a confirm sheet.
- **Empty states**: one muted paragraph that says what the page is for and how to add the first item. No illustrations.
- **Progress**: 8 px pill bar, accent fill on `--raise`.

## 6. Motion, modes, accessibility

- Motion is short and functional: tick box 0.15 s, toast 0.2 s (fade and 12 px rise), progress 0.25 s, recording dot pulse 1.2 s. Drag follows the finger with no easing. A 10 ms vibration on counter taps.
- `prefers-reduced-motion: reduce` removes every transition and the pulse. Keep that true for anything new.
- Dark mode follows the phone (`prefers-color-scheme`); there is no in-app switch. Brand and accent stay the same in both.
- Focus: `:focus-visible` 2 px accent outline, offset 2 (navy on the header).
- Icon-only buttons have an `aria-label` that names the thing ("Move {title} up", "Add one: {label}"). The toast is `role="status"` `aria-live="polite"`. Edit has `aria-pressed`; the active tab has `aria-current="page"`.

## 7. Voice

- Plain, practical, second person, as if a colleague wrote it. Calm about undone work: the handover has no not-done list by default; skipped tasks are "not needed today".
- British spelling (the code and README write "cancelled", "colours", "normalise"; few UI strings test it). Sentence case everywhere; Title Case nowhere except the app name.
- Hints and empty states are full sentences with full stops. Toasts, buttons and labels have no full stop. No exclamation marks anywhere.
- Status pattern with a colon: "Done: {title}", "Skipped for today: {title}", "{list}: all done".
- Errors start "Could not …" and say what to do if there is something to do: "Could not save: phone storage is full", "Could not copy. Select the text and copy it by hand." Never "Error", "Failed" or "Invalid".
- Buttons are short verbs or verb phrases: Save, Add, Copy, Clear, Unlock, Start again, Skip for today, Bring back, Stop and save. Rows that add start "+ Add a …".
- Confirms: the title is the question ("Delete {list}?", "Clear history?"); the body says what happens ("Removes the list and its 6 tasks. History is kept."), with "It cannot be undone." when true; the button repeats the verb ("Delete list", "Erase").
- Placeholders are a short description, with "(optional)" or a trailing "…" list of examples.
- Say "phone", not "device"; "tick", not "check"; "list", "task", "steps", "things to mention".
- Generated handover text uses capitals for its section heads ("DONE (n)", "To mention:" as a lead-in) and "- " bullets.

Real examples: "New version ready. Tap to load it." · "Nothing noted yet. Jot things down here during your shift, with a photo if it helps, and they go into the handover." · "Tap again to delete" · "That is not a Shift List backup" · "If you forget the PIN the codes cannot be recovered, so pick one you will remember."

## 8. Critic checklist

- [ ] Colours come from the `:root` variables and work in both light and dark.
- [ ] Every tap target meets section 4; nothing interactive below 36 px.
- [ ] Spacing and radius from the scales; cards 14, buttons and fields 12, pills 999.
- [ ] Numbers people read at a glance are mono and bold.
- [ ] States follow section 5 (done, skipped, late, disabled, empty); destructive actions have Undo or a second tap.
- [ ] Reduced motion honoured; focus ring visible; icon buttons labelled.
- [ ] Wording: sentence case, no exclamation marks, "Could not …" for errors, full stops only on sentences.
- [ ] No private or personal content in anything committed.

## 9. Not yet decided

- A contrast target (for example WCAG AA) is not stated; muted text on `--raise` has not been checked.
- Landscape, tablet and desktop layouts: the manifest locks portrait and the column stops at 640 px; nothing else is specified.
- An icon set beyond the five bottom-bar paths; whether new icons follow the same 24 px, 1.8 stroke style.
- Any animation for opening and closing sheets (none exists).
- Length limits for list names (60 characters in `askText`), task titles and toasts in general.
- Whether a success colour (green) should ever appear.
- An in-app light/dark switch.
