/* The central clock behind every "how long has this agent been up" readout.
 *
 * One interval in src/main.js drives every runtime element in the app rather
 * than each element owning a timer. This module holds the registry and the
 * tick, and is deliberately dependency-free so it can be tested directly --
 * the same reason agent-session-events.js is split out. Importing
 * components.js pulls in sim.js, which schedules timers at import time, so a
 * test that reached this through components.js would never exit.
 *
 * WHAT THE TICK COSTS WHEN NOTHING HAS CHANGED is the thing to keep in mind
 * here: it runs twice a second for the entire life of the process, on every
 * machine, including one sitting idle with no fleet attached. Three things it
 * used to do have been removed for that reason:
 *
 *   1. It copied the whole registry into a fresh array (`[...runtimeEls]`) on
 *      every tick. Iterating the Set directly is safe: deleting the entry the
 *      loop is currently on is defined behaviour for Set iterators, and that
 *      is the only deletion performed.
 *   2. Removing one disconnected element scanned the entire registry to find
 *      it, so tearing down a view with n readouts cost O(n^2). The entry is
 *      already in hand, so deletion is O(1).
 *   3. It assigned `textContent` unconditionally. A runtime readout changes at
 *      most once a second and this runs twice a second, so at least half of
 *      all writes -- and every write on a machine whose digits are parked on a
 *      placeholder -- rewrote the value that was already there. Assigning
 *      textContent dirties the node and costs layout even when the string is
 *      identical. Comparing first makes an unchanged tick a string compare and
 *      no DOM mutation at all.
 *
 * Same digits, same cadence, same elements: only the redundant work is gone.
 */

const runtimeEls = new Set()

export function bindRuntime(elm, bornAtFn) {
  const entry = { elm, bornAtFn, last: undefined }
  runtimeEls.add(entry)
  return () => runtimeEls.delete(entry)
}

export function tickRuntimes(fmt) {
  for (const entry of runtimeEls) {
    const { elm, bornAtFn } = entry
    if (!elm.isConnected) { runtimeEls.delete(entry); continue }
    const next = fmt(bornAtFn())
    if (entry.last !== next) {
      elm.textContent = next
      entry.last = next
    }
  }
}

/* Test-only view of the registry. Exported so a test can prove that a
   disconnected element is actually released rather than merely skipped -- a
   leak here is invisible from the outside and would grow for the life of the
   process. */
export function runtimeRegistrySize() {
  return runtimeEls.size
}
