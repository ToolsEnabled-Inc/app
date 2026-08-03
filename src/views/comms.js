// Comms — the agents' Discord channel, rendered clean. (Lane-owned; stub.)

import { el } from '../components.js'

export function commsView() {
  const root = el(`
    <div class="view-pad">
      <div style="max-width:900px;margin:60px auto;color:var(--ink-3);font-size:15px">
        Comms channel loading…
      </div>
    </div>
  `)
  return { el: root, destroy() {} }
}
