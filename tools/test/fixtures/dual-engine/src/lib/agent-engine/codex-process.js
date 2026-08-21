'use strict'

/* A fixture root that carries BOTH engines, for the no-tier routing suite.
 *
 * WHY THIS ROOT EXISTS AT ALL. The confined-engine fixture is COMPLETE_ENGINE
 * for tools/test/agent-session-surface.test.mjs, whose fifth-precondition case
 * asserts that a codex-only payload with no sign-in is NOT ready. A claude
 * module placed in THAT root opens engineAvailability's claudeCouldStart
 * bypass on any machine where the claude program resolves -- which flipped
 * that case on the build machine the day the routing suite landed. So the
 * two-engine world lives here, and the codex-only world stays codex-only.
 *
 * A RE-EXPORT, NOT A COPY: the same module instance answers both roots, so a
 * test reading the recorded calls array sees every start whichever root the
 * host loaded. */
module.exports = require('../../../../confined-engine/src/lib/agent-engine/codex-process.js')
