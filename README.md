# Redline

A Chrome (Manifest V3) extension for redlining a live page. Click the toolbar icon on any page and a floating
panel opens: select elements, edit text, tweak styles, resize, drag and drop, delete, hide or duplicate. Every
change is recorded. **Copy for AI** puts a Markdown prompt on the clipboard that tells a coding assistant what to
change in the source: a selector, before/after values, and the React / Vue / Svelte component and `file:line`
when the page is a dev build that exposes them.

It can also record edits you make in Chrome DevTools (inline styles, text, attributes, classes, node
add/remove/move) alongside the ones made in the panel.

## Install

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick the `dist/`
folder. After changing code, run `npm run build` again and press the reload icon on the extension card.

Permissions are only `activeTab`, `scripting` and `clipboardWrite`: Redline touches a tab only after you click
its toolbar icon there.

## Usage

- **Toolbar icon**: opens the panel on the current tab. Click it again to hide or show the panel; your edits
  and the change log stay.
- **Header**: drag it to move the panel. The mode switch picks what the page does:
  - *Select & edit*: click selects an element, double-click edits its text, drag the handles to resize.
  - *Drag & drop*: drag an element to reorder it or drop it inside another.
  - *Browse*: the page behaves normally.
- **Edit tab**: parent/child navigation, Duplicate / Hide / Delete, text, and typography, spacing, size and
  appearance styles.
- **DevTools switch**: off by default. When on, edits you make in DevTools are captured as well.
- **Changes tab**: revert one change or all of them, add notes for the AI, preview the prompt, then
  **Copy for AI**.

If the toolbar icon shows a `!` badge for two seconds, the page cannot be scripted (`chrome://` pages, the
Chrome Web Store, the built-in PDF viewer).

## Known limits

- Editing a *stylesheet rule* in the DevTools Styles pane is not a DOM mutation, so it is not captured.
  Inline `element.style` edits are.
- While "DevTools" recording is on, page-driven changes (animations, re-renders) are recorded too. Remove noisy
  rows with their revert button; recording is off by default.
- Framework source hints only exist for dev builds. Elsewhere the prompt carries the selector and the text.
- Top frame only: no iframes and no closed shadow roots. Reloading the page loses the edits and the log.

## Development

```bash
npm run dev        # panel UI with mock data at /panel.html
npm test           # vitest (jsdom)
npm run typecheck
npm run build      # tsc -b, vite build (panel), esbuild (content/probe/background) -> dist/
```

The panel is React with shadcn/ui and lucide-react. The toolbar icon is the lucide `Ruler` icon rendered to
PNG. The module contract and architecture are in [`docs/SPEC.md`](docs/SPEC.md); the entry points are
`src/content/index.ts` (controller), `src/content/frame.ts` (shadow host and panel iframe) and
`src/background.ts`.

## License

[MIT](LICENSE)
