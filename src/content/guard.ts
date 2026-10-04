// Lets our own DOM edits (applying, reverting) be invisible to the DevTools-edit observer.
// observe.ts registers a flusher that drains + discards pending MutationRecords.

let depth = 0
const flushers = new Set<() => void>()

export function onSuppressFlush(fn: () => void): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

/** Run `fn`; any DOM mutations it causes are discarded by the observer. */
export function suppress<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
    for (const f of flushers) f()
  }
}

export const isSuppressed = () => depth > 0
