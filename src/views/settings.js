// /settings — progressively disclosed preferences plus the first-run system
// register. Appearance can fail soft; fleet configuration is correctness data
// and uses the durable profile store instead of the cosmetic setting idiom.

import { el, attachSeg } from '../components.js'
import { rangeFill } from './computers.js'
import { LIVE_VIEW_FLAGS, isLiveView, setLiveView } from '../live-flags.js'
import { WRITE_ACTION_FLAGS, isWriteEnabled, setWriteEnabled } from '../write-flags.js'
import { createLedgerArchiveController } from '../mission-bridge.js'
import {
  FLEET_PROFILE_SETTING_COUNT,
  createFleetProfileSettings,
} from '../fleet-profile-settings.js'
/* The first-run walkthrough's settings. They are a SECTION here rather than a
   screen of their own because the owner's requirement has two halves: the
   walkthrough may infer, and every inferred setting must stay visible and
   editable afterwards. A profile only the walkthrough could edit would satisfy
   the first half and fail the second. */
import {
  SETUP_PROFILE_SETTING_COUNT,
  createSetupProfileSettings,
} from '../setup-profile-settings.js'
import '../settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'

const SECTIONS = [
  'System',
  'Setup',
  'Appearance',
  'Text & Reading',
  'Motion & Effects',
  'Fleet Graph',
  'Metrics',
  'Chat & Threads',
  'Comms Board',
  'Ledger',
  'Performance',
  'Data & Sim',
  'Write',
  'Developer',
]

