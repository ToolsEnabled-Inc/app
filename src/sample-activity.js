/* THE EXAMPLE FLEET'S OWN RUN RECORD.
 *
 * The home screen used to answer the demonstration by SUPPRESSING things:
 * `runsAvailable = mode !== SAMPLE`, `clock = null`, and the status facts
 * collapsed to a single line. The rule behind that is right and is kept --
 * "mixing this computer's real run record into a box badged as an example would
 * make half of it true" -- but it was implemented as showing NOTHING, so the
 * demonstration rendered as the live screen with its contents deleted. The
 * owner found it from the other side, in the installed app: switching a view to
 * the example produced a visibly worse screen than the product it was meant to
 * be demonstrating.
 *
 * SUBSTITUTION, NOT SUPPRESSION. The honesty rule forbids REAL data in a box
 * badged as an example. It does not require the example to be empty. So the
 * demonstration gets a record of its own, and the badge stays true because
 * nothing here is anybody's data. This also matches the owner's ruling of
 * 2026-08-06 on the computers page -- "changing source is the worst way to fix
 * the problem" -- the render should absorb the data shape rather than switch to
 * a different, poorer face.
 *
 * IT IS BUILT AS A RAW LEDGER REPLY AND PARSED BY readLocalSessions, rather
 * than hand-assembled in the parsed shape. That parser rejoins outcome records
 * to their starts, distinguishes "refused" from "no outcome recorded", and
 * derives the totals; a hand-built record would drift from those rules the
 * first time they changed, and the demonstration would quietly start showing a
 * shape the real screen can no longer produce. Going through the real parser
 * means the example is exercised by the same code as a real machine.
 *
 * DETERMINISTIC ON PURPOSE. No Math.random and no persisted state: the same
 * nowMs produces the same record every render. A demonstration that reshuffles
 * itself on every navigation reads as broken, and it also makes a screenshot
 * impossible to compare against the next one.
 */

/* Real codes from ENGINE_REASON. Invented ones would render as the empty string
 * -- COPY.runReason is deliberately silent for a code nobody wrote a sentence
 * for -- so the demonstration would show refusals with no reason, which is the
 * exact defect the reason field was added to fix. */
const REFUSAL_CODES = Object.freeze([
  'AGENT_TIER_NO_LAUNCHER',
  'AGENT_CONFINEMENT_SIGNED_OUT',
  'SPAWN_RECORD_NO_KEYSTORE',
])

/* What the example fleet was asked to do. Written as things a person would
 * actually type, because this list is read as English on the screen -- and kept
 * unmistakably to the demonstration's own world (lanes, gates, sweeps) rather
 * than borrowing anything that could be mistaken for a real machine's work. */
const SAMPLE_ASKS = Object.freeze([
  { agent: 'codex', ask: 'claim the next phase and report evidence, not intent' },
  { agent: 'claude', ask: 'spot-verify the claims against the live files' },
  { agent: 'luna-02', ask: 'fan the lanes out after the ack' },
  { agent: 'terra-01', ask: 're-review the evidence tree and post a verdict' },
  { agent: 'shadow-mgr', ask: 'watch heartbeat freshness and flag anything stale' },
  { agent: 'gem-lane-1', ask: 'write the status to durable storage' },
  { agent: 'jarvis', ask: 'drain the question queue and summarise what is open' },
  { agent: 'gem-lane-2', ask: 'checkpoint at phase 3 and resume after the re-read' },
  { agent: 'codex', ask: 'flush the buffered audit records' },
  { agent: 'gem-lane-3', ask: 'claim a task lease and start the sweep' },
  { agent: 'claude', ask: 'run the checks from the workspace root' },
  { agent: 'luna-02', ask: 're-pin the territory map so every lane is file-disjoint' },
])

/* Minutes back from now for each run, newest first. Uneven on purpose: evenly
 * spaced rows look generated, and the gaps are what make the "last agent run"
 * clock above them mean anything. */
