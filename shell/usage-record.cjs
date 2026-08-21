'use strict'

/* WHAT EACH TURN COST, written down on the computer that spent it.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. Both engines report token usage on every
 * turn -- codex on `thread/tokenUsage/updated`, the Claude CLI on its `result`
 * packet -- and both re-emit it as a `usage` event that has crossed
 * mc-agent:event since the first day. Nothing ever wrote one down. So the
 * metrics page could say only that this product never sees a token count, which
 * was true of the RECORD and false of the PRODUCT: the count arrives, per turn,
 * already in the main process, and was dropped on the floor. The owner asked why
 * the metrics do not work; this is the half of the answer that is a missing
 * writer rather than a missing panel.
 *
 * WHAT IT IS. The same record as shell/spawn-record.cjs -- ed25519-signed,
 * hash-chained, fsync-appended, keyed to the OS keystore -- kept in its own
 * file. It is that module, not a copy of it: createSpawnRecorder() takes the
 * ledger's file name, and everything below is the shape of one usage record and
 * the reading of one usage event. There is exactly one chain implementation on
 * this machine, and this is not a second one.
 *
 * WHY ITS OWN FILE. history() reads at most 200 lines. A single busy session
 * writes a usage record per turn, so sharing the run ledger would push the runs
 * out of the only window the home screen can see -- a person with one long
 * conversation would open the product and be told nothing had ever run here.
 * See the note on `ledgerFile` in shell/spawn-record.cjs.
 *
 * WHAT IT NEVER DOES. It never computes a figure the engine did not report.
 * Absent is recorded as absent, never as zero: a zero is a claim, and a claim
 * signed with this chain's authority is worse than a blank. Every arithmetic
 * this feature does happens later, on a screen, over figures whose provenance is
 * still readable -- see src/local-metrics.js.
 */

const { createSpawnRecorder, SpawnRecordError } = require('./spawn-record.cjs')

const USAGE_LEDGER_FILE = 'agent-turn-usage-records.jsonl'
const USAGE_ACTION = 'agent_turn_usage'

/* THE FIELD NAMES EACH ENGINE REALLY USES, MEASURED RATHER THAN ASSUMED.
 *
 *   codex 0.146 app-server (captured live 2026-08-14, recorded in
 *   src/agent-session-events.js): camelCase, and the record is a PAIR --
 *     { total: {totalTokens, inputTokens, cachedInputTokens, outputTokens,
 *               reasoningOutputTokens}, last: {…same…}, modelContextWindow }
 *   where `total` is the session's running total and `last` is the turn that
 *   just ended.
 *
 *   Claude CLI (`result` packet usage, re-emitted by claude-cli-adapter.js
 *   handleResult): Anthropic's own snake_case shape, flat, and already scoped to
 *   the turn -- { input_tokens, output_tokens, cache_creation_input_tokens,
 *   cache_read_input_tokens }.
 *
 * Aliasing two spellings of one figure onto one name is not inventing a number;
 * it is reading two dialects of the same sentence. Which figure a name means is
 * fixed here so that no screen has to guess, and a spelling nobody has measured
 * is simply absent rather than mapped by resemblance.
 */
const FIELD_ALIASES = Object.freeze({
  inputTokens: Object.freeze(['inputTokens', 'input_tokens']),
  /* Tokens served from the provider's cache. Codex calls it cachedInputTokens;
     Anthropic calls the same thing cache_read_input_tokens. */
  cachedInputTokens: Object.freeze(['cachedInputTokens', 'cached_input_tokens', 'cache_read_input_tokens']),
  /* Writing to the cache, which BOTH engines report under their own name --
     `cacheWriteInputTokens` from codex, `cache_creation_input_tokens` from
     Anthropic. Deliberately NOT folded into the line above: writing to the cache
     is billed differently from reading it, and a page that added them together
     would be reporting a number neither engine reports.
     THE CODEX SPELLING WAS ADDED FROM A LIVE TURN, not from the capture this
     table was first written against: the capture in src/agent-session-events.js
     abbreviates the record and does not show it, so a real luna turn on
     2026-08-18 reported `cacheWriteInputTokens: 0` into a field this reader had
     no name for. It was reading zero as absent, which is the right way round for
     a missing field and the wrong answer for a reported one. */
  cacheCreationInputTokens: Object.freeze(['cacheCreationInputTokens', 'cacheWriteInputTokens', 'cache_creation_input_tokens']),
  outputTokens: Object.freeze(['outputTokens', 'output_tokens']),
  reasoningOutputTokens: Object.freeze(['reasoningOutputTokens', 'reasoning_output_tokens']),
  totalTokens: Object.freeze(['totalTokens', 'total_tokens']),
})

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const wholeNumber = value => (Number.isSafeInteger(value) && value >= 0 ? value : null)

