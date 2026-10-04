import type { Recorder } from "@/shared/recorder"

// STUB - owned by the "drag and drop" agent. See docs/SPEC.md "Drag layer".
export interface DraggerOptions {
  root: ShadowRoot
  isOurs: (n: EventTarget | Node | null) => boolean
  rec: Recorder
  /** Called after a successful drop (element already moved, change recorded) so the controller can select it + refresh the panel. */
  onMoved: (el: Element) => void
}
export interface DraggerApi {
  /** Active only in Mode "move". When inactive, no listeners may swallow page events. */
  setActive(on: boolean): void
  destroy(): void
}
export function createDragger(_opts: DraggerOptions): DraggerApi {
  throw new Error("not implemented")
}
