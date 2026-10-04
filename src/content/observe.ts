import type { Recorder } from "@/shared/recorder"

// STUB - owned by the "edit + observe" agent. See docs/SPEC.md "Observer".

/** Start capturing DevTools-origin DOM edits into `rec` (origin: "devtools"). `ignore(node)` true => skip (our own UI). */
export function startObserving(_rec: Recorder, _ignore: (n: Node) => boolean): void {
  throw new Error("not implemented")
}
export function stopObserving(): void {
  throw new Error("not implemented")
}
