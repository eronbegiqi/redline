# Redline: spec and module contract

Chrome (MV3) extension. Click the toolbar icon on any page: a floating panel opens. You edit the page
(select, edit text, tweak styles, resize, drag & drop, delete/hide/duplicate) and, optionally, edit in Chrome
DevTools. Every change is recorded. **Copy for AI** puts a Markdown prompt on the clipboard that tells a coding
assistant exactly what to change in the source.

Decisions already made with the user (do not re-litigate):
- Works on local dev apps **and** arbitrary sites -> export always has selector + before/after; framework hints
  (React/Vue/Svelte component, source file:line) are added automatically when detectable.
- Captured change types: text, styles, move/reorder (drag & drop), resize, delete, hide, duplicate.
- Also passively captures **DevTools edits** (text, attributes, inline style, classes, node add/remove/move) via a
  MutationObserver. Edits to a *stylesheet rule* in the DevTools Styles pane are NOT captured (known limit).
- Panel UI = **shadcn/ui (radix base, nova preset) + lucide-react icons**. Do not hand-draw icons or hand-roll components
  that shadcn provides. Colour picker = `react-colorful`.

## Architecture

```
toolbar click -> background.ts -> chrome.scripting.executeScript:
                                   1. probe.js   (world: MAIN)      framework introspection, answers a DOM CustomEvent
                                   2. content.js (isolated world)   everything else
content.js (src/content/index.ts = controller)
  host div (closed shadow root, appended to <html>, z-index max)
    ├─ overlay layers: select.ts (hover/selection box, resize handles), drag.ts (drop indicator)
    └─ <iframe src=panel.html>  (React + shadcn panel; own origin => zero CSS bleed from the page)
  Recorder (src/shared/recorder.ts)  <- edit.ts / observe.ts / drag.ts / select.ts push NewChange
  MessageChannel port  <->  panel (src/shared/protocol.ts)
```

Why an iframe: custom elements (Shoelace-style libs) don't work in Chrome's isolated world and page CSS would bleed
into an in-page React tree. Why the MAIN-world probe: expando properties the page sets on DOM nodes
(`__reactFiber$…`, `__vueParentComponent`, `__svelte_meta`) are invisible from the isolated world.

## Rules for everyone

- TypeScript strict, `erasableSyntaxOnly` (no enums / namespaces / parameter properties). Use `@/…` imports (`@` = `src`).
- Do **not** edit files you don't own (table below). `src/shared/types.ts`, `src/shared/protocol.ts`, `src/content/guard.ts`,
  `public/manifest.json`, this spec are read-only. If the contract is wrong/insufficient, say so in your final report.
- Do not add dependencies. Available: react 19, radix-ui, lucide-react, react-colorful, tailwind 4, class-variance-authority,
  `cn`, vitest + jsdom, esbuild, playwright (+ chromium). New shadcn components: `npx shadcn@latest add <name>`
  (read the shadcn rules: `FieldGroup`/`Field` for forms, `gap-*` not `space-*`, `size-*`, icons via `data-icon` with no
  sizing classes, semantic colour tokens, `ToggleGroup` for 2-7 options, full `Card` composition, `Empty` for empty states).
