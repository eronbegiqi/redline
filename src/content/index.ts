import { describe, elementId } from "@/content/describe"
import { createDragger } from "@/content/drag"
import {
  duplicateEl,
  hideEl,
  readStyles,
  removeEl,
  setStyle,
  setText,
} from "@/content/edit"
import { createFrame } from "@/content/frame"
import { suppress } from "@/content/guard"
import { startObserving, stopObserving } from "@/content/observe"
import { createSelector } from "@/content/select"
import type { ToContent } from "@/shared/protocol"
import { Recorder } from "@/shared/recorder"
import type { ElementInfo, Mode, PanelState } from "@/shared/types"

// Controller (entry of dist/content.js): owns the state, wires frame <-> recorder <-> selector/dragger/observer.
// Injected on every toolbar click: the first run builds everything, later runs just toggle the panel.

interface Redline {
  toggle(): void
  destroy(): void
}
const g = globalThis as typeof globalThis & { __redline?: Redline }

const isRootish = (el: Element) =>
  el === document.documentElement || el === document.body

/** Only elements made of nothing but text get a text field (setText would wipe any child element). */
const isTextLeaf = (el: Element) =>
  el.childNodes.length > 0 &&
  Array.from(el.childNodes).every((n) => n.nodeType === 3) &&
  !!el.textContent?.trim()

