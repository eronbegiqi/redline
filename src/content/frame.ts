import type { ToContent, ToPanel } from "@/shared/protocol"

// STUB - owned by the "controller" agent. See docs/SPEC.md "Frame + controller".
export interface Frame {
  /** The shadow host element appended to <html>. */
  host: HTMLElement
  root: ShadowRoot
  post(msg: ToPanel): void
  onMessage(cb: (m: ToContent) => void): void
  moveBy(dx: number, dy: number): void
  show(): void
  hide(): void
  destroy(): void
}
export function createFrame(): Frame {
  throw new Error("not implemented")
}
