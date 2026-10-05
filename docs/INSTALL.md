# Install Redline (pre-release build)

Redline is a Chrome extension that lets you edit a page visually (text, styles, drag & drop) and copy the changes as a prompt for your AI coding assistant.

## Install (about 1 minute)

1. Download `redline-0.1.0.zip` and **unzip it into a folder you will keep**, for example `~/Extensions/redline`. Chrome loads the extension from that folder, so don't delete or move it afterwards.
2. In Chrome open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and **pin** Redline.

Chrome may show a "Disable developer mode extensions" notice on startup. Dismiss it; this is normal for extensions installed this way.

## Use it

Open any page (a local dev app works best) and click the Redline icon. A first-run walkthrough explains the rest. In short:

- **Select mode:** click an element, double-click text to edit it, tweak styles in the panel, drag the handles to resize.
- **Drag & drop mode:** reorder elements or move them into another container.
- **Browse mode:** use the page normally.
- **Changes tab:** every change is listed and revertible. Press **Copy for AI** and paste the prompt into your coding assistant.
- **DevTools switch:** also records edits you make in Chrome DevTools (inline styles, text, classes, attributes, added/removed nodes). Edits to a stylesheet rule in the Styles pane are not captured.

Reloading the tab clears your edits, so copy the prompt first.

## Update

Download the new zip, unzip it over the same folder (or into a new one), then on `chrome://extensions` click the reload icon on the Redline card (or Load unpacked again if you used a new folder).

## Known limits

- Top frame only (not inside embedded iframes).
- React/Vue/Svelte source file hints only appear on development builds; otherwise the prompt uses selectors and text.
- Does not run on `chrome://` pages or the Chrome Web Store.

## Feedback

Send bugs and ideas to <your name / channel>.
