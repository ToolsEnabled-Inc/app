'use strict';

// FIXTURE: a verbatim copy of the ENGINE's src/lib/r-ledger.js (free-cut
// engine), with only ./runtime stubbed beside it so the ledgers land under a
// scratch root the tests own. Copied rather than faked because the host's cap
// and announcement behaviour must be proved against the real module's answers
// -- a fixture that parroted what the host hoped for would prove nothing. The
// real module's own behaviour is proved by the engine suite tests/r-ledger*.
// If the engine module changes, refresh this copy.

// The owner's R ledgers: four plain markdown files the owner can open, edit,
// and delete lines from by hand. Owner design, 2026-08-15, verbatim: "/Request
// [request] saves to global R ledger ... it lies in the users hands instead of
// some insane machinery ... the user in the R ledgers where they can be viewed
// should easily be able to remove or edit their requests." And: "i think theres
// 4 ... /Request, RequestThread,Tree,Session" ; "tree is every agent connected
// below that agent period."
//
// So this module does three deliberately small things: append an entry with
// the next id, read a ledger back leniently (a hand-edited file loads with
// warnings, never a refusal), and never reissue an id -- even after the owner
// deletes the entry that held it. It never rewrites the owner's words: writes
// are appends, reads are reads.
//
// Scopes and where they live:
//   global   reports/R-LEDGER.md                     ids R2000, R2001, ...
//   session  state/r-ledger/session-<sessionId>.md   ids RS1, RS2, ...
//   tree     state/r-ledger/tree-<anchorId>.md       ids RT1, RT2, ...
//   thread   state/r-ledger/thread-<threadId>.md     ids RTH1, RTH2, ...
// The global floor R2000 clears every archived pre-reset number, so a new
// global id never collides in meaning with anything cited from the old ledger.
// The tree file keys on the ANCHOR agent (where the owner typed the command):
// its rules apply to that agent and every descendant, never upward.

const fs = require('node:fs');
const path = require('node:path');
const { rootPath } = require('./runtime');

const SCOPES = Object.freeze(['global', 'session', 'tree', 'thread']);
const GLOBAL_FLOOR = 2000;
const ID_PREFIX = Object.freeze({ global: 'R', session: 'RS', tree: 'RT', thread: 'RTH' });
const SCOPE_WORD = Object.freeze({
  global: 'every agent',
  session: 'this session and everything it spawns',
  tree: 'this agent and every agent below it',
  thread: 'this agent, this conversation only'
});
const MAX_WORDS_BYTES = 16 * 1024;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENTRY_HEAD = /^## (R(?:S|T|TH)?)(\d{1,6})(?:\s+[—-]\s+(.*))?\s*$/;
const NEXT_MARK = /^<!--\s*next-id:\s*(\d{1,6})\s*-->\s*$/;

class RLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RLedgerError';
    this.code = code;
  }
}

function assertScope(scope) {
  if (!SCOPES.includes(scope)) throw new RLedgerError('R_LEDGER_SCOPE_INVALID', `scope must be one of ${SCOPES.join(', ')}.`);
}

function assertKey(scope, key) {
  if (scope === 'global') return null;
  if (typeof key !== 'string' || !SAFE_KEY.test(key)) {
    throw new RLedgerError('R_LEDGER_KEY_INVALID', `a ${scope} ledger needs its ${scope} id (letters, digits, . _ -).`);
  }
  return key;
}

function ledgerPath(scope, key, options = {}) {
  assertScope(scope);
  const root = typeof options.rootPath === 'function' ? options.rootPath : rootPath;
  if (scope === 'global') return root('reports', 'R-LEDGER.md');
  return root('state', 'r-ledger', `${scope}-${assertKey(scope, key)}.md`);
}

function header(scope, key) {
  const title = scope === 'global' ? 'Owner requests — global' : `Owner requests — ${scope} ${key}`;
  return [
    `# ${title}`,
    '',
    `Applies to: ${SCOPE_WORD[scope]}. Written by /Request${scope === 'global' ? '' : scope[0].toUpperCase() + scope.slice(1)};`,
    'edit or delete any entry by hand — the words here are the owner\'s and no tool',
    'rewrites them. Ids are never reused: a deleted number stays retired.',
    ''
  ].join('\n');
}

/* Lenient parse. Every "## <id> — <date>" line opens an entry; the body is
   everything until the next entry head. Anything malformed becomes a warning
   and is skipped, never a failure -- the owner edits this file by hand. */
function parseLedger(text, scope) {
  const entries = [];
  const warnings = [];
  let nextIdMark = null;
  let current = null;
  const lines = String(text || '').split(/\r?\n/);
  const wanted = ID_PREFIX[scope];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const mark = NEXT_MARK.exec(line);
    if (mark) { nextIdMark = Number(mark[1]); continue; }
    const head = ENTRY_HEAD.exec(line);
    if (head) {
      if (current) entries.push(finish(current));
      if (head[1] !== wanted) {
        warnings.push(`line ${index + 1}: id ${head[1]}${head[2]} does not belong in a ${scope} ledger; kept as text, not counted.`);
        current = null;
        continue;
      }
      current = { id: `${head[1]}${head[2]}`, number: Number(head[2]), stamp: head[3] ? head[3].trim() : null, lines: [], line: index + 1 };
      continue;
    }
    if (line.startsWith('## ')) {
      warnings.push(`line ${index + 1}: heading is not an entry id; ignored.`);
      if (current) { entries.push(finish(current)); current = null; }
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) entries.push(finish(current));
  return { entries, warnings, nextIdMark };
}

