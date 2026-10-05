# Chrome Web Store listing: Redline

Everything to paste into the Developer Dashboard (https://chrome.google.com/webstore/devconsole). Items in `<angle brackets>` are yours to fill in.

## Package

```bash
npm run package      # builds, then writes release/redline-<version>.zip (manifest.json at the zip root)
```

Upload that zip under **New item**. Every later upload needs a higher `version` in `public/manifest.json`.

## Store listing tab

**Name** (max 75): `Redline: Visual Editor for AI Prompts`
(Check the store for name clashes before submitting.)

**Summary** (max 132, comes from the manifest `description`):
`Edit any page visually (text, styles, drag & drop), record the changes, and copy them as a prompt for your AI coding assistant.`

**Category:** Developer Tools
**Language:** English

**Detailed description:**

```
Redline lets you change a web page by hand, then hand the changes to your AI coding assistant to apply in the real source code.

Click the Redline icon on any page and a small panel opens. From there you can:

• Select any element and edit its text in place
• Change colours, fonts, spacing, size and borders from a style panel
• Resize elements by dragging handles
• Drag and drop to reorder elements or move them into another container
• Duplicate, hide or delete elements
• Optionally record edits you make in Chrome DevTools too (text, inline styles, classes, attributes, added and removed nodes)

Every change is logged, merged per element and property (ten colour tweaks become one before/after), and can be reverted one by one. When you are happy, press "Copy for AI". Redline writes a clear Markdown prompt that lists each element (CSS selector, text, classes, and the React, Vue or Svelte component and source file when the page is a dev build) with exactly what changed, then asks your assistant to apply it using the project's own styling approach, for example Tailwind classes or CSS modules.

Works on local dev apps and on any other site.

Private by design: Redline makes no network requests, has no account, collects nothing and sends nothing anywhere. Everything stays in your browser until you paste it yourself.

Good to know
• Edits live on the page only. Reloading the tab clears them, so copy the prompt first.
• Edits to a stylesheet rule in the DevTools Styles pane are not captured; edits to an element's inline style are.
• Source file hints only exist on development builds of React, Vue and Svelte apps. Elsewhere the prompt uses selectors and text.
• Works in the top frame of a page, not inside embedded iframes.
```

**Graphic assets** (generated; regenerate any time with `npm run screenshots`, which captures the real extension on the demo page `store/demo.html`)

| Asset | Spec | File |
|---|---|---|
| Store icon | 128×128 PNG | `public/icons/icon-128.png` (already in the zip) |
| Screenshot 1 | 1280×800 | `store/screenshots/01-select-and-edit.png`: "Select anything and edit it visually" |
| Screenshot 2 | 1280×800 | `store/screenshots/02-drag-and-drop.png`: "Drag and drop to reorder or move" |
| Screenshot 3 | 1280×800 | `store/screenshots/03-changes.png`: "Every change is logged and revertible, including DevTools edits" |
| Screenshot 4 | 1280×800 | `store/screenshots/04-prompt-preview.png`: "Copy a ready-made prompt for your AI" |
| Screenshot 5 | 1280×800 | `store/screenshots/05-walkthrough.png`: "Up and running in a minute" |
| Small promo tile | 440×280 | `store/screenshots/promo-small-440x280.png` |
| Marquee promo tile | 1400×560 (optional) | `store/screenshots/promo-marquee-1400x560.png` |

All are 24-bit RGB PNGs with no alpha, as the store requires. The demo page is a fictional product ("Northwind"), so no real brand appears.

**Support / homepage URL:** `<your repo or site URL>`

## Privacy practices tab

**Single purpose:**
`Let the user visually edit the current web page and export a record of those edits as a text prompt for an AI coding assistant.`

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `activeTab` | Redline only runs on the tab where the user clicks the toolbar icon. It needs temporary access to that tab to show the editor and read and change the page the user is editing. |
| `scripting` | Used once, when the user clicks the toolbar icon, to inject the editor scripts into that tab. Needed because the extension has no always-on content script and no host permissions. |
| `clipboardWrite` | Used to copy the generated prompt to the clipboard when the user presses "Copy for AI". <remove this permission and this row if testing shows copying works without it> |

**Host permissions:** none requested.
**Remote code:** No. All code is bundled in the package.

**Data usage:** tick **none** of the collection categories. Redline reads the page the user is editing only to build the prompt the user asks for; that text is copied to the local clipboard and is never transmitted, stored on a server, sold, or used for anything else.
Check all three certifications (no sale of data, no unrelated use, no creditworthiness use).

**Privacy policy URL:** host `docs/PRIVACY.md` somewhere public (GitHub Pages, a gist, your site) and paste the URL: `<privacy policy URL>`

## Distribution tab

- Visibility: Public (or Unlisted for a first run)
- Regions: all
- Pricing: free

## Pre-submission checklist

- [ ] `npm run package` succeeds; unzip and load the folder in Chrome with Load unpacked to confirm it runs
- [ ] Click through on a real site in real Chrome (toolbar click, select, edit, drag, Copy for AI, paste somewhere)
- [ ] Decide whether `clipboardWrite` is needed (test Copy for AI without it) and update the manifest and the table above
- [ ] Name is not taken in the store
- [x] Screenshots and promo tiles generated (`npm run screenshots`)
- [ ] Privacy policy hosted and linked; contact address filled in
- [ ] Version bumped if re-uploading

## Likely review questions

- "Why can it run on any site?" It runs only after a click, on that tab, via `activeTab`; there are no host permissions and no background activity.
- "`web_accessible_resources` for all URLs?" The editor panel is an extension page shown in an iframe on the page the user chose to edit, so the page must be allowed to frame it. `use_dynamic_url` keeps its address unguessable per session.
- "Does it read page data?" Only the page the user is editing, only on demand, only to build the prompt the user copies.
