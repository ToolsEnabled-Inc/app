/* IS THERE STILL AN AGENT BEHIND THIS CIRCLE.
 *
 * WHY THIS IS A MODULE AND NOT FOUR EXPRESSIONS INSIDE THE VIEW. A session is a
 * child process: it dies when the application closes, and the RECORD of it does
 * not. So every screen that draws a saved node has to answer one question --
 * does the thing this record describes still exist -- and src/views/computers.js
 * was answering it in six different places, in six different ways:
 *
 *   the chip's word      node.status === 'starting'          -> "starting", forever
 *   the graph's clock    bornAt set, stoppedAt only if final -> a clock ticking
 *                                                              over a dead child
 *   the rail's answer    same status test                    -> "no answer yet",
 *                                                              for a turn that
 *                                                              ended at shutdown
 *   the Resume verb      same status test                    -> "it is busy,
 *                                                              wait" -- the
 *                                                              refusal that left
 *                                                              no way out
 *   Stop / Interrupt     status only                         -> enabled over a
 *                                                              corpse
 *   the send path        nodeBusy (the one that was right)   -> queued a message
 *                                                              nothing drains,
 *                                                              because the maps
 *                                                              disagreed
 *
 * Measured on the packaged build 2026-08-16: close the app mid-turn, reopen the
 * same profile, and the circle is blue with a runtime climbing past four
 * minutes, the chip says "starting", the chat header says "live session", and a
 * typed message answers "Queued -- sends by itself when this turn finishes".
 * It never finishes. One rule with one name is the fix; six near-copies is how
 * the defect was assembled.
 *
 * `ownedSessions` IS THE ONLY EVIDENCE THERE IS. It is the caller's set of
 * sessions THIS APP RUN opened -- anything with `.has` -- and it cannot be
 * rebuilt from storage, because storage cannot tell a session that is running
 * from one that was running when it was written. A view that hands over a set
 * refilled from disk gets the defect back, which is exactly what happened.
 *
 * Nothing here touches a DOM, a store or a bridge, so the suite drives the real
 * rule rather than matching the source of it.
 */

const BUSY_STATUSES = new Set(['starting', 'running'])
/* 'turn-failed' is a turn that ended badly on a session that really ran --
   over, exactly as 'finished' is over, so the clock stops rather than ticking
   on the canvas above a failure. See NODE_STATUSES in src/fleet-trees.js. */
const TERMINAL_STATUSES = new Set(['finished', 'failed', 'turn-failed', 'interrupted'])

const holdsSession = node => Boolean(node && typeof node.sessionId === 'string' && node.sessionId)

/** Is the session on this record one this run can still reach? */
export function sessionIsLive(node, ownedSessions) {
  if (!holdsSession(node)) return false
  if (!ownedSessions || typeof ownedSessions.has !== 'function') return false
  return Boolean(ownedSessions.has(node.sessionId))
}

/** Is this node mid-turn RIGHT NOW: a busy status over a session that exists. */
export function nodeIsBusy(node, ownedSessions) {
  return Boolean(node && BUSY_STATUSES.has(node.status) && sessionIsLive(node, ownedSessions))
}

/** The record says busy and there is nothing behind it: the app closed mid-turn.
 *  Deliberately distinct from `finished`, which is a turn that really ended. */
export function sessionEndedWithApp(node, ownedSessions) {
  return Boolean(node && BUSY_STATUSES.has(node.status) && holdsSession(node) && !sessionIsLive(node, ownedSessions))
}

/**
 * The runtime face of one node: when it started, when it stopped, whether it is
 * running now.
 *
 * `bornAt` is set for any node that ever held a session, because a run that
 * happened must not render as one that never did (the 2026-08-13 finding).
 * `stoppedAt` is set whenever the run is OVER, and "over" is three states, not
 * two: finished, failed, and the one that had no branch -- saved mid-turn, the
 * app closed, and the session gone with it. A null stoppedAt binds a live clock
 * in src/tree-graph.js, so that missing third state IS the ticking clock.
 */
export function treeNodeClock(node, ownedSessions) {
  const held = holdsSession(node)
  const terminal = Boolean(node && TERMINAL_STATUSES.has(node.status))
  const ended = terminal || sessionEndedWithApp(node, ownedSessions)
  const bornAt = held ? Date.parse(node.createdAt) : NaN
  const stoppedAt = held && ended ? Date.parse(node.updatedAt) : NaN
  return {
    bornAt: Number.isFinite(bornAt) ? bornAt : null,
    stoppedAt: Number.isFinite(stoppedAt) ? stoppedAt : null,
    running: nodeIsBusy(node, ownedSessions),
    terminal,
    endedWithApp: sessionEndedWithApp(node, ownedSessions),
  }
}