- Tests: vitest, colocated (`foo.test.ts` next to `foo.ts`). Run `npx tsc -b` and `npx vitest run <your files>` before finishing.
  Real-browser checks: Playwright chromium is installed (`import { chromium } from "playwright"`); bundle a module with
  esbuild to an IIFE string and `page.addScriptTag`. (Branded Chrome ignores `--load-extension`; use Playwright's chromium.)
- Content-script code must never throw into the page and must never leave listeners behind after `destroy()`.
- Keep functions small and boring. Comment only non-obvious *why*.

## Ownership

| Agent | Files |
|---|---|
| shared core | `src/shared/recorder.ts`, `src/shared/export.ts`, their tests |
| describe + probe | `src/content/describe.ts`, `src/content/probe-main.ts`, tests |
| edit + observe | `src/content/edit.ts`, `src/content/observe.ts`, tests |
| select layer | `src/content/select.ts`, tests |
| drag layer | `src/content/drag.ts`, tests |
| panel shell | `src/panel/App.tsx`, `main.tsx`, `index.css`, `bridge.ts`, `dev-mock.ts`, `components/Header.tsx`, `components/ChangesTab.tsx` |
| style editor UI | `src/panel/components/EditTab.tsx`, `src/panel/components/edit/*` |
| controller | `src/content/index.ts`, `src/content/frame.ts`, `src/background.ts`, `public/icons/*`, `build-ext.mjs` |
| e2e (later) | `e2e/*` |

## Recorder rules (src/shared/recorder.ts)

`record(nc)` returns the resulting log entry or `null` when the change cancelled out. IDs `c1, c2, …` (a merged entry keeps its id and its
position; `at` updates). The *merge key* is:

| kind | key | merge result | cancels when |
|---|---|---|---|
| style | `style│el│prop` | before = first.before, after = last.after | before equals after (trim + case-insensitive; null == null) |
| text | `text│el│textNode` | same | before === after |
| attr | `attr│el│name` | same | before equals after |
| class | `class│el` | net added/removed sets (add then remove of the same class cancels) | both sets empty |
| move | `move│el` | from = first.from, to = last.to | from.parent.selector and from.index equal to.parent.selector and to.index |
| delete | `delete│el` | no merge | n/a |
| insert | `insert│el` | no merge | n/a |

Special cases:
- `delete` of an element **absorbs** earlier `style/text/attr/class/move` entries for the same `el` (drop them from the log, keep their reverts
  inside the delete entry so reverting the delete restores the element first and then those reverts run).
- `delete` of an element that has an `insert` entry (created this session): remove **both**, return `null`.
- Each merge appends the new `revert` to the entry's `reverts[]`. `revert(id)` runs reverts **newest→oldest**, drops the entry, notifies subscribers.
  A merge that cancels out does not run reverts (DOM is already back to the original).
- A revert function throwing must not abort the others (catch and continue).
- `list()` returns deep-ish copies without closures so the panel state can be serialised (structuredClone-safe).
- `subscribe` listeners fire once per public mutating call.

## Export format (src/shared/export.ts)

Deterministic Markdown (no clock, no randomness). Structure:

```
# Redline: UI changes to apply

**Page:** {title} - {url}
**Viewport:** {w}×{h} · **Captured:** {capturedAt}

Apply the changes below to this page's source code. Find each element using its component/source hint, selector or text.
Values are computed CSS from the live page: translate them into the project's own styling approach (Tailwind classes, CSS modules,
styled-components, …) instead of adding inline styles, and keep the result responsive.

## Notes            <- only when meta.note is non-empty
{note}

## Changes
### 1. `{selector}` "{text…}"  - React: Hero › CtaButton · src/Hero.tsx:42
- **Style** `background-color`: `rgb(0, 0, 0)` → `rgb(59, 130, 246)`
- **Text**: "Get started" → "Start free"
- **Class**: added `is-active`, removed `muted`
- **Attribute** `href`: `/a` → `/b`
- **Move**: from index 3 in `ul.list` → index 1 in `ul.list` (before `li.first`)
- **Delete**: remove this element
- **Insert** (copy of `li.item`) at index 4 in `ul.list`: `<li class="item">…</li>`
```

Rules: one `###` block per distinct `el`, numbered in order of the element's first change; bullets in log order. Missing `before` renders
`(unset inline / from stylesheet)`; `after: null` renders `(removed)`. Truncate long strings (text 120, html 400) with `…`. Escape backticks inside
inline code. Header line omits parts that don't exist (no source hint -> no `- React:` suffix). A `devtools` origin entry gets a trailing ` _(DevTools)_`.
Empty change list -> a short "No changes recorded." document.

## Describe + probe (src/content/describe.ts, probe-main.ts)

- `elementId`/`elementById`: WeakMap + Map<string, WeakRef<Element>>, ids `e1, e2, …`.
- `selectorFor(el)`: shortest unique selector. Prefer `#id` (if unique and CSS-safe via `CSS.escape`), then `[data-testid="…"]`/`[data-test]`/`[data-cy]` (if unique),
  else `parentSelector > tag:nth-of-type(n)` climbing until an anchor or `html`. Classes are **not** part of the selector (they are volatile); they go in `Descriptor.classes`.
  Postcondition (unit-tested): `document.querySelectorAll(selectorFor(el))` is exactly `[el]`. Handle shadow-DOM-free documents only; never throw (fall back to tag path).
- `describe`: cached first-touch Descriptor (selector, tag, id, classes ≤8 excluding utility noise? no - keep all, cap 8, text = own direct text nodes trimmed ≤80,
  attrs whitelist, source via probe). `redescribe` = fresh, uncached. `placementOf(el)` = `{ parent: redescribe(parent), index, before? }`.
- Probe protocol (synchronous, works because `dispatchEvent` runs listeners of every world synchronously): content sets `data-redline-probe="1"` on the target,
  dispatches `new CustomEvent("redline:probe")` on `document`; probe.js (MAIN) handler finds `[data-redline-probe]`, computes a `SourceHint | null`, writes
  `JSON.stringify(hint)` to `document.documentElement.setAttribute("data-redline-result", …)`; content reads it and removes **both** attributes in a `try/finally`.
  Observer ignores attribute names starting with `data-redline`.
- probe.js is idempotent (`window.__redlineProbe` guard), tiny, never throws, and exposes nothing else.
- Detection (best effort, each independently try/catch):
  - React ≤18: key starting `__reactFiber$` on the element; host fiber `_debugSource {fileName,lineNumber,columnNumber}`; component chain = walk `fiber.return` collecting
    function/class components by `type.displayName || type.name` (skip anonymous / `Fragment` / names starting with lowercase), max 4.
  - React 19: no `_debugSource`; parse first non-`node_modules`, non-`react-dom` frame of `fiber._debugStack?.stack` into file:line:col when present; component chain as above (also via `_debugOwner`).
  - Vue 3: `el.__vueParentComponent` → `type.__file`, `type.name || type.__name`, chain via `.parent`. Vue 2: `el.__vue__` → `$options.name`/`__file`.
  - Svelte: `el.__svelte_meta?.loc {file,line,column}`.
  - Pure functions (`fiberToHint(fiber)`, `vueToHint(instance)`, …) are exported separately and unit-tested with fake objects.

## Observer (src/content/observe.ts)

Single `MutationObserver` on `document.documentElement` (`attributes`+`attributeOldValue`, `characterData`+`characterDataOldValue`, `childList`, `subtree`).
- Registers `guard.onSuppressFlush(() => observer.takeRecords())` so our own edits vanish. Skips records whose target/nodes satisfy `ignore()`, attributes `data-redline*`,
  and the `contenteditable`/`spellcheck` attributes.
- Delivery is batched; compute "new value" for chained records on the same node+attribute from the *next* record's `oldValue` (last record uses the live value).
- Mapping: `style` attr → per-property diffs (parse old/new with a detached element's `style`; `before: null` for a property not previously set inline) as `style` changes with
  revert that restores inline value / removes the property; `class` → `class` change; other attrs → `attr`; `characterData` and replaced text nodes → `text` (target = parent element,
  `textNode` index); removed element nodes → `delete` (revert re-inserts at old parent/next sibling); added element nodes → `insert` (`html` = `outerHTML` ≤2000; revert removes it);
  the same node removed and re-added in one batch → `move` (best-effort indexes). origin = `"devtools"`.
- `describe(el)` is first-touch: for `class` changes make `target.classes` reflect the ORIGINAL class list (re-apply the inverse of the edit).
- `startObserving` is idempotent; `stopObserving` disconnects and is safe to call twice.

## Edit ops (src/content/edit.ts)

All DOM writes go through `guard.suppress`. All functions are no-ops on `<html>` for delete/hide/duplicate and never throw.
- `setStyle`: `before` = existing inline value if set, else computed value; the DOM write uses `style.setProperty(prop, value, "important")` so the preview beats stylesheet
  rules, but the recorded `after` is the plain value. `value === ""` removes the property (after = null). Revert restores the exact previous inline declaration (value + priority) or removes it.
- `setText`: `el.textContent = text`; recorded as `text` change (`textNode: 0`); revert restores previous child nodes (clone them before replacing).
- `recordText`: DOM already changed; revert sets `textContent = before`.
- `removeEl`: remember `parent` + `nextSibling`; revert re-inserts there. Placement for describe is captured before removal.
- `hideEl` = `setStyle(rec, el, "display", "none")`.
- `duplicateEl`: `el.cloneNode(true)` inserted after `el`; strip `id` attributes from the clone (duplicate ids are invalid); change `{kind:"insert", el: elementId(clone), target: describe(clone), placement, html: outerHTML≤2000, duplicateOf: describe(el)}`; revert removes the clone. Returns the clone.
- `readStyles`: `getComputedStyle(el).getPropertyValue(p)` for each `STYLE_PROPS` entry (empty string if unavailable).

## Selection layer (src/content/select.ts)

Only active in `select` mode (`setMode`). Draw in `opts.root` (a position:fixed full-viewport, `pointer-events:none` layer; boxes use viewport coords from `getBoundingClientRect`).
- Hover: outline box + small label (`tag#id.class  W×H`); rAF-throttled `pointermove`. Ignore `isOurs` targets, `<html>`, `<body>`.
- Click: window **capture** listeners for `pointerdown mousedown mouseup click dblclick auxclick contextmenu submit` call `preventDefault()` + `stopImmediatePropagation()` (except
  while text-editing). A click selects `e.target` (use `composedPath()[0]` for shadow trees outside ours) → `onSelect(el)`. Click on empty space/Esc → deselect (`onSelect(null)`).
- Selection box + 3 resize handles (right edge, bottom edge, corner). Dragging applies live preview via `el.style` inside `suppress`, and on pointerup **restores originals then records
  once** via `edit.setStyle(rec, el, "width"|"height", "<n>px")`; shift = keep aspect ratio on corner. Then `opts.onChanged()`.
- Double-click on a text-leaf element (all child nodes are text, ≥1 non-empty): `contenteditable="plaintext-only"` (restore the previous attribute on exit), focus, select all.
  Enter commits (Shift+Enter ignored), Esc cancels (restore text), blur commits → `edit.recordText(rec, el, before, after)` if changed → `onChanged()`. Key events must reach the element.
- Re-measure on `scroll` (capture), `resize`, and `refresh()`. Selected element removed from DOM → clear selection.
- `destroy()` removes every listener and overlay node. In non-select modes the selection box may stay visible but no event may be swallowed.

## Drag layer (src/content/drag.ts)

Active only in `move` mode (`setActive(true)`).
- Capture-phase pointer listeners on window (swallow `click` etc. like select). `pointerdown` on a non-`html/body` element starts a *pending* drag; after 4px movement the drag begins:
  dimmed overlay over the source, a chip following the cursor (`tag.class`), and a drop indicator. Pointer capture is not available on the page; use window listeners.
- Target = first of `document.elementsFromPoint(x, y)` that is not ours, not the dragged element, not inside it, not `html`. Placement:
  edge zones (outer 30% along the parent's main axis: x for `flex-direction: row*`, else y) → **before/after** `target` (indicator = line in the parent's gap); centre zone and `target`
  is a legal container (not `img input br hr video canvas svg textarea select iframe`) → **inside**, appended last (indicator = dashed box).
- Esc or pointerup outside the window cancels. On drop: `from = placementOf(el)`, perform `insertBefore` inside `suppress`, `to = placementOf(el)`; if unchanged → nothing recorded;
  else `rec.record({ kind:"move", el: elementId(el), target: describe(el), from, to, origin:"panel", revert })` where `revert` re-inserts at the original parent/next sibling. Then `onMoved(el)`.
- Auto-scroll when within 40px of the viewport top/bottom while dragging. `setActive(false)` / `destroy()` must abort any in-flight drag.

## Frame + controller (src/content/frame.ts, index.ts, background.ts)

- background: `chrome.action.onClicked` → `executeScript({ target:{tabId}, world:"MAIN", files:["probe.js"] })` then `executeScript({ target:{tabId}, files:["content.js"] })`.
  On failure (chrome:// pages etc.) set badge text `!` for 2s. No other permissions or listeners.
- content `index.ts`: if `globalThis.__redline` exists → `toggle()` and return. Else build: host (`div[data-redline-host]`, `all: initial`, closed shadow root, appended to `<html>`), `Frame`, `Recorder`, `createSelector`,
  `createDragger`, observer wiring; subscribe `rec` → push state; push state on selection change / mode change / `onChanged`. `isOurs(x)`: `x === host` or `host.contains(x as Node)` or `composedPath().includes(host)`.
- Controller state: `mode` (default `select`), `recording` (default false), `selected: Element | null`. Message handling: see `src/shared/protocol.ts`. `setStyle`/`setText`/`action` apply to `selected`.
  `parent`/`child` change selection (child = first element child). After delete → select the parent; after duplicate → select the clone. `undo`/`revert`/`revertAll` wrap `suppress` (the Recorder reverts already do DOM writes; the controller calls them inside `suppress`).
  `close` hides the frame, sets mode `browse` (page works normally), disconnects observer. Toggle re-shows with the previous state.
- `ElementInfo` is built with `edit.readStyles`, `describe`, `getBoundingClientRect`. Never send DOM nodes over the port.
- Frame: iframe `src = chrome.runtime.getURL("panel.html")`, `allow="clipboard-write"`, fixed bottom-right (16px) 360×min(640px, 100vh−32px), 1px border, radius 12px, shadow, `color-scheme: normal`.
  Handshake: on `load`, create `MessageChannel`, `iframe.contentWindow.postMessage({ redline: "init" }, new URL(src).origin, [port2])`; messages flow over the ports only. `moveBy` clamps inside the viewport.
- Build: `build-ext.mjs` (exists). Icons `public/icons/icon-{16,48,128}.png` are rendered from the lucide `ruler`/`square-dashed-mouse-pointer`-style icon SVG that ships in `node_modules/lucide-react` / `lucide-static`-equivalent data. Do **not** hand-draw an icon.

## Panel UI (src/panel)

360px wide, light/dark following `prefers-color-scheme` (toggle `dark` class on `<html>`; must also react to changes). Body has a solid `bg-background`. Everything shadcn + lucide-react.
- **Bridge** (`bridge.ts`): `usePanel()` hook returns `{ state, send, connected }`. On mount, wait for `{redline:"init"}` window message **with a MessagePort**, accept the first one only, then `send({type:"ready"})`.
  `send` is a no-op until connected. When not embedded (`window.parent === window`) use `dev-mock.ts` (rich fake state, `send` mutates it) so `npm run dev` at `/panel.html` shows a realistic UI.
- **Header** (also the drag handle: pointer-capture, post `moveFrame` with `screenX/screenY` deltas): app mark + "Redline", `ToggleGroup` for mode (lucide `MousePointer2`, `Move`, `Hand`; tooltips
  "Select & edit", "Drag & drop", "Browse (use the page normally)"), `Switch` "DevTools" (tooltip explaining it records edits made in DevTools; off by default), close button (`X`).
- **Tabs**: `Edit` | `Changes` (with a count `Badge`). Footer is always visible: a primary **Copy for AI** button (`Copy` → `Check` for 2s; uses `navigator.clipboard.writeText`, falls back to `execCommand("copy")`; disabled when no changes).
- **Edit tab**: no selection → `Empty` state ("Click anything on the page"). With selection: element card (tag + id + class `Badge`s, source-hint badge e.g. `React · HeroCta`, size), parent/child buttons (`ArrowUp`, `ArrowDown`), actions
  Duplicate (`CopyPlus`), Hide (`EyeOff`), Delete (`Trash2`, destructive). Text `Textarea` when `isTextLeaf` (debounced 300ms → `setText`). Style `Accordion` (multiple open): Typography (color, size, weight `Select`,
  line-height, letter-spacing, align `ToggleGroup`), Spacing (padding/margin, 4 sides with a link toggle), Size & layout (width, height, display `Select`, gap), Appearance (background colour, opacity `Slider`, radius, border width/style/colour).
  Colour fields = `Input` + swatch `Popover` containing `react-colorful` (`HexAlphaColorPicker`); convert to `#rrggbbaa`/`rgb()` strings. Length fields accept any CSS value; Enter/blur commits; ArrowUp/Down steps numbers (Shift ×10).
  Inputs show `selection.styles` and re-sync when the selection or the value changes externally; committing an unchanged value sends nothing.
- **Changes tab**: `ScrollArea` list; each row: kind icon (`Paintbrush` style, `Type` text, `Tag` attr, `Hash` class, `Move` move, `Trash2` delete, `CopyPlus` insert), selector (truncate), one-line summary, `Badge` "DevTools" when origin is devtools,
  revert button (`Undo2`, tooltip "Revert this change") → `{type:"revert", id}`. Empty state via `Empty`. Below the list: `Textarea` "Notes for the AI (optional)", an `Accordion` item "Preview prompt" (read-only `Textarea` with the live `buildExport` output), and "Revert all" (`RotateCcw`; two-step confirm inline).
- Accessibility: every icon-only button has `aria-label`; focus rings intact; keyboard reachable.

## Known limits (state them in the README, don't hide them)

- DevTools Styles-pane *rule* edits aren't DOM mutations → not captured (inline `element.style` edits are).
- Page-driven mutations (animations, re-renders) are noise while "DevTools" recording is on; rows have a revert/✕ to prune, and recording is off by default.
- Framework source hints exist only for dev builds; elsewhere the AI gets selector + text.
- Top frame only (no iframes / closed shadow roots). Reload loses edits and the log.
