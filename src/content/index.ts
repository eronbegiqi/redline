import { describe, elementById, elementId } from "@/content/describe"
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

/**
 * delete / hide / duplicate: never <html>/<body>, and the node needs a parent to leave or to be cloned next to.
 * This is ElementInfo.canDelete, so the panel's buttons and the controller agree on when an action can run.
 */
const canMutate = (el: Element) => !isRootish(el) && !!el.parentNode

const classCount = (el: Element) =>
  (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).length

/**
 * The text a text field may edit: the element's only text node when everything else in it is an icon-like child with
 * no text of its own (svg, img, i...), so a button with a leading icon still qualifies. Null otherwise: setText
 * would wipe real child elements.
 */
const editableText = (el: Element): Text | null => {
  const kids = Array.from(el.childNodes)
  const texts = kids.filter(
    (n): n is Text => n.nodeType === 3 && !!(n as Text).data.trim()
  )
  const ok = kids.every(
    (n) =>
      n.nodeType === 3 ||
      (n.nodeType === 1 && !(n as Element).textContent?.trim())
  )
  return ok && texts.length === 1 ? texts[0] : null
}
const isTextLeaf = (el: Element) => !!editableText(el)

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

    /** The element an edit message was made for: known, and still in the page (it may be gone or no longer selected). */
    const target = (id: string) => {
      const el = elementById(id)
      return el?.isConnected ? el : null
    }

    function infoOf(el: Element): ElementInfo {
      const r = el.getBoundingClientRect()
      const leaf = isTextLeaf(el)
      return {
        el: elementId(el),
        descriptor: describe(el),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        isTextLeaf: leaf,
        text: leaf ? (editableText(el)?.data ?? "").slice(0, 2000) : "",
        styles: readStyles(el),
        classCount: classCount(el),
        hasParent: !!el.parentElement,
        hasChild: !!firstChild(el),
        canDelete: canMutate(el),
      }
    }

    function snapshot(): PanelState {
      let selection: ElementInfo | null = null
      try {
        // describe() caches the FIRST descriptor of an element: never feed it one that is already out of the page.
        if (selected?.isConnected) selection = infoOf(selected)
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
      push() // first: a throwing overlay must not keep the panel from learning about the edit
      selector.refresh()
    }

    /**
     * Acts on the element the panel asked about (`id`), which is not necessarily the selection any more.
     * Only the selection itself may move the selection.
     */
    function act(
      action: Extract<ToContent, { type: "action" }>["action"],
      id: string
    ) {
      const el = target(id)
      if (!el) return
      const isSelected = el === selected
      switch (action) {
        case "deselect":
          if (isSelected) setSelected(null)
          break
        case "parent":
          if (isSelected && el.parentElement) setSelected(el.parentElement)
          break
        case "child": {
          const c = firstChild(el)
          if (isSelected && c) setSelected(c)
          break
        }
        case "delete": {
          if (!canMutate(el)) return
          const parent = el.parentElement
          removeEl(rec, el)
          // removeEl swallows errors: only an element that is really gone moves the selection
          if (isSelected && !el.isConnected) setSelected(parent)
          else edited()
          break
        }
        case "hide":
          if (!canMutate(el)) return
          hideEl(rec, el)
          edited()
          break
        case "duplicate": {
          if (!canMutate(el)) return
          const clone = duplicateEl(rec, el)
          if (isSelected) setSelected(clone)
          else edited()
          break
        }
      }
    }

    function close() {
      if (!visible) return
      resumeMode = mode
      // Hide before touching the layers: whatever they do about a vanished selection, the panel must go away.
      visible = false
      frame.hide()
      stopObserving()
      watch()
      setMode("browse")
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
          case "setStyle": {
            const el = target(m.el)
            if (!el) break
            setStyle(rec, el, m.prop, m.value)
            edited()
            break
          }
          case "setText": {
            const el = target(m.el)
            if (!el || !isTextLeaf(el)) break
            setText(rec, el, m.text)
            edited()
            break
          }
          case "action":
            act(m.action, m.el)
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