function start(): Redline {
  let alive = true
  const cleanups: (() => void)[] = []
  const teardown = () => {
    alive = false
    while (cleanups.length) {
      try {
        cleanups.pop()!()
      } catch {
        // best effort: keep tearing down the rest
      }
    }
  }

  try {
    let mode: Mode = "select"
    let resumeMode: Mode = mode // restored when the panel is re-opened
    let recording = false
    let visible = true
    let selected: Element | null = null
    let queued = false

    const frame = createFrame()
    cleanups.push(() => frame.destroy())
    const rec = new Recorder()

    // The host's shadow tree is invisible to contains(): compare its root too.
    const isOurs = (x: EventTarget | Node | null): boolean => {
      if (!x) return false
      if (x === frame.host) return true
      const n = x as Node
      if (typeof n.nodeType !== "number") return false
      return frame.host.contains(n) || n.getRootNode() === frame.root
    }

    const firstChild = (el: Element) =>
      Array.from(el.children).find((c) => !isOurs(c)) ?? null

    function infoOf(el: Element): ElementInfo {
      const r = el.getBoundingClientRect()
      const leaf = isTextLeaf(el)
      return {
        el: elementId(el),
        descriptor: describe(el),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        isTextLeaf: leaf,
        text: leaf ? (el.textContent ?? "").slice(0, 2000) : "",
        styles: readStyles(el),
        hasParent: !!el.parentElement,
        hasChild: !!firstChild(el),
        canDelete: !isRootish(el),
      }
    }

    function snapshot(): PanelState {
      let selection: ElementInfo | null = null
      try {
        if (selected) selection = infoOf(selected)
      } catch (e) {
        console.error("[redline]", e)
      }
      return {
        mode,
        recording,
        selection,
        changes: rec.list(),
        page: {
          url: location.href,
          title: document.title,
          viewport: { width: innerWidth, height: innerHeight },
        },
      }
    }

    function flush() {
      queued = false
      if (!alive) return
      // The page (or one of our reverts) removed the selected element.
      if (selected && !selected.isConnected) {
        selected = null
        selector.select(null)
        watch()
      }
      frame.post({ type: "state", state: snapshot() })
    }

    // Coalesced per task: a burst of recorder changes / selection updates is one state message.
    // ponytail: no per-frame throttle; add one if DevTools recording on an animating page janks.
    function push() {
      if (queued || !alive) return
      queued = true
      queueMicrotask(flush)
    }

    // Detects "selected element removed" without relying on the select layer or on recording being on.
    // Only runs while something is selected, so it costs nothing otherwise.
    const gone = new MutationObserver(() => {
      if (selected && !selected.isConnected) push()
    })
    cleanups.push(() => gone.disconnect())
    function watch() {
      gone.disconnect()
      if (selected && visible)
        gone.observe(document.documentElement, {
          childList: true,
          subtree: true,
        })
    }

    function setSelected(el: Element | null) {
      selected = el
      selector.select(el)
      watch()
      push()
    }

    function setMode(next: Mode) {
      mode = next
      selector.setMode(next)
      dragger.setActive(next === "move")
      push()
    }

    function setRecording(on: boolean) {
      recording = on
      if (visible && on) startObserving(rec, isOurs)
      else stopObserving()
      push()
    }

    /** After a DOM edit: re-measure the overlay and tell the panel (the log may not have changed, e.g. a cancelled edit). */
    function edited() {
      selector.refresh()
      push()
    }

    function act(action: Extract<ToContent, { type: "action" }>["action"]) {
      const el = selected
      if (action === "deselect") return setSelected(null)
      if (!el) return
      switch (action) {
        case "parent":
          if (el.parentElement) setSelected(el.parentElement)
          break
        case "child": {
          const c = firstChild(el)
          if (c) setSelected(c)
          break
        }
        case "delete": {
          if (isRootish(el) || !el.parentElement) return
          const parent = el.parentElement
          removeEl(rec, el)
          if (el.isConnected)
            edited() // removeEl swallowed an error: nothing was deleted
          else setSelected(parent)
          break
        }
        case "hide":
          hideEl(rec, el)
          edited()
          break
        case "duplicate":
          setSelected(duplicateEl(rec, el))
          break
      }
    }

    function close() {
      if (!visible) return
      resumeMode = mode
      setMode("browse")
      visible = false
      stopObserving()
      watch()
      frame.hide()
    }

    function show() {
      if (visible) return
      visible = true
      frame.show()
      setMode(resumeMode)
      if (recording) startObserving(rec, isOurs)
      watch()
      selector.refresh()
    }

    function onMessage(m: ToContent) {
      try {
        switch (m.type) {
          case "ready":
            flush() // not coalesced: the panel is waiting for its first state
            break
          case "setMode":
            if (m.mode === "select" || m.mode === "move" || m.mode === "browse")
              setMode(m.mode)
            break
          case "setRecording":
            setRecording(!!m.on)
            break
          case "setStyle":
            if (selected) setStyle(rec, selected, m.prop, m.value)
            edited()
            break
          case "setText":
            if (selected && isTextLeaf(selected)) setText(rec, selected, m.text)
            edited()
            break
          case "action":
            act(m.action)
            break
          case "undo":
            suppress(() => rec.undo())
            edited()
            break
          case "revert":
            suppress(() => rec.revert(m.id))
            edited()
            break
          case "revertAll":
            suppress(() => rec.revertAll())
            edited()
            break
          case "moveFrame":
            frame.moveBy(m.dx, m.dy)
            break
          case "close":
            close()
            break
        }
      } catch (e) {
        console.error("[redline]", e)
      }
    }

    cleanups.push(rec.subscribe(push))

    const selector = createSelector({
      root: frame.root,
      isOurs,
      rec,
      onSelect: (el) => {
        selected = el
        watch()
        push()
      },
      onChanged: push,
    })
    cleanups.push(() => selector.destroy())

    const dragger = createDragger({
      root: frame.root,
      isOurs,
      rec,
      onMoved: (el) => {
        setSelected(el)
        selector.refresh()
      },
    })
    cleanups.push(() => dragger.destroy())

    selector.setMode(mode)
    dragger.setActive(false)

    frame.onMessage(onMessage)
    // Viewport size is part of the exported page info.
    addEventListener("resize", push)
    cleanups.push(() => removeEventListener("resize", push))
    cleanups.push(stopObserving)

    const api: Redline = {
      toggle: () => (visible ? close() : show()),
      destroy() {
        teardown()
        if (g.__redline === api) delete g.__redline
      },
    }
    return api
  } catch (e) {
    teardown()
    throw e
  }
}

if (g.__redline) g.__redline.toggle()
else g.__redline = start()
