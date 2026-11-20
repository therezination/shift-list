# Shift List: notes for Claude

A one-handed phone checklist for work shifts, installed to an Android home screen and working offline.
Plain HTML, CSS and ES modules: no build step, no bundler, no framework, no server-side code, no
accounts. Everything is stored on the phone (`localStorage`, photos in `IndexedDB`). `README.md` has the
feature list and the "Where things live" table; `STYLE.md` is the written look and voice standard.

**This is a PUBLIC GitHub repo, published as a static site (GitHub Pages) by pushing.** Never put codes,
passwords, door or login details, names of people or places, or real shift content in any file, commit,
test or example. `src/seed.js` (the starting checklist) is published with the app; keep it generic. Codes
live only on the phone, encrypted, in the Codes tab.

## Working on it

- `npm run serve` serves the folder at http://localhost:8793 (`python -m http.server`); open it in a
  browser. `.claude/launch.json` has a `shift-list` entry for the same thing. Codes and install need
  `https`, so the PIN vault and "Add to Home screen" only work on the published site.
- `npm test` runs `node --test` over `test/store.test.mjs` (day rollover at 04:00, weekday rules, late
  badge, step ids, seed, history, handover text). Keep it green. The UI has no automated test.
- `npm run icons` redraws `icons/*.png` via `tools/make-icons.mjs`.
- Release: bump `VERSION` in `sw.js` on every change that ships, and add any new file to its `SHELL` list,
  or installed phones keep the old copy. Then commit and push; no build, no deploy script.
- Do not commit, push or install anything unless asked.

## Where things live

| Concern | File |
|---|---|
| state shape, day rollover, due/late rules, history, handover text, load/save | `src/store.js` |
| the starting lists (public) | `src/seed.js` |
| PIN-encrypted codes (PBKDF2 + AES-GCM) | `src/vault.js` |
| photo storage and shrinking | `src/photos.js` |
| screens, editor sheets, menu, backup (builds DOM with `h()`) | `src/app.js` |
| colours and layout (tokens in `:root`, dark block for dark mode) | `style.css` |
| offline cache, versioned | `sw.js` |
| page shell, install manifest | `index.html`, `manifest.webmanifest` |

## Conventions

- The working day turns over at 04:00, not midnight; ticks and cash counts clear then. All day logic goes
  through `src/store.js` so the tests cover it.
- User text always goes into the DOM as text nodes, never as HTML.
- Saved data is read through `normalise()` in `src/store.js` (`SCHEMA` is 1); a new field needs a default there so
  old phones' data still loads, and saved data on a phone is never discarded.
- Nothing is sent anywhere. Do not add analytics, remote fonts or network calls to the app code.
- Follow `STYLE.md` for colour roles, tap targets and wording.