const AGO_MINUTES = Object.freeze([
  14, 52, 96, 143, 210, 288, 361, 470, 612, 745,
  909, 1104, 1330, 1587, 1875, 2194, 2544, 2925, 3337,
])

/* Which rows did not simply work. Indices into AGO_MINUTES, so the mix stays
 * fixed: refusals carry a real code, and two rows have NO outcome record at all
 * because that is a state a real ledger produces and the screen must keep
 * telling apart from success. */
const REFUSED_AT = Object.freeze({ 3: 0, 9: 1, 16: 2 })
const NO_OUTCOME_AT = Object.freeze(new Set([6, 12]))

const iso = (ms) => new Date(ms).toISOString()

/**
 * A raw ledger reply describing the example fleet's activity, in exactly the
 * shape `readLocalSessions` parses. Pass it through that function; do not read
 * these fields directly.
 */
export function sampleSessionsRaw(nowMs = Date.now()) {
  const entries = []
  /* Sequences descend with age so the newest run holds the highest number, the
     way a real append-only ledger reads. Outcomes take their own sequence, as
     separate records that name the start they resolve. */
  let sequence = AGO_MINUTES.length * 2 + 1

  AGO_MINUTES.forEach((minutes, index) => {
    const atMs = nowMs - minutes * 60_000
    const pick = SAMPLE_ASKS[index % SAMPLE_ASKS.length]
    const startSequence = sequence
    sequence -= 1

    entries.push({
      at: iso(atMs),
      sequence: startSequence,
      action: 'agent_session_start',
      sessionId: `sample/${pick.agent}/${String(index + 1).padStart(2, '0')}`,
      /* Carried so a screen that names WHAT was asked has something true to
         name. Ignored by readLocalSessions, which is fine: this record is read
         by more than one surface and each takes the fields it understands. */
      asked: pick.ask,
      agent: pick.agent,
    })

    if (NO_OUTCOME_AT.has(index)) return

    const refusalIndex = REFUSED_AT[index]
    const refused = refusalIndex !== undefined
    entries.push({
      at: iso(atMs + 1200),
      sequence,
      /* THE ACTION IS NOT OPTIONAL HERE. readLocalSessions treats an entry with
         NO action as a run -- deliberately, so old records and hand-built
         fixtures are not silently dropped -- so an outcome written without one
         is counted as a second run. Measured before this line existed: 19 starts
         plus 17 outcomes reported as "36 agent runs". The recorder writes
         agent_session_outcome (shell/main.cjs), so this does too. */
      action: 'agent_session_outcome',
      outcome: {
        result: refused ? 'refused' : 'started',
        resolves: startSequence,
        reason: refused ? REFUSAL_CODES[refusalIndex] : undefined,
      },
    })
    sequence -= 1
  })

  const refusedCount = Object.keys(REFUSED_AT).length
  const startedCount = AGO_MINUTES.length - refusedCount - NO_OUTCOME_AT.size

  return {
    ok: true,
    entries,
    /* Whole-chain counts. `starts` is every run; started + refused is smaller
       than it, deliberately, because two rows have no outcome recorded and the
       screen must not read that difference as either success or failure. */
    outcomes: { starts: AGO_MINUTES.length, started: startedCount, refused: refusedCount },
    total: AGO_MINUTES.length,
    /* The demonstration shows a record that checks out, because that is the
       ordinary case and the screen for a BROKEN chain is a different screen
       that deserves its own demonstration rather than being the default one. */
    verified: true,
  }
}

/** What the example was asked, keyed by sessionId, for surfaces that name it. */
export function sampleAskFor(sessionId) {
  if (typeof sessionId !== 'string') return null
  const match = /^sample\/([^/]+)\/(\d+)$/.exec(sessionId)
  if (!match) return null
  const index = Number(match[2]) - 1
  if (!Number.isInteger(index) || index < 0) return null
  return SAMPLE_ASKS[index % SAMPLE_ASKS.length]?.ask ?? null
}
