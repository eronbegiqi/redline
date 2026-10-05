import { useSyncExternalStore } from "react"

import type { ToContent, ToPanel } from "@/shared/protocol"
import type { PanelState } from "@/shared/types"

export interface Snapshot {
  /** null until the content script has pushed the first state. */
  state: PanelState | null
  connected: boolean
}

/** useSyncExternalStore-shaped source of panel state; implemented by the host bridge and by the dev mock. */
export interface Store {
  subscribe: (fn: () => void) => () => void
  /** Must return the same object until something changes. */
  get: () => Snapshot
  send: (m: ToContent) => void
}

type Win = Pick<Window, "addEventListener" | "removeEventListener">

/**
 * Listens for the content script's `{redline:"init"}` message carrying a MessagePort and talks over that port.
 * Only the first init is accepted, and only from `parent` (the embedding page's window) when given:
 * later ones, or ones from any other window, are ignored.
 */
export function createHostStore(win: Win, parent?: unknown): Store {
  let snap: Snapshot = { state: null, connected: false }
  let port: MessagePort | null = null
  const subs = new Set<() => void>()
  const set = (next: Snapshot) => {
    snap = next
    subs.forEach((f) => f())
  }

  const onMessage = (e: Event) => {
    const { data, ports, source } = e as MessageEvent
    if (parent !== undefined && source !== parent) return
    if (port || data?.redline !== "init" || !ports?.[0]) return
    win.removeEventListener("message", onMessage)
    port = ports[0]
    port.onmessage = (ev: MessageEvent<ToPanel>) => {
      if (ev.data?.type === "state")
        set({ state: ev.data.state, connected: true })
    }
    set({ ...snap, connected: true })
    port.postMessage({ type: "ready" } satisfies ToContent)
  }
  win.addEventListener("message", onMessage)

  return {
    subscribe: (fn) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    get: () => snap,
    send: (m) => port?.postMessage(m),
  }
}

/**
 * Not embedded (`npm run dev` at /panel.html): fake page state from dev-mock, loaded on demand so it is its own
 * chunk and never ships in the extension's main panel bundle.
 */
function createLazyMockStore(): Store {
  let inner: Store | null = null
  let snap: Snapshot = { state: null, connected: false }
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())
  void import("@/panel/dev-mock").then(({ createMockStore }) => {
    const mock = createMockStore()
    inner = mock
    snap = mock.get()
    mock.subscribe(() => {
      snap = mock.get()
      notify()
    })
    notify()
  })
  return {
    subscribe: (fn) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    get: () => snap,
    send: (m) => inner?.send(m),
  }
}

// Created at import time on purpose: the content script posts the init message on the iframe's `load`,
// which can fire before React's first effect runs. Module scripts are guaranteed to run before `load`.
const store: Store =
  window.parent === window
    ? createLazyMockStore()
    : createHostStore(window, window.parent)

export function usePanel() {
  const { state, connected } = useSyncExternalStore(store.subscribe, store.get)
  return { state, connected, send: store.send }
}

/** Clipboard write that also works where the async API is blocked (falls back to execCommand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none"
  document.body.append(ta)
  ta.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    ta.remove()
  }
}