export const SETTINGS = [
  { id: 'theme', section: 'Appearance', name: 'Theme', desc: 'Set the page surface and ink palette.', depth: 1, type: 'seg', options: [['white', 'White'], ['tan', 'Tan'], ['black', 'Black']], def: 'white' },
  { id: 'display_density', section: 'Appearance', name: 'Display density', desc: 'Choose the default spacing rhythm for information-heavy views.', depth: 1, type: 'seg', options: ['comfortable', 'compact'], def: 'comfortable' },
  { id: 'contrast_curve', section: 'Appearance', name: 'Contrast curve', desc: 'Strengthen secondary ink without changing the theme.', depth: 1, type: 'seg', options: ['standard', 'strong'], def: 'standard' },
  { id: 'role_hue_emphasis', section: 'Appearance', name: 'Emphasize role hues', desc: 'Give role marks slightly more visual priority.', depth: 1, type: 'toggle', def: false },
  { id: 'chrome_edge_weight', section: 'Appearance', name: 'Chrome edge weight', desc: 'Tune the presence of control and surface hairlines.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 42 },
  { id: 'drawer_width', section: 'Appearance', name: 'Settings drawer width', desc: 'Set the preferred width of the quick settings drawer.', depth: 2, type: 'stepper', min: 280, max: 440, step: 8, unit: 'px', def: 320 },
  { id: 'surface_frost', section: 'Appearance', name: 'Surface frost retention', desc: 'Balance glass diffusion against bare-page clarity.', depth: 3, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 58 },
  { id: 'brace_stroke_width', section: 'Appearance', name: 'Brace stroke width', desc: 'Set the signature brace rail stroke at subpixel precision.', depth: 4, type: 'stepper', min: 0.75, max: 2, step: 0.25, unit: 'px', def: 1.25 },

  { id: 'text_size', section: 'Text & Reading', name: 'Text size', desc: 'Scale the complete interface while preserving its layout.', depth: 1, type: 'seg', options: [['0.9', 'Small'], ['1', 'Default'], ['1.12', 'Large']], def: '1' },
  { id: 'numeric_font', section: 'Text & Reading', name: 'Mono numeric values', desc: 'Use the data face for changing values and machine identifiers.', depth: 1, type: 'toggle', def: true },
  { id: 'reading_line_height', section: 'Text & Reading', name: 'Reading line height', desc: 'Adjust the vertical rhythm of descriptions and messages.', depth: 1, type: 'seg', options: ['tight', 'standard', 'open'], def: 'standard' },
  { id: 'timestamp_verbosity', section: 'Text & Reading', name: 'Timestamp verbosity', desc: 'Choose how much date context accompanies live time.', depth: 2, type: 'select', options: ['relative', 'clock', 'full'], def: 'relative' },
  { id: 'reading_measure', section: 'Text & Reading', name: 'Reading measure', desc: 'Limit long-form line length for sustained scanning.', depth: 2, type: 'stepper', min: 56, max: 92, step: 2, unit: 'ch', def: 72 },
  { id: 'caps_tracking', section: 'Text & Reading', name: 'Micro-cap tracking', desc: 'Adjust spacing in uppercase navigational labels.', depth: 3, type: 'range', min: 6, max: 18, step: 1, unit: '%', def: 12 },
  { id: 'baseline_nudge', section: 'Text & Reading', name: 'Tabular baseline nudge', desc: 'Offset aligned numeric runs against adjacent interface text.', depth: 4, type: 'stepper', min: -2, max: 2, step: 0.25, unit: 'px', def: 0 },

  { id: 'reduce_motion', section: 'Motion & Effects', name: 'Reduce motion', desc: 'Snap structural movement and suppress ambient animation.', depth: 1, type: 'toggle', def: false },
  { id: 'glow', section: 'Motion & Effects', name: 'Glow intensity', desc: 'Set the shared intensity of illuminated status marks.', depth: 1, type: 'range', min: 0, max: 200, step: 1, unit: '%', def: 100 },
  { id: 'view_transitions', section: 'Motion & Effects', name: 'View transitions', desc: 'Crossfade between routes when motion is available.', depth: 1, type: 'toggle', def: true },
  { id: 'entry_response', section: 'Motion & Effects', name: 'Entry response', desc: 'Settle newly revealed structures over a shorter or longer interval.', depth: 2, type: 'range', min: 120, max: 600, step: 20, unit: 'ms', def: 420 },
  { id: 'hover_response', section: 'Motion & Effects', name: 'Hover response', desc: 'Choose the response curve for quiet interactive ink shifts.', depth: 2, type: 'select', options: ['immediate', 'clinical', 'soft'], def: 'clinical' },
  { id: 'checkpoint_halo_decay', section: 'Motion & Effects', name: 'Checkpoint halo decay', desc: 'Control how long a checkpoint pulse remains perceptible.', depth: 3, type: 'range', min: 120, max: 1600, step: 40, unit: 'ms', def: 800 },
  { id: 'view_morph_snapshot_bias', section: 'Motion & Effects', name: 'View-morph snapshot bias', desc: 'Weight route morph timing toward the outgoing or incoming frame.', depth: 4, type: 'range', min: -100, max: 100, step: 5, unit: '%', def: 0 },

  { id: 'graph_layout', section: 'Fleet Graph', name: 'Graph layout', desc: 'Select the default spatial register for the fleet hierarchy.', depth: 1, type: 'seg', options: ['balanced', 'compact', 'wide'], def: 'balanced' },
  { id: 'agent_labels', section: 'Fleet Graph', name: 'Agent labels', desc: 'Keep agent identity labels visible at the resting zoom.', depth: 1, type: 'toggle', def: true },
  { id: 'group_by_machine', section: 'Fleet Graph', name: 'Group by machine', desc: 'Preserve machine ownership as the graph primary grouping.', depth: 1, type: 'toggle', def: true },
  { id: 'link_detail', section: 'Fleet Graph', name: 'Link detail', desc: 'Choose the resting amount of relationship annotation.', depth: 1, type: 'seg', options: ['quiet', 'full'], def: 'quiet' },
  { id: 'edge_tension', section: 'Fleet Graph', name: 'Edge tension', desc: 'Adjust the curvature applied to graph relationships.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 54 },
  { id: 'collision_padding', section: 'Fleet Graph', name: 'Collision padding', desc: 'Reserve additional separation between adjacent agent nodes.', depth: 2, type: 'stepper', min: 0, max: 48, step: 2, unit: 'px', def: 16 },
  { id: 'tier_vertical_gain', section: 'Fleet Graph', name: 'Tier vertical gain', desc: 'Scale the distance between successive hierarchy levels.', depth: 3, type: 'range', min: 70, max: 150, step: 2, unit: '%', def: 100 },
  { id: 'leader_line_elbow_radius', section: 'Fleet Graph', name: 'Leader-line elbow radius', desc: 'Set the turn radius where context leaders change axis.', depth: 4, type: 'stepper', min: 0, max: 24, step: 1, unit: 'px', def: 6 },

  { id: 'metrics_window', section: 'Metrics', name: 'Default time window', desc: 'Set the first interval shown by aggregate metric views.', depth: 1, type: 'seg', options: [['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']], def: '24h' },
  { id: 'metrics_auto_refresh', section: 'Metrics', name: 'Auto refresh', desc: 'Advance charts as new simulated observations arrive.', depth: 1, type: 'toggle', def: true },
  { id: 'zero_baseline', section: 'Metrics', name: 'Zero baselines', desc: 'Anchor quantitative plots to zero when their scale permits.', depth: 1, type: 'toggle', def: true },
  { id: 'unit_mode', section: 'Metrics', name: 'Unit mode', desc: 'Choose adaptive, absolute, or normalized value labels.', depth: 2, type: 'select', options: ['adaptive', 'absolute', 'normalized'], def: 'adaptive' },
  { id: 'anomaly_sensitivity', section: 'Metrics', name: 'Anomaly sensitivity', desc: 'Tune the threshold for highlighting unusual readings.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 62 },
  { id: 'sankey_node_gap', section: 'Metrics', name: 'Sankey node gap', desc: 'Set the vertical separation of token-routing nodes.', depth: 3, type: 'stepper', min: 4, max: 40, step: 2, unit: 'px', def: 14 },
  { id: 'heartbeat_trace_persistence', section: 'Metrics', name: 'Heartbeat trace persistence', desc: 'Retain completed heartbeat samples in the rolling trace.', depth: 4, type: 'range', min: 5, max: 120, step: 5, unit: 's', def: 30 },

  { id: 'thread_sort', section: 'Chat & Threads', name: 'Thread order', desc: 'Set the default ordering for active conversation threads.', depth: 1, type: 'seg', options: ['recent', 'priority'], def: 'recent' },
  { id: 'enter_to_send', section: 'Chat & Threads', name: 'Enter to send', desc: 'Send a composed line with Enter and use Shift+Enter for a break.', depth: 1, type: 'toggle', def: true },
  { id: 'collapse_resolved', section: 'Chat & Threads', name: 'Collapse resolved threads', desc: 'Reduce completed conversations to a quiet summary line.', depth: 1, type: 'toggle', def: true },
  { id: 'thread_preview_lines', section: 'Chat & Threads', name: 'Thread preview lines', desc: 'Choose how much recent context appears before opening a thread.', depth: 2, type: 'stepper', min: 1, max: 8, step: 1, unit: 'lines', def: 3 },
  { id: 'chat_timestamp_mode', section: 'Chat & Threads', name: 'Message timestamps', desc: 'Select relative or fixed time labels inside a conversation.', depth: 2, type: 'select', options: ['relative', 'clock', 'hidden'], def: 'relative' },
  { id: 'thread_memory_span', section: 'Chat & Threads', name: 'Thread memory span', desc: 'Set the simulated context window retained per thread.', depth: 3, type: 'range', min: 8, max: 128, step: 8, unit: 'k', def: 64 },
  { id: 'chat_stream_cadence_jitter', section: 'Chat & Threads', name: 'Chat stream cadence jitter', desc: 'Vary the interval between simulated streamed text batches.', depth: 4, type: 'range', min: 0, max: 240, step: 10, unit: 'ms', def: 40 },

  { id: 'board_mode', section: 'Comms Board', name: 'Default board mode', desc: 'Open communications as a timeline or a channel board.', depth: 1, type: 'seg', options: ['timeline', 'channels'], def: 'timeline' },
  { id: 'pin_owner_messages', section: 'Comms Board', name: 'Pin owner messages', desc: 'Keep owner-authored directives visually anchored in the stream.', depth: 1, type: 'toggle', def: true },
  { id: 'show_machine_tags', section: 'Comms Board', name: 'Machine tags', desc: 'Show the originating machine beside routed messages.', depth: 1, type: 'toggle', def: true },
  { id: 'channel_density', section: 'Comms Board', name: 'Channel density', desc: 'Set the spacing of channel rows in the left register.', depth: 2, type: 'seg', options: ['calm', 'dense'], def: 'calm' },
  { id: 'packet_highlight', section: 'Comms Board', name: 'Packet arrival highlight', desc: 'Briefly mark a communication packet as it enters the board.', depth: 2, type: 'toggle', def: true },
  { id: 'lane_arrival_hold', section: 'Comms Board', name: 'Lane arrival hold', desc: 'Hold new lane activity before returning it to resting ink.', depth: 3, type: 'range', min: 0, max: 1600, step: 50, unit: 'ms', def: 450 },
  { id: 'comms_queue_fairness', section: 'Comms Board', name: 'Comms queue fairness coefficient', desc: 'Bias simulated packet selection across equally active lanes.', depth: 4, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50 },

  { id: 'ledger_register', section: 'Ledger', name: 'Default register', desc: 'Open the ledger on owner requests or owner questions.', depth: 1, type: 'seg', options: [['r', 'R items'], ['q', 'Q items']], def: 'r' },
  { id: 'expand_evidence', section: 'Ledger', name: 'Expand evidence', desc: 'Show evidence lines when a ledger record is first opened.', depth: 1, type: 'toggle', def: false },
  { id: 'show_done', section: 'Ledger', name: 'Show completed items', desc: 'Include completed requests in the default register view.', depth: 1, type: 'toggle', def: true },
  { id: 'ledger_age_format', section: 'Ledger', name: 'Age format', desc: 'Choose concise elapsed time or exact claimed timestamps.', depth: 2, type: 'select', options: ['elapsed', 'claimed-at', 'both'], def: 'elapsed' },
  { id: 'root_rollup', section: 'Ledger', name: 'Root rollups', desc: 'Summarize descendant state on decomposed request roots.', depth: 2, type: 'toggle', def: true },
  { id: 'gate_signal_hold', section: 'Ledger', name: 'Gate signal hold', desc: 'Retain the gated-state emphasis after a state transition.', depth: 3, type: 'range', min: 0, max: 24, step: 1, unit: 'h', def: 4 },
  { id: 'collision_row_hysteresis', section: 'Ledger', name: 'Collision-row hysteresis', desc: 'Delay row reflow when adjacent metadata columns approach collision.', depth: 4, type: 'range', min: 0, max: 32, step: 1, unit: 'px', def: 8 },
  { id: 'ledger_archive', section: 'Ledger', name: 'Clean up old R', desc: 'Preview completed or fully superseded requests; a second explicit click moves the verified preview into the durable archive.', depth: 1, type: 'action', def: null },

  { id: 'power_profile', section: 'Performance', name: 'Power profile', desc: 'Balance responsiveness against background resource use.', depth: 1, type: 'seg', options: ['balanced', 'quiet'], def: 'balanced' },
  { id: 'chart_quality', section: 'Performance', name: 'Chart quality', desc: 'Choose the default rendering detail for metric canvases.', depth: 1, type: 'seg', options: ['standard', 'high'], def: 'standard' },
  { id: 'background_updates', section: 'Performance', name: 'Background updates', desc: 'Allow inactive views to retain their simulated data clock.', depth: 1, type: 'toggle', def: true },
  { id: 'graph_frame_cap', section: 'Performance', name: 'Graph frame cap', desc: 'Limit hierarchy animation to a fixed frame budget.', depth: 2, type: 'select', options: [['30', '30 fps'], ['60', '60 fps'], ['auto', 'Adaptive']], def: 'auto' },
  { id: 'data_history', section: 'Performance', name: 'In-memory history', desc: 'Set the simulated sample history retained by active charts.', depth: 2, type: 'range', min: 5, max: 120, step: 5, unit: 'min', def: 30 },
  { id: 'reflow_debounce', section: 'Performance', name: 'Reflow debounce', desc: 'Delay non-critical layout fitting during rapid size changes.', depth: 3, type: 'stepper', min: 0, max: 240, step: 10, unit: 'ms', def: 40 },
  { id: 'layer_promotion_threshold', section: 'Performance', name: 'Layer-promotion threshold', desc: 'Set the moving-element count that promotes a composited layer.', depth: 4, type: 'stepper', min: 1, max: 64, step: 1, unit: 'nodes', def: 12 },

  { id: 'scenario_tick_rate', section: 'Data & Sim', name: 'Scenario tick rate', desc: 'Set the cadence of simulated operational observations.', depth: 1, type: 'range', min: 30, max: 300, step: 5, unit: '%', def: 100 },
  { id: 'seed_mode', section: 'Data & Sim', name: 'Seed mode', desc: 'Choose stable sessions or varied simulated histories.', depth: 1, type: 'seg', options: ['stable', 'varied'], def: 'stable' },
  { id: 'retain_samples', section: 'Data & Sim', name: 'Retain samples on navigation', desc: 'Keep simulated view data when moving around the route ring.', depth: 1, type: 'toggle', def: true },
  { id: 'offline_fallback', section: 'Data & Sim', name: 'Offline fallback', desc: 'Use the local simulation when a live source is unavailable.', depth: 1, type: 'toggle', def: true },
  ...LIVE_VIEW_FLAGS.map(flag => ({
    id: `live_${flag.id}`,
    section: 'Data & Sim',
    name: `${flag.label} live data`,
    desc: `Read ${flag.domain}.json on this surface; turn off for the preserved simulation.`,
    depth: 1,
    type: 'toggle',
    def: true,
  })),
  { id: 'event_variance', section: 'Data & Sim', name: 'Event variance', desc: 'Adjust the spread of simulated workload arrivals.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 35 },
  { id: 'failure_rate', section: 'Data & Sim', name: 'Synthetic failure rate', desc: 'Set the background rate of recoverable simulated failures.', depth: 2, type: 'range', min: 0, max: 20, step: 1, unit: '%', def: 3 },
  { id: 'sample_bucket', section: 'Data & Sim', name: 'Sample bucket width', desc: 'Aggregate raw simulation ticks into wider time buckets.', depth: 3, type: 'stepper', min: 1, max: 60, step: 1, unit: 's', def: 5 },
  { id: 'sim_worker_tick_bias', section: 'Data & Sim', name: 'Sim worker tick bias', desc: 'Offset worker scheduling toward freshness or batch efficiency.', depth: 4, type: 'range', min: -100, max: 100, step: 5, unit: '%', def: 0 },

  ...WRITE_ACTION_FLAGS.map(flag => ({
    id: `write_${flag.id}`,
    section: 'Write',
    name: flag.label,
    desc: `${flag.description} Off is the shipped default until live review.`,
    depth: ['dispatch', 'report-read'].includes(flag.id) ? 1 : 2,
    type: 'toggle',
    def: false,
  })),

  { id: 'diagnostic_labels', section: 'Developer', name: 'Diagnostic labels', desc: 'Expose bounded component identifiers beside live surfaces.', depth: 1, type: 'toggle', def: false },
  { id: 'log_level', section: 'Developer', name: 'Console detail', desc: 'Set the simulated diagnostic detail written by the client.', depth: 1, type: 'seg', options: ['quiet', 'normal', 'verbose'], def: 'normal' },
  { id: 'copy_ids', section: 'Developer', name: 'Copy stable identifiers', desc: 'Prefer stable IDs when copying rows, agents, or channels.', depth: 1, type: 'toggle', def: true },
  { id: 'expose_timings', section: 'Developer', name: 'Expose render timings', desc: 'Append measured render duration to development-only readouts.', depth: 2, type: 'toggle', def: false },
  { id: 'mock_failures', section: 'Developer', name: 'Permit mock failures', desc: 'Allow simulated error states in otherwise healthy surfaces.', depth: 2, type: 'toggle', def: false },
  { id: 'observer_budget', section: 'Developer', name: 'Observer callback budget', desc: 'Set the soft ceiling for one resize or mutation callback.', depth: 3, type: 'stepper', min: 1, max: 24, step: 1, unit: 'ms', def: 8 },
  { id: 'tier_guide_hairline_alpha', section: 'Developer', name: 'Tier-guide hairline alpha', desc: 'Set the compositing weight of hierarchy guide hairlines.', depth: 4, type: 'range', min: 1, max: 20, step: 1, unit: '%', def: 7 },
]

const byId = new Map(SETTINGS.map(setting => [setting.id, setting]))
const liveSettingViews = new Map(LIVE_VIEW_FLAGS.map(flag => [`live_${flag.id}`, flag.id]))
const writeSettingActions = new Map(WRITE_ACTION_FLAGS.map(flag => [`write_${flag.id}`, flag.id]))
const storageKey = id => `mc.set.${id}`
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function optionRecords(setting) {
  return (setting.options || []).map(option => {
    if (Array.isArray(option)) return { value: String(option[0]), label: String(option[1]) }
    const value = String(option)
    return { value, label: value.charAt(0).toUpperCase() + value.slice(1) }
  })
}

function clampNumber(setting, value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return setting.def
  return Math.min(setting.max, Math.max(setting.min, number))
}

function readStored(setting) {
  try {
    const raw = localStorage.getItem(storageKey(setting.id))
    if (raw === null) return setting.def
    if (setting.type === 'toggle') return raw === 'true' ? true : raw === 'false' ? false : setting.def
    if (setting.type === 'range' || setting.type === 'stepper') return clampNumber(setting, raw)
    return optionRecords(setting).some(option => option.value === raw) ? raw : setting.def
  } catch { return setting.def }
}

function readValue(setting) {
  const liveView = liveSettingViews.get(setting.id)
  if (liveView) return isLiveView(liveView)
  const writeAction = writeSettingActions.get(setting.id)
  if (writeAction) return isWriteEnabled(writeAction)
  if (setting.id === 'theme') {
    const current = document.documentElement.dataset.theme
    return current === 'tan' || current === 'black' ? current : 'white'
  }
  if (setting.id === 'text_size') {
    const zoom = parseFloat(document.body.style.zoom)
    return zoom === 0.9 || zoom === 1.12 ? String(zoom) : '1'
  }
  if (setting.id === 'glow') {
    const drawerValue = Number(document.getElementById('set-glow')?.value)
    return Number.isFinite(drawerValue) ? drawerValue : setting.def
  }
  if (setting.id === 'reduce_motion') return document.body.classList.contains('reduce-motion')
  return readStored(setting)
}

function sameValue(left, right) {
  return String(left) === String(right)
}

function writeStored(setting, value) {
  try {
    if (sameValue(value, setting.def)) localStorage.removeItem(storageKey(setting.id))
    else localStorage.setItem(storageKey(setting.id), String(value))
  } catch {}
}

function setDrawerSegment(selector, dataName, value) {
  for (const button of document.querySelectorAll(`${selector} button`)) {
    const on = sameValue(button.dataset[dataName], value)
    button.classList.toggle('on', on)
    button.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatValue(setting, value) {
  if (setting.type === 'select') {
    return optionRecords(setting).find(option => sameValue(option.value, value))?.label || String(value)
  }
  if (setting.type === 'range' || setting.type === 'stepper') {
    const unit = setting.unit || ''
    const join = unit === '%' || unit === 'px' ? '' : unit ? ' ' : ''
    return `${formatNumber(value)}${join}${unit}`
  }
  return String(value)
}

function controlMarkup(setting) {
  const labelId = `setting-label-${setting.id}`

  if (setting.type === 'action') {
    return `<button type="button" class="ctl-btn" data-setting-action="ledger-archive" aria-labelledby="${labelId}">Preview cleanup</button>`
  }
  const value = readValue(setting)

  if (setting.type === 'seg') {
    return `<div class="seg settings-seg" role="group" aria-labelledby="${labelId}">
      ${optionRecords(setting).map(option => `<button type="button" data-setting-value="${escapeHtml(option.value)}" aria-pressed="${sameValue(option.value, value)}" class="${sameValue(option.value, value) ? 'on' : ''}">${escapeHtml(option.label)}</button>`).join('')}
    </div>`
  }
  if (setting.type === 'toggle') {
    return `<label class="toggle settings-toggle"><input type="checkbox" aria-labelledby="${labelId}" ${value ? 'checked' : ''}/><i></i></label>`
  }
  if (setting.type === 'range') {
    return `<div class="settings-range"><input type="range" min="${setting.min}" max="${setting.max}" step="${setting.step}" value="${value}" aria-labelledby="${labelId}"/><output data-setting-output>${escapeHtml(formatValue(setting, value))}</output></div>`
  }

  const isSelect = setting.type === 'select'
  return `<div class="settings-stepper ${isSelect ? 'is-select' : ''}" role="group" aria-labelledby="${labelId}">
    <button type="button" data-step-delta="-1" aria-label="Previous ${escapeHtml(setting.name)}">&lt;</button>
    <output data-setting-output>${escapeHtml(formatValue(setting, value))}</output>
    <button type="button" data-step-delta="1" aria-label="Next ${escapeHtml(setting.name)}">&gt;</button>
  </div>`
}

function rowMarkup(setting, searchResult = false) {
  return `<article class="settings-row ${setting.depth === 4 ? 'is-engineer' : ''}" data-setting-id="${setting.id}">
    <div class="settings-copy">
      ${searchResult ? `<div class="settings-prefix">${escapeHtml(setting.section)} · depth ${setting.depth}</div>` : ''}
      <div class="settings-name" id="setting-label-${setting.id}">${escapeHtml(setting.name)}</div>
      <div class="settings-desc" data-setting-message>${escapeHtml(setting.desc)}</div>
    </div>
    <div class="settings-control">${controlMarkup(setting)}</div>
  </article>`
}

function revealMarkup(section, depth, count, prefix, open) {
  const controlId = `settings-tier-${SECTIONS.indexOf(section)}-${depth}`
  return `<button class="settings-reveal" type="button" data-reveal-section="${escapeHtml(section)}" data-reveal-depth="${depth}" data-reveal-count="${count}" data-reveal-prefix="${prefix}" aria-controls="${controlId}" aria-expanded="${open ? 'true' : 'false'}">${revealInner(prefix, count, open)}</button>`
}

/* The chevron gets its own element: a cold reader hedged on whether the bare
   "4 more ⌄" line was clickable — the glyph now sits at affordance size and
   answers on hover instead of relying on the reader's faith. */
function revealInner(prefix, count, open) {
  const text = prefix
    ? `${prefix} · ${open ? 'less' : `${count} more`}`
    : `${count} ${open ? 'fewer' : 'more'}`
  return `${escapeHtml(text)}<span class="settings-reveal-glyph" aria-hidden="true">${open ? '⌃' : '⌄'}</span>`
}

function tierMarkup(section, depth, content, open) {
  return `<div class="settings-tier settings-tier-${depth} ${open ? 'is-open' : ''}" id="settings-tier-${SECTIONS.indexOf(section)}-${depth}" data-tier-depth="${depth}" aria-hidden="${open ? 'false' : 'true'}" ${open ? '' : 'inert'}><div class="settings-tier-inner">${content}</div></div>`
}

function sectionMarkup(section, level) {
  const items = SETTINGS.filter(setting => setting.section === section)
  const at = depth => items.filter(setting => setting.depth === depth)
  const depth4 = tierMarkup(section, 4, at(4).map(setting => rowMarkup(setting)).join(''), level >= 4)
  const depth3Content = [
    ...at(3).map(setting => rowMarkup(setting)),
    revealMarkup(section, 4, at(4).length, 'everything', level >= 4),
    depth4,
  ].join('')
  const depth3 = tierMarkup(section, 3, depth3Content, level >= 3)
  const depth2Content = [
    ...at(2).map(setting => rowMarkup(setting)),
    revealMarkup(section, 3, at(3).length + at(4).length, 'advanced', level >= 3),
    depth3,
  ].join('')
  const depth2 = tierMarkup(section, 2, depth2Content, level >= 2)
  const hidden = items.filter(setting => setting.depth > 1).length

  return `<section class="settings-section" data-settings-section="${escapeHtml(section)}">
    <h2 class="settings-section-title">${escapeHtml(section)}</h2>
    <div class="settings-section-rows">${at(1).map(setting => rowMarkup(setting)).join('')}</div>
    ${revealMarkup(section, 2, hidden, '', level >= 2)}
    ${depth2}
  </section>`
}

function setTierFocusable(tier, open) {
  tier.toggleAttribute('inert', !open)
  for (const control of tier.querySelectorAll('button, input, select, textarea, [tabindex]')) {
    if (!open) {
      if (control.dataset.settingsTabindex === undefined) {
        control.dataset.settingsTabindex = control.getAttribute('tabindex') ?? ''
        control.setAttribute('tabindex', '-1')
      }
    } else if (control.dataset.settingsTabindex !== undefined) {
      const previous = control.dataset.settingsTabindex
      if (previous === '') control.removeAttribute('tabindex')
      else control.setAttribute('tabindex', previous)
      delete control.dataset.settingsTabindex
    }
  }
}

export function settingsView() {
  const profileController = createFleetProfileSettings()
  const setupController = createSetupProfileSettings()
  const root = el(`<main class="view-pad settings-page">
    <div class="settings-shell">
      <header class="settings-header m-head">
        <h1 class="mt">Settings</h1>
        <span class="spacer"></span>
        <label class="settings-search"><span class="settings-sr-only">Search all settings</span><input type="search" placeholder="search all settings" autocomplete="off" spellcheck="false"/></label>
      </header>
      <div class="settings-layout">
        <nav class="settings-rail" aria-label="Settings categories">
          ${SECTIONS.map((section, index) => `<button type="button" data-category="${escapeHtml(section)}" class="${index === 0 ? 'is-active' : ''}" ${index === 0 ? 'aria-current="location"' : ''}>${escapeHtml(section)}</button>`).join('')}
        </nav>
        <div class="settings-main">
          <div class="settings-sections" aria-live="polite"></div>
          <p class="settings-footer"></p>
        </div>
      </div>
    </div>
  </main>`)

  const searchInput = root.querySelector('.settings-search input')
  const sectionsNode = root.querySelector('.settings-sections')
  const footer = root.querySelector('.settings-footer')
  const rail = root.querySelector('.settings-rail')
  const levels = new Map(SECTIONS.map(section => [section, 1]))
  let query = ''
  let shown = 0
  let activeSection = SECTIONS[0]
  let segCleanups = []
  let scrollFrame = 0
  let archiveController

  function syncArchiveControl(state = archiveController?.getState()) {
    if (!state) return
    for (const row of root.querySelectorAll('[data-setting-id="ledger_archive"]')) {
      const button = row.querySelector('button[data-setting-action="ledger-archive"]')
      const message = row.querySelector('[data-setting-message]')
      if (button) {
        button.textContent = state.label
        button.disabled = !state.enabled
        button.title = state.note
        button.setAttribute('aria-label', `${state.label}: ${state.note}`)
        button.classList.toggle('is-confirming', state.phase === 'confirm')
        button.classList.toggle('is-pending', state.phase.startsWith('pending'))
        button.classList.toggle('is-success', state.phase === 'success')
      }
      if (message) message.textContent = state.message
    }
  }

  archiveController = createLedgerArchiveController({ onState: syncArchiveControl })

  function cleanupControls() {
    for (const cleanup of segCleanups) cleanup()
    segCleanups = []
  }

  function wireControls() {
    cleanupControls()
    for (const group of sectionsNode.querySelectorAll('.settings-seg')) segCleanups.push(attachSeg(group))
    for (const input of sectionsNode.querySelectorAll('input[type="range"]')) rangeFill(input)
    syncArchiveControl()
    profileController.afterRender(root)
    setupController.afterRender(root)
  }

  function updateFooter() {
    footer.textContent = `${SETTINGS.length + FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT} settings · ${shown} shown · search reaches all depths`
  }

  function syncRail() {
    for (const button of rail.querySelectorAll('button[data-category]')) {
      const on = button.dataset.category === activeSection
      button.classList.toggle('is-active', on)
      if (on) button.setAttribute('aria-current', 'location')
      else button.removeAttribute('aria-current')
    }
  }

  function sectionNodeMarkup(section) {
    if (section === 'System') return profileController.markup()
    if (section === 'Setup') return setupController.markup()
    return sectionMarkup(section, levels.get(section))
  }

  function renderSectioned() {
    sectionsNode.innerHTML = SECTIONS.map(sectionNodeMarkup).join('')
    shown = FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT
      + SETTINGS.filter(setting => setting.depth <= levels.get(setting.section)).length
    // `inert` is the primary guard; the explicit tabindex pass keeps closed
    // tiers unreachable in older engines while preserving the CSS reveal.
    for (const section of SECTIONS) syncSectionDepth(section)
    wireControls()
    updateFooter()
    syncRail()
  }

  function renderSearch() {
    const normalized = query.trim().toLowerCase()
    const matches = SETTINGS.filter(setting => `${setting.name} ${setting.desc} ${setting.section}`.toLowerCase().includes(normalized))
    const profileMatches = profileController.matches(normalized)
    const setupMatches = setupController.matches(normalized)
    sectionsNode.innerHTML = `<section class="settings-results">
      <h2 class="settings-section-title">Results</h2>
      ${profileMatches ? profileController.markup({ searchResult: true }) : ''}
      ${setupMatches ? setupController.markup({ searchResult: true }) : ''}
      ${matches.map(setting => rowMarkup(setting, true)).join('')}
      ${profileMatches || setupMatches || matches.length ? '' : '<p class="settings-empty">No settings match this search.</p>'}
    </section>`
    shown = matches.length
      + (profileMatches ? FLEET_PROFILE_SETTING_COUNT : 0)
      + (setupMatches ? SETUP_PROFILE_SETTING_COUNT : 0)
    wireControls()
    updateFooter()
  }

  function renderCurrent() {
    if (query.trim()) renderSearch()
    else renderSectioned()
  }

  function syncSetting(id, value = readValue(byId.get(id))) {
    const setting = byId.get(id)
    if (!setting) return
    for (const row of root.querySelectorAll(`[data-setting-id="${id}"]`)) {
      for (const button of row.querySelectorAll('button[data-setting-value]')) {
        const on = sameValue(button.dataset.settingValue, value)
        button.classList.toggle('on', on)
        button.setAttribute('aria-pressed', on ? 'true' : 'false')
      }
      const checkbox = row.querySelector('.settings-toggle input')
      if (checkbox) checkbox.checked = Boolean(value)
      const range = row.querySelector('input[type="range"]')
      if (range) {
        range.value = value
        const percent = ((Number(value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100
        range.style.setProperty('--fill', `${percent}%`)
      }
      const output = row.querySelector('[data-setting-output]')
      if (output) output.textContent = formatValue(setting, value)
    }
  }

  function applyValue(setting, value) {
    const liveView = liveSettingViews.get(setting.id)
    if (liveView) {
      value = setLiveView(liveView, Boolean(value))
    } else if (writeSettingActions.has(setting.id)) {
      value = setWriteEnabled(writeSettingActions.get(setting.id), Boolean(value))
    } else if (setting.id === 'theme') {
      try { localStorage.setItem('mc.theme', String(value)) } catch {}
      document.documentElement.dataset.theme = String(value)
      setDrawerSegment('#theme-seg', 'theme', value)
    } else if (setting.id === 'text_size') {
      try { localStorage.setItem('mc.text', String(value)) } catch {}
      const number = Number(value)
      document.body.style.zoom = number === 1 ? '' : String(number)
      setDrawerSegment('#text-seg', 'text', value)
    } else if (setting.id === 'glow') {
      const number = clampNumber(setting, value)
      document.documentElement.style.setProperty('--glow', String(number / 100))
      const drawerRange = document.getElementById('set-glow')
      if (drawerRange) {
        drawerRange.value = number
        const percent = ((number - Number(drawerRange.min)) / (Number(drawerRange.max) - Number(drawerRange.min))) * 100
        drawerRange.style.setProperty('--fill', `${percent}%`)
      }
      value = number
    } else if (setting.id === 'reduce_motion') {
      value = Boolean(value)
      document.body.classList.toggle('reduce-motion', value)
      const drawerToggle = document.getElementById('set-motion')
      if (drawerToggle) drawerToggle.checked = value
    } else {
      writeStored(setting, value)
    }
    syncSetting(setting.id, value)
  }

  function syncSectionDepth(section) {
    const sectionNode = [...sectionsNode.querySelectorAll('.settings-section')]
      .find(node => node.dataset.settingsSection === section)
    if (!sectionNode) return
    const level = levels.get(section)
    for (let depth = 2; depth <= 4; depth += 1) {
      const tier = sectionNode.querySelector(`[data-tier-depth="${depth}"]`)
      if (!tier) continue
      const open = level >= depth
      tier.classList.toggle('is-open', open)
      tier.setAttribute('aria-hidden', open ? 'false' : 'true')
      setTierFocusable(tier, open)

      const button = sectionNode.querySelector(`button[data-reveal-depth="${depth}"]`)
      if (!button) continue
      const count = button.dataset.revealCount
      const prefix = button.dataset.revealPrefix
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      button.innerHTML = revealInner(prefix, count, open)
    }
    shown = FLEET_PROFILE_SETTING_COUNT + SETTINGS.filter(setting => setting.depth <= levels.get(setting.section)).length
    updateFooter()
  }

  function cycleValue(setting, current, delta) {
    if (setting.type === 'select') {
      const options = optionRecords(setting)
      const index = Math.max(0, options.findIndex(option => sameValue(option.value, current)))
      return options[(index + delta + options.length) % options.length].value
    }
    const next = Number(current) + delta * setting.step
    return clampNumber(setting, Number(next.toFixed(4)))
  }

  sectionsNode.addEventListener('click', event => {
    const archiveButton = event.target.closest('button[data-setting-action="ledger-archive"]')
    if (archiveButton) {
      archiveController.click()
      return
    }

    const reveal = event.target.closest('button[data-reveal-section]')
    if (reveal) {
      const section = reveal.dataset.revealSection
      const depth = Number(reveal.dataset.revealDepth)
      levels.set(section, levels.get(section) >= depth ? depth - 1 : depth)
      syncSectionDepth(section)
      return
    }

    const valueButton = event.target.closest('button[data-setting-value]')
    if (valueButton) {
      const row = valueButton.closest('[data-setting-id]')
      applyValue(byId.get(row.dataset.settingId), valueButton.dataset.settingValue)
      return
    }

    const stepButton = event.target.closest('button[data-step-delta]')
    if (stepButton) {
      const row = stepButton.closest('[data-setting-id]')
      const setting = byId.get(row.dataset.settingId)
      const next = cycleValue(setting, readValue(setting), Number(stepButton.dataset.stepDelta))
      applyValue(setting, next)
    }
  })

  sectionsNode.addEventListener('input', event => {
    const input = event.target.closest('input[type="range"]')
    if (!input) return
    const row = input.closest('[data-setting-id]')
    applyValue(byId.get(row.dataset.settingId), Number(input.value))
  })

  sectionsNode.addEventListener('change', event => {
    const input = event.target.closest('.settings-toggle input')
    if (!input) return
    const row = input.closest('[data-setting-id]')
    applyValue(byId.get(row.dataset.settingId), input.checked)
  })

  searchInput.addEventListener('input', () => {
    query = searchInput.value
    renderCurrent()
  })

  rail.addEventListener('click', event => {
    const button = event.target.closest('button[data-category]')
    if (!button) return
    activeSection = button.dataset.category
    syncRail()
    if (query.trim()) {
      query = ''
      searchInput.value = ''
      renderSectioned()
    }
    requestAnimationFrame(() => {
      const section = [...sectionsNode.querySelectorAll('.settings-section')]
        .find(node => node.dataset.settingsSection === activeSection)
      section?.scrollIntoView({ behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'start' })
    })
  })

  function updateActiveFromScroll() {
    scrollFrame = 0
    if (query.trim()) return
    const top = root.getBoundingClientRect().top + 48
    let next = SECTIONS[0]
    for (const section of sectionsNode.querySelectorAll('.settings-section')) {
      if (section.getBoundingClientRect().top <= top) next = section.dataset.settingsSection
      else break
    }
    if (next !== activeSection) {
      activeSection = next
      syncRail()
    }
  }

  const onScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateActiveFromScroll)
  }
  root.addEventListener('scroll', onScroll, { passive: true })

  const drawerBindings = [
    [document.getElementById('theme-seg'), 'click', () => syncSetting('theme')],
    [document.getElementById('text-seg'), 'click', () => syncSetting('text_size')],
    [document.getElementById('set-glow'), 'input', () => syncSetting('glow')],
    [document.getElementById('set-motion'), 'change', () => syncSetting('reduce_motion')],
  ].filter(binding => binding[0])
  for (const [node, type, listener] of drawerBindings) node.addEventListener(type, listener)

  profileController.bind(root)
  renderSectioned()

  return {
    el: root,
    destroy() {
      cleanupControls()
      archiveController.destroy()
      profileController.destroy()
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      for (const [node, type, listener] of drawerBindings) node.removeEventListener(type, listener)
    },
  }
}
