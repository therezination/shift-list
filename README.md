# Shift List

A phone checklist for work shifts. Plain HTML, CSS and ES modules: no build step, no server-side
code, no accounts. It installs to an Android home screen as a web app and works offline.

- **Morning / Evening** (and any lists you add): tick tasks, open a task for its steps and notes.
  Tasks can be limited to certain weekdays and can carry a "finish by" time that turns amber when
  it has passed. Ticks clear themselves each day (the day turns over at 4am).
- **Edit** on any list: tap a task to change its title, steps (one per line), note, days and time;
  arrows reorder; delete needs two taps. The ⋮ menu adds, renames, moves and deletes lists.
- **Mention**: jot down things the next shift should know.
- **Handover**: writes the summary (done with times, not done, things to mention) for a list.
  Edit the wording, then Copy or Share.
- **History**: every finished day is filed automatically, up to 120 days.
- **Codes**: door codes, logins and passwords. With a PIN they are encrypted on the phone
  (PBKDF2 + AES-GCM) and lock when you leave the app. A forgotten PIN cannot be recovered.
- **Back up to a file / Restore from a file** in the ⋮ menu. Codes stay encrypted in the backup.

Everything is stored on the phone (`localStorage`). Nothing is sent anywhere.

## Run it

```bash
npm run serve
```

then open http://localhost:8793. `npm test` runs the rule tests (day rollover, weekday rules,
history, handover text). `npm run icons` redraws the icons.

## Put it on the phone

The app has to be served from an `https` address for Android to install it and for the Codes
PIN to work. Any static host does (GitHub Pages, Netlify, Cloudflare Pages): upload this folder
as it is. Then open the address in Chrome on the phone and choose **Add to Home screen**.

The starting checklist is in `src/seed.js` and is published with the app, so keep anything
private (codes, passwords) out of that file and add it in the app instead.

After changing files, bump `VERSION` in `sw.js` so installed phones pick up the new copy.

## Where things live

| Concern | File |
|---|---|
| state shape, day rollover, due / late rules, history, handover text | `src/store.js` |
| the starting lists | `src/seed.js` |
| encrypted codes | `src/vault.js` |
| screens, editor sheets, menu, backup | `src/app.js` |
| colours and layout | `style.css` |
| offline cache | `sw.js` |