function readFigures(source) {
  const figures = {}
  let found = 0
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let value = null
    for (const alias of aliases) {
      const candidate = wholeNumber(source[alias])
      if (candidate !== null) { value = candidate; break }
    }
    figures[field] = value
    if (value !== null) found += 1
  }
  return { figures, found }
}

/**
 * What one `usage` event actually says about one turn, or null when it says
 * nothing this record can hold.
 *
 * THE `basis` IS THE POINT OF THIS FUNCTION. A codex record carries the
 * session's running total AND the turn that just ended; a Claude record carries
 * the turn alone. A reader that summed the wrong one would multiply a session's
 * spend by its number of turns and print a confident, enormous, wrong number.
 * So the turn's own figures are preferred, the cumulative reading is kept
 * BESIDE them rather than instead of them, and a record that offers only a
 * running total says `session-total` out loud so nothing downstream sums it.
 *
 * Pure, dependency-free and exported so a test can walk every shape without an
 * Electron process or a ledger -- the same contract src/agent-session-events.js
 * keeps for the readers on the other side of the channel.
 */
function turnUsageFrom(record) {
  if (!isPlainObject(record)) return null

  const turnFigures = isPlainObject(record.last) ? readFigures(record.last) : null
  const totalFigures = isPlainObject(record.total) ? readFigures(record.total) : null
  const flatFigures = readFigures(record)

  let basis
  let chosen
  if (turnFigures && turnFigures.found > 0) {
    basis = 'turn'
    chosen = turnFigures.figures
  } else if (flatFigures.found > 0) {
    /* A FLAT RECORD IS THE TURN'S. Measured: the Claude CLI emits usage once,
       from the packet that ends the turn, and those figures are that turn's. */
    basis = 'turn'
    chosen = flatFigures.figures
  } else if (totalFigures && totalFigures.found > 0) {
    /* Only a running total was offered. It is recorded, and it is labelled, so
       that a reader takes the largest reading for the session rather than
       adding one per turn. */
    basis = 'session-total'
    chosen = totalFigures.figures
  } else {
    return null
  }

  const sessionTotal = totalFigures ? totalFigures.figures.totalTokens : null
  return Object.freeze({
    basis,
    ...chosen,
    /* The engine's own statement of how much room the model has. Not a token
       count and never summed with one. */
    contextWindow: wholeNumber(record.modelContextWindow) ?? wholeNumber(record.contextWindow),
    /* Kept so a screen can CHECK the turns it summed against what the engine
       says the session spent, and say so when they disagree, instead of
       asserting its own arithmetic. Null when the reading IS the total. */
    sessionTotalTokens: basis === 'turn' ? sessionTotal : null,
  })
}

/**
 * The writer.
 *
 * `recordTurn` refuses rather than degrades: a turn with no reading is not a
 * turn that cost nothing, and the only honest response to being handed one is
 * to write nothing at all. Every refusal is a SpawnRecordError with a code, and
 * the caller in shell/main.cjs swallows it -- a usage record that cannot be
 * written must never be able to stop an agent from answering.
 */
function createUsageRecorder({ safeStorage, directory, now } = {}) {
  const recorder = createSpawnRecorder({ safeStorage, directory, ledgerFile: USAGE_LEDGER_FILE, now })

  function recordTurn({ sessionId, principal = null, turnId = null, tier = null, account = null, status = null, usage } = {}) {
    /* REFUSED HERE RATHER THAN LEFT TO THE WRITER, because the writer treats an
       absent usage field as "this record simply has none" -- which is right for
       the run ledger and wrong for this one. A usage record without a reading is
       a line claiming a turn happened and cost nothing. */
    if (usage === undefined || usage === null) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_USAGE', 'A turn usage record needs a usage reading; there is nothing to record without one')
    }
    return recorder.record({
      action: USAGE_ACTION,
      sessionId,
      principal,
      /* Deliberately empty. `details` is dropped by history() because it can
         carry a path, and this record has nothing that belongs in it -- every
         figure it holds is in the bounded `usage` field, by design. */
      details: {},
      usage: { ...usage, turnId, tier, account, status },
    })
  }

  /* The turns themselves, newest first, with the chain's verdict beside them.
     history()'s three rules hold unchanged here because this IS history(): no
     path, no signature, and it never throws. */
  function usage({ limit = 200 } = {}) {
    const read = recorder.history({ limit })
    if (read.ok !== true) return read
    return Object.freeze({
      ok: true,
      total: read.total,
      verified: read.verified,
      entries: Object.freeze(read.entries.filter(entry => entry.action === USAGE_ACTION && entry.usage !== null)),
    })
  }

  return Object.freeze({
    availability: recorder.availability,
    verify: recorder.verify,
    ledgerPath: recorder.ledgerPath,
    recordTurn,
    usage,
  })
}

module.exports = { createUsageRecorder, turnUsageFrom, USAGE_LEDGER_FILE, USAGE_ACTION }