function finish(entry) {
  const body = entry.lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return Object.freeze({ id: entry.id, number: entry.number, stamp: entry.stamp, words: body, line: entry.line });
}

function readLedger(scope, key, options = {}) {
  const file = ledgerPath(scope, key, options);
  let text = null;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_LEDGER_BYTES) throw new RLedgerError('R_LEDGER_TOO_LARGE', `${file} exceeds ${MAX_LEDGER_BYTES} bytes.`);
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return Object.freeze({ scope, key: key || null, path: file, exists: false, entries: [], warnings: [], nextIdMark: null });
    throw error;
  }
  const parsed = parseLedger(text, scope);
  return Object.freeze({ scope, key: key || null, path: file, exists: true, ...parsed });
}

/* The next id is the max of: the highest number ever seen in the file, the
   next-id mark (which survives the owner deleting the highest entry), and the
   scope floor. So a deleted entry's number is never handed out again. */
function nextNumber(ledger) {
  const floor = ledger.scope === 'global' ? GLOBAL_FLOOR : 1;
  const highest = ledger.entries.reduce((max, entry) => Math.max(max, entry.number), 0);
  const marked = Number.isInteger(ledger.nextIdMark) ? ledger.nextIdMark : 0;
  return Math.max(floor, highest + 1, marked);
}

function normalizeWords(words) {
  if (typeof words !== 'string') throw new RLedgerError('R_LEDGER_WORDS_INVALID', 'the request must be text.');
  const trimmed = words.replace(/\r\n/g, '\n').trim();
  if (!trimmed) throw new RLedgerError('R_LEDGER_WORDS_EMPTY', 'the request is empty; nothing to file.');
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_WORDS_BYTES) throw new RLedgerError('R_LEDGER_WORDS_TOO_LONG', `the request exceeds ${MAX_WORDS_BYTES} bytes.`);
  if (/^## /m.test(trimmed)) throw new RLedgerError('R_LEDGER_WORDS_HEADING', 'a line starting with "## " would read as a new entry; reword it.');
  return trimmed;
}

/* Append one entry. The owner's words go in byte-for-byte after trimming the
   ends; the id and a date stamp go on the head line; the next-id mark is
   rewritten at the very end of the file so it is always the last line. */
function fileRequest({ scope, key, words, now = () => new Date() }, options = {}) {
  assertScope(scope);
  const text = normalizeWords(words);
  const file = ledgerPath(scope, key, options);
  const ledger = readLedger(scope, key, options);
  const number = nextNumber(ledger);
  const id = `${ID_PREFIX[scope]}${number}`;
  const stamp = now().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = ledger.exists ? fs.readFileSync(file, 'utf8') : header(scope, key);
  existing = existing.replace(/\n?<!--\s*next-id:\s*\d{1,6}\s*-->\s*$/, '');
  if (!existing.endsWith('\n')) existing += '\n';
  const block = `\n## ${id} — ${stamp}\n\n${text}\n\n<!-- next-id: ${number + 1} -->\n`;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, existing + block, 'utf8');
  fs.renameSync(temporary, file);
  return Object.freeze({ id, scope, key: key || null, path: file, stamp, words: text });
}

function findEntry(id, options = {}) {
  const match = /^(R|RS|RT|RTH)(\d{1,6})$/.exec(String(id || ''));
  if (!match) throw new RLedgerError('R_LEDGER_ID_INVALID', 'ids look like R2001, RS3, RT2, or RTH5.');
  const scope = Object.keys(ID_PREFIX).find(name => ID_PREFIX[name] === match[1]);
  return { scope, id: `${match[1]}${match[2]}` };
}

/* The stack an agent boots with, in reading order: global, then the session,
   then every ancestor tree ledger from the top of the chain down (the anchors
   are session ids of the agents above), then the agent's own thread. Absent
   files are stated as absent, not skipped, so an agent knows what it read. */
function collectStack({ sessionId = null, treeAnchors = [], threadId = null } = {}, options = {}) {
  const layers = [];
  layers.push(readLedger('global', null, options));
  if (sessionId) layers.push(readLedger('session', sessionId, options));
  for (const anchor of Array.isArray(treeAnchors) ? treeAnchors : []) {
    if (anchor) layers.push(readLedger('tree', anchor, options));
  }
  if (threadId) layers.push(readLedger('thread', threadId, options));
  return Object.freeze(layers.map(layer => Object.freeze({
    scope: layer.scope,
    key: layer.key,
    path: layer.path,
    exists: layer.exists,
    appliesTo: SCOPE_WORD[layer.scope],
    entries: layer.entries,
    warnings: layer.warnings
  })));
}

module.exports = Object.freeze({
  SCOPES,
  GLOBAL_FLOOR,
  ID_PREFIX,
  SCOPE_WORD,
  RLedgerError,
  ledgerPath,
  parseLedger,
  readLedger,
  nextNumber,
  fileRequest,
  findEntry,
  collectStack
});
