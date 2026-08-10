#!/usr/bin/env node
/* Serve a single, already-declared candidate over the direct A<->B link so
 * Machine B can pull it, with an auth token that never touches disk.
 *
 * WHY THIS SHAPE, not the alternatives:
 *
 *   - The 8787 tunnel and 8788 bridge (already up, already authenticated --
 *     see `node tools/bridge-status.js` in the ToolsEnabled product tree)
 *     cannot carry this: the tunnel is JSON-only, capped at 128 KB per
 *     request / 64 KB per message (sidecars/link-bus/server.js,
 *     sidecars/link-bus/store.js), and the bridge's remote file-write tools
 *     are string-only, overwrite-only, and capped at 2 MB with no append
 *     primitive reachable from this bounded profile. A 100 MB installer does
 *     not fit either channel. Modifying that shared infrastructure to add a
 *     file route was out of scope for a release-packager task touching
 *     everyone's messaging/bridge layer.
 *   - A prior attempt at exactly this (agent-coord claim
 *     installer-sideload-20260809-a1) paused before writing a scratch JSON
 *     containing a download token, because persisting a plaintext secret to
 *     disk conflicts with this codebase's vault convention (tools/secrets.ps1,
 *     DPAPI-backed; STANDING-ORDERS.md's "never ask him to paste a secret" /
 *     no-secret-on-relay-adjacent-surface norms). This script resolves that
 *     conflict by never writing the token anywhere: it is generated in
 *     process memory, printed once to the operator's terminal, and never
 *     touches vault, disk, or the agent-coord relay. Losing the process
 *     means minting a new token and re-running this script -- an acceptable
 *     cost for a token whose only job is to gate one file, once.
 *   - Binds ONLY to the literal direct-link address (192.168.214.2), matching
 *     the existing security posture of the tunnel and bridge, which do the
 *     same for the same reason: this interface exists for the A<->B link and
 *     nothing else.
 *   - Serves EXACTLY the one path given at startup -- there is no directory
 *     listing, no path parameter accepted from the client, so there is no
 *     traversal surface to reason about.
 *
 * B's matching half is verify-candidate.ps1 -- plain PowerShell, no Node, no
 * git, because B tests as a stranger would and must not need this repo's
 * toolchain installed to receive and verify a file.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const DIRECT_LINK_ADDRESSES = new Set(['192.168.214.2', '192.168.214.1'])

function parseArgs(argv) {
  const args = { port: 4787, bind: '192.168.214.2', once: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') args.port = Number(argv[++i])
    else if (arg === '--bind') args.bind = argv[++i]
    else if (arg === '--once') args.once = true
    else if (arg === '--force-bind-any') args.forceBindAny = true
    else if (!args.filePath) args.filePath = arg
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return args
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.filePath) {
    console.error('usage: node tools/release-packager/serve-candidate.mjs <path-to-exe> [--port 4787] [--bind 192.168.214.2] [--once]')
    process.exitCode = 2
    return
  }
  const filePath = path.resolve(args.filePath)
  if (!existsSync(filePath)) throw new Error(`file does not exist: ${filePath}`)
  const stats = statSync(filePath)
  const filename = path.basename(filePath)

  if (!DIRECT_LINK_ADDRESSES.has(args.bind) && !args.forceBindAny) {
    throw new Error(
      `refusing to bind to ${args.bind}: not one of the known direct-link addresses (${[...DIRECT_LINK_ADDRESSES].join(', ')}). ` +
        'Pass --force-bind-any to override, but that widens this beyond the A<->B cable on purpose -- think first.',
    )
  }

  const token = randomBytes(32).toString('hex')
  let servedOnce = false

  const server = http.createServer((req, res) => {
    const remote = req.socket.remoteAddress
    const timestamp = new Date().toISOString()

    if (req.method !== 'GET' || req.url !== '/candidate') {
      console.log(`[serve-candidate] ${timestamp} ${remote} ${req.method} ${req.url} -> 404`)
      res.writeHead(404).end('not found')
      return
    }

    const auth = req.headers.authorization ?? ''
    const expected = `Bearer ${token}`
    if (!timingSafeStringEqual(auth, expected)) {
      console.log(`[serve-candidate] ${timestamp} ${remote} GET /candidate -> 401 (bad or missing token)`)
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('unauthorized')
      return
    }

    console.log(`[serve-candidate] ${timestamp} ${remote} GET /candidate -> 200 (${stats.size} bytes)`)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stats.size,
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
    const stream = createReadStream(filePath)
    stream.pipe(res)
    stream.on('error', (error) => {
      console.error(`[serve-candidate] read error: ${error.message}`)
      res.destroy()
    })
    res.on('finish', () => {
      servedOnce = true
      if (args.once) {
        console.log('[serve-candidate] --once: served successfully, shutting down.')
        server.close()
      }
    })
  })

  server.listen(args.port, args.bind, () => {
    console.log('='.repeat(72))
    console.log(`[serve-candidate] serving ${filePath}`)
    console.log(`[serve-candidate] listening on http://${args.bind}:${args.port}/candidate (direct-link interface only)`)
    console.log(`[serve-candidate] token (share this with Machine B out-of-band, e.g. read aloud / Telegram -- never write it to a file):`)
    console.log(`  ${token}`)
    console.log('')
    console.log('[serve-candidate] give Machine B this exact command (fill in the two blanks it does not already know):')
    console.log(
      `  powershell -File tools\\release-packager\\verify-candidate.ps1 -Uri "http://${args.bind}:${args.port}/candidate" ` +
        `-Token "${token}" -OutFile "${filename}" -ExpectedBytes <from declaration> -ExpectedSha256 "<from declaration>"`,
    )
    console.log('='.repeat(72))
  })

  process.on('SIGINT', () => {
    console.log(`\n[serve-candidate] shutting down (served: ${servedOnce}).`)
    server.close(() => process.exit(0))
  })
}

main().catch((error) => {
  console.error(`[serve-candidate] ${error.message}`)
  process.exitCode = 1
})
