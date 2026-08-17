// /settings — progressively disclosed preferences plus the first-run system
// register. Appearance can fail soft; fleet configuration is correctness data
// and uses the durable profile store instead of the cosmetic setting idiom.

import { el, attachSeg } from '../components.js'
import { rangeFill } from './computers.js'
import { sim } from '../sim.js'
import { QUICK_SETTING_EVENT } from '../quick-settings.js'
import {
  FONT_CHOICES,
  FONT_STORAGE_KEY,
  applyFontChoice,
  currentFontChoice,
  fontStack,
  normalizeFontId,
} from '../font-choice.js'
import { LIVE_VIEW_FLAGS, isLiveView, setLiveView } from '../live-flags.js'
import { WRITE_ACTION_FLAGS, isWriteEnabled, setWriteEnabled } from '../write-flags.js'
import { createLedgerArchiveController } from '../mission-bridge.js'
/* WHAT EVERY ROW GRANTS AND WHAT IT RISKS, stated separately (owner, R1529).
   The statements are data in src/permission-guidance.js and the markup is
   src/guided-step.js, so this page asks for a row's explanation rather than
   carrying ninety of them itself. A row the declarations do not cover is drawn
   saying so, which is why nothing here needs a fallback sentence. */
import { guidanceMarkup } from '../guided-step.js'
import { describeSubject } from '../permission-guidance.js'
import { CAPABILITY_PROBE_EVENT, probe, refreshCapabilityProbes } from '../capability-probes.js'
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
/* The first section on this page, and first because the box it governs is the
   first thing in the product: which agents' context appears in the chat box on
   the home screen, and whether agent runs appear there too, not at all, or on
   their own. */
import {
  CHATBOX_SECTION,
  CHATBOX_SETTING_COUNT,
  createChatboxSettings,
} from '../chatbox-settings.js'
/* WHY A SECTION ON THIS PAGE NEEDS A SENTENCE ABOVE ITS SWITCHES.
 *
 * LEGACY-ONB-001, re-measured on a sterile profile: a person whose fleet graph
 * and comms board both say "No local agent fleet host detected on this machine"
 * comes here looking for the switch that fixes it. Under Data and Sim they find
 * six toggles reading "<screen> live data", every one of them already ON, and
 * nothing anywhere on the page telling them that turning them on was never the
 * problem. There is no switch for the thing they are looking for, and the most
 * useful thing this page can do is say so and point at the page that explains it
 * -- otherwise the search ends in them flipping live sources off and concluding
 * the product is fake data. */
import { GUIDE_HREF } from '../first-run-needs.js'
import '../settings.css'
import '../chatbox-settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'
import '../guide.css'

const SECTIONS = [
  CHATBOX_SECTION,
  'System',
  'Setup',
  /* HIGH IN THE LIST ON PURPOSE. This section holds one question -- what happens
     to the person's data when they uninstall -- and until 2026-08-11 the product
     had no answer to it anywhere: uninstalling left 92 files and 11.87 MB,
     including the credential vault and the signed audit ledger, with nothing
     asked and nothing said. A control for that buried below the simulation
     knobs would be a control nobody finds, which is the same outcome. */
  'Data & Privacy',
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
  /* THE DEFAULT IS "ASK ME", AND THAT IS THE WHOLE POINT OF THIS ENTRY.
   *
   * Uninstalling used to keep everything and say nothing. Setting the default
   * here to "Keep my data" would leave that behaviour exactly as it is and add a
   * control nobody had to touch -- the same silent retention, now with a setting
   * page that appears to have consented on the person's behalf. The default has
   * to be the QUESTION.
   *
   * It also has to be "ask" for a mechanical reason worth stating: setValue()
   * REMOVES the stored key when the chosen value equals `def` (see the
   * localStorage.removeItem branch below), so "ask" is the one value that is
   * indistinguishable from never having chosen. Making it the default aligns the
   * storage model with shell/uninstall-retention.cjs, where absence and `ask`
   * deliberately resolve to the same thing. Any other default would make
   * "never chose" and "chose the default" mean different things to the
   * uninstaller while looking identical on disk.
   *
   * NEITHER REAL OPTION IS MARKED RECOMMENDED. This product has already shipped
   * a setup screen with both answers labelled "Recommended", which is how it
   * ended up with no Start control anywhere. There is no correct answer here --
   * it depends on whether the person is reinstalling or leaving -- and a hint
   * would be this file deciding for them. */
  {
    id: 'uninstall_data',
    section: 'Data & Privacy',
    name: 'When I uninstall ToolsEnabled',
    desc: 'Uninstalling removes the program. It does not remove your saved credentials, '
      + 'your linked accounts, the signed record of every action taken, your agent history '
      + 'or your settings — those stay on this computer so a reinstall picks up where you '
      + 'left off. Choose what should happen to them.',
    depth: 1,
    type: 'seg',
    options: [['ask', 'Ask me then'], ['keep-my-data', 'Keep my data'], ['remove-everything', 'Remove everything']],
    def: 'ask',
  },

  { id: 'theme', section: 'Appearance', name: 'Theme', desc: 'Choose the app’s look: a white, tan, or black background.', depth: 1, type: 'seg', options: [['white', 'White'], ['tan', 'Tan'], ['black', 'Black']], def: 'white' },
  /* The choices live in src/font-choice.js (owner, R1523); each option's
     button is written in the font it applies, here and in the drawer. */
  { id: 'ui_font', section: 'Appearance', name: 'Font', desc: 'Choose the app’s lettering. Each option is written in its own font, so what you see on the button is what you get everywhere.', depth: 1, type: 'seg', options: FONT_CHOICES.map(choice => [choice.id, choice.label]), def: 'plex' },
  { id: 'display_density', section: 'Appearance', name: 'Display density', desc: 'How tightly packed busy screens are. Comfortable gives everything more room; compact fits more on screen.', depth: 1, type: 'seg', options: ['comfortable', 'compact'], def: 'comfortable' },
  { id: 'contrast_curve', section: 'Appearance', name: 'Contrast curve', desc: 'Make the lighter, secondary text darker and easier to read, without changing the theme.', depth: 1, type: 'seg', options: ['standard', 'strong'], def: 'standard' },
  { id: 'role_hue_emphasis', section: 'Appearance', name: 'Emphasize role colors', desc: 'Make each agent role’s color stand out a little more.', depth: 1, type: 'toggle', def: false },
  { id: 'chrome_edge_weight', section: 'Appearance', name: 'Chrome edge weight', desc: 'How visible the thin outlines around buttons and panels are.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 42 },
  { id: 'drawer_width', section: 'Appearance', name: 'Settings drawer width', desc: 'How wide the quick settings panel (behind the gear button) opens.', depth: 2, type: 'stepper', min: 280, max: 440, step: 8, unit: 'px', def: 320 },
  { id: 'surface_frost', section: 'Appearance', name: 'Surface frost retention', desc: 'How much frosted-glass blur panels keep. Lower is clearer, higher is softer.', depth: 3, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 58 },
  { id: 'brace_stroke_width', section: 'Appearance', name: 'Brace stroke width', desc: 'The thickness of the curly-brace lines that frame the home panel, in fractions of a pixel.', depth: 4, type: 'stepper', min: 0.75, max: 2, step: 0.25, unit: 'px', def: 1.25 },

  { id: 'text_size', section: 'Text & Reading', name: 'Text size', desc: 'Make everything bigger or smaller without changing the layout.', depth: 1, type: 'seg', options: [['0.9', 'Small'], ['1', 'Default'], ['1.12', 'Large']], def: '1' },
  { id: 'numeric_font', section: 'Text & Reading', name: 'Mono numeric values', desc: 'Show numbers and IDs in a fixed-width font, so digits line up as they change.', depth: 1, type: 'toggle', def: true },
  { id: 'reading_line_height', section: 'Text & Reading', name: 'Reading line height', desc: 'How much vertical space lines of text get in descriptions and messages.', depth: 1, type: 'seg', options: ['tight', 'standard', 'open'], def: 'standard' },
  { id: 'timestamp_verbosity', section: 'Text & Reading', name: 'Timestamp detail', desc: 'How times are shown: “5 minutes ago” (relative), clock time, or the full date and time.', depth: 2, type: 'select', options: ['relative', 'clock', 'full'], def: 'relative' },
  { id: 'reading_measure', section: 'Text & Reading', name: 'Reading measure', desc: 'The longest a line of text may grow before it wraps, measured in characters.', depth: 2, type: 'stepper', min: 56, max: 92, step: 2, unit: 'ch', def: 72 },
  { id: 'caps_tracking', section: 'Text & Reading', name: 'Micro-cap tracking', desc: 'The letter spacing of the small ALL-CAPS labels used in navigation.', depth: 3, type: 'range', min: 6, max: 18, step: 1, unit: '%', def: 12 },
  { id: 'baseline_nudge', section: 'Text & Reading', name: 'Tabular baseline nudge', desc: 'Nudge columns of numbers up or down so they sit level with the text beside them.', depth: 4, type: 'stepper', min: -2, max: 2, step: 0.25, unit: 'px', def: 0 },

  { id: 'reduce_motion', section: 'Motion & Effects', name: 'Reduce motion', desc: 'Turn animation off: things move instantly and nothing pulses in the background.', depth: 1, type: 'toggle', def: false },
  { id: 'glow', section: 'Motion & Effects', name: 'Glow intensity', desc: 'How brightly the glowing status lights shine.', depth: 1, type: 'range', min: 0, max: 200, step: 1, unit: '%', def: 100 },
  { id: 'view_transitions', section: 'Motion & Effects', name: 'View transitions', desc: 'Fade smoothly from one page to the next instead of switching instantly.', depth: 1, type: 'toggle', def: true },
  { id: 'entry_response', section: 'Motion & Effects', name: 'Entry response', desc: 'How long newly appearing panels take to settle into place.', depth: 2, type: 'range', min: 120, max: 600, step: 20, unit: 'ms', def: 420 },
  { id: 'hover_response', section: 'Motion & Effects', name: 'Hover response', desc: 'How quickly controls change shade when the pointer passes over them.', depth: 2, type: 'select', options: ['immediate', 'clinical', 'soft'], def: 'clinical' },
  { id: 'checkpoint_halo_decay', section: 'Motion & Effects', name: 'Checkpoint halo decay', desc: 'How long the glow around a checkpoint stays visible after it pulses.', depth: 3, type: 'range', min: 120, max: 1600, step: 40, unit: 'ms', def: 800 },
  { id: 'view_morph_snapshot_bias', section: 'Motion & Effects', name: 'View-morph snapshot bias', desc: 'During the crossfade between pages, whether the old or the new page holds the frame longer.', depth: 4, type: 'range', min: -100, max: 100, step: 5, unit: '%', def: 0 },

  { id: 'graph_layout', section: 'Fleet Graph', name: 'Graph layout', desc: 'How the map of your agents arranges itself: balanced, tighter, or spread wide.', depth: 1, type: 'seg', options: ['balanced', 'compact', 'wide'], def: 'balanced' },
  { id: 'agent_labels', section: 'Fleet Graph', name: 'Agent labels', desc: 'Keep each agent’s name visible on the map without zooming in.', depth: 1, type: 'toggle', def: true },
  { id: 'group_by_machine', section: 'Fleet Graph', name: 'Group by machine', desc: 'Group agents on the map by the computer they run on.', depth: 1, type: 'toggle', def: true },
  { id: 'link_detail', section: 'Fleet Graph', name: 'Link detail', desc: 'How much is written on the lines that connect agents to each other.', depth: 1, type: 'seg', options: ['quiet', 'full'], def: 'quiet' },
  { id: 'edge_tension', section: 'Fleet Graph', name: 'Edge tension', desc: 'How curved the connecting lines between agents are drawn.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 54 },
  { id: 'collision_padding', section: 'Fleet Graph', name: 'Collision padding', desc: 'Extra breathing room kept between neighboring agents so they never touch.', depth: 2, type: 'stepper', min: 0, max: 48, step: 2, unit: 'px', def: 16 },
  { id: 'tier_vertical_gain', section: 'Fleet Graph', name: 'Tier vertical gain', desc: 'The vertical distance between levels of the map, from managers down to their agents.', depth: 3, type: 'range', min: 70, max: 150, step: 2, unit: '%', def: 100 },
  { id: 'leader_line_elbow_radius', section: 'Fleet Graph', name: 'Leader-line elbow radius', desc: 'How rounded the corner is where a label’s pointer line turns.', depth: 4, type: 'stepper', min: 0, max: 24, step: 1, unit: 'px', def: 6 },

  { id: 'metrics_window', section: 'Metrics', name: 'Default time window', desc: 'The time span charts open with: the last hour, the last day, or the last week.', depth: 1, type: 'seg', options: [['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']], def: '24h' },
  { id: 'metrics_auto_refresh', section: 'Metrics', name: 'Auto refresh', desc: 'Keep charts moving as new readings arrive in the demonstration.', depth: 1, type: 'toggle', def: true },
  { id: 'zero_baseline', section: 'Metrics', name: 'Zero baselines', desc: 'Start chart scales at zero where possible, so bar and line sizes compare honestly.', depth: 1, type: 'toggle', def: true },
  { id: 'unit_mode', section: 'Metrics', name: 'Unit mode', desc: 'How chart numbers are labelled: adaptive picks a handy unit, absolute shows the exact value, normalized shows relative scale.', depth: 2, type: 'select', options: ['adaptive', 'absolute', 'normalized'], def: 'adaptive' },
  { id: 'anomaly_sensitivity', section: 'Metrics', name: 'Anomaly sensitivity', desc: 'How unusual a reading has to be before a chart highlights it.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 62 },
  { id: 'sankey_node_gap', section: 'Metrics', name: 'Sankey node gap', desc: 'The vertical gap between the blocks of the token-flow diagram (the Sankey chart).', depth: 3, type: 'stepper', min: 4, max: 40, step: 2, unit: 'px', def: 14 },
  { id: 'heartbeat_trace_persistence', section: 'Metrics', name: 'Heartbeat trace persistence', desc: 'How long finished heartbeat blips stay visible on the rolling trace.', depth: 4, type: 'range', min: 5, max: 120, step: 5, unit: 's', def: 30 },

  { id: 'thread_sort', section: 'Chat & Threads', name: 'Thread order', desc: 'Which conversations come first: the most recent, or the most important.', depth: 1, type: 'seg', options: ['recent', 'priority'], def: 'recent' },
  { id: 'enter_to_send', section: 'Chat & Threads', name: 'Enter to send', desc: 'Press Enter to send a message; Shift+Enter starts a new line instead.', depth: 1, type: 'toggle', def: true },
  { id: 'collapse_resolved', section: 'Chat & Threads', name: 'Collapse resolved threads', desc: 'Shrink finished conversations down to one quiet summary line.', depth: 1, type: 'toggle', def: true },
  { id: 'thread_preview_lines', section: 'Chat & Threads', name: 'Thread preview lines', desc: 'How many recent lines you can see of a conversation before opening it.', depth: 2, type: 'stepper', min: 1, max: 8, step: 1, unit: 'lines', def: 3 },
  { id: 'chat_timestamp_mode', section: 'Chat & Threads', name: 'Message timestamps', desc: 'How message times are shown inside a conversation: relative, clock time, or hidden.', depth: 2, type: 'select', options: ['relative', 'clock', 'hidden'], def: 'relative' },
  { id: 'thread_memory_span', section: 'Chat & Threads', name: 'Thread memory span', desc: 'How much conversation history the demonstration keeps per thread (its context window).', depth: 3, type: 'range', min: 8, max: 128, step: 8, unit: 'k', def: 64 },
  { id: 'chat_stream_cadence_jitter', section: 'Chat & Threads', name: 'Chat stream cadence jitter', desc: 'How unevenly the demonstration streams text in, to read like natural typing.', depth: 4, type: 'range', min: 0, max: 240, step: 10, unit: 'ms', def: 40 },

  { id: 'board_mode', section: 'Comms Board', name: 'Default board mode', desc: 'Open the comms page as one single timeline, or as a board per channel.', depth: 1, type: 'seg', options: ['timeline', 'channels'], def: 'timeline' },
  { id: 'pin_owner_messages', section: 'Comms Board', name: 'Pin owner messages', desc: 'Keep your own instructions pinned in view as new messages stream past.', depth: 1, type: 'toggle', def: true },
  { id: 'show_machine_tags', section: 'Comms Board', name: 'Machine tags', desc: 'Show which computer each message came from, next to the message.', depth: 1, type: 'toggle', def: true },
  { id: 'channel_density', section: 'Comms Board', name: 'Channel density', desc: 'How tightly packed the channel list on the left is.', depth: 2, type: 'seg', options: ['calm', 'dense'], def: 'calm' },
  { id: 'packet_highlight', section: 'Comms Board', name: 'New-message highlight', desc: 'Flash a message briefly as it arrives on the board.', depth: 2, type: 'toggle', def: true },
  { id: 'lane_arrival_hold', section: 'Comms Board', name: 'Arrival hold', desc: 'How long new activity stays highlighted before fading back to normal.', depth: 3, type: 'range', min: 0, max: 1600, step: 50, unit: 'ms', def: 450 },
  { id: 'comms_queue_fairness', section: 'Comms Board', name: 'Queue fairness', desc: 'When several channels are equally busy, how evenly the demonstration spreads new messages between them (its fairness coefficient).', depth: 4, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50 },

  { id: 'ledger_register', section: 'Ledger', name: 'Open the ledger on', desc: 'Which list the ledger opens with: requests (R items) or questions (Q items).', depth: 1, type: 'seg', options: [['r', 'R items'], ['q', 'Q items']], def: 'r' },
  { id: 'expand_evidence', section: 'Ledger', name: 'Expand evidence', desc: 'Show a record’s evidence line as soon as you open it, without a second click.', depth: 1, type: 'toggle', def: false },
  { id: 'show_done', section: 'Ledger', name: 'Show completed items', desc: 'Keep finished requests visible in the list instead of hiding them.', depth: 1, type: 'toggle', def: true },
  { id: 'ledger_age_format', section: 'Ledger', name: 'Age format', desc: 'How a request’s age is shown: elapsed time (“3 h”), the exact time it was claimed, or both.', depth: 2, type: 'select', options: ['elapsed', 'claimed-at', 'both'], def: 'elapsed' },
  { id: 'root_rollup', section: 'Ledger', name: 'Root rollups', desc: 'On a request that was split into sub-items, show a summary of how the sub-items are doing.', depth: 2, type: 'toggle', def: true },
  { id: 'gate_signal_hold', section: 'Ledger', name: 'Gate signal hold', desc: 'How long a request keeps its “gated” emphasis after the gate changes state.', depth: 3, type: 'range', min: 0, max: 24, step: 1, unit: 'h', def: 4 },
  { id: 'collision_row_hysteresis', section: 'Ledger', name: 'Collision-row hysteresis', desc: 'How close a row’s columns may get before it re-arranges itself — the wait (hysteresis) stops flickering.', depth: 4, type: 'range', min: 0, max: 32, step: 1, unit: 'px', def: 8 },
  { id: 'ledger_archive', section: 'Ledger', name: 'Clean up old R', desc: 'The first click only shows which completed or superseded requests would be archived. A second click moves exactly that list into the archive — nothing is moved without the preview.', depth: 1, type: 'action', def: null },

  { id: 'power_profile', section: 'Performance', name: 'Power profile', desc: 'Trade snappiness against battery and background work.', depth: 1, type: 'seg', options: ['balanced', 'quiet'], def: 'balanced' },
  { id: 'chart_quality', section: 'Performance', name: 'Chart quality', desc: 'How finely charts are drawn. High looks sharper and uses more battery.', depth: 1, type: 'seg', options: ['standard', 'high'], def: 'standard' },
  { id: 'background_updates', section: 'Performance', name: 'Background updates', desc: 'Let pages you are not looking at keep their demonstration data ticking.', depth: 1, type: 'toggle', def: true },
  { id: 'graph_frame_cap', section: 'Performance', name: 'Graph frame cap', desc: 'Cap how many frames per second the agent map animates at.', depth: 2, type: 'select', options: [['30', '30 fps'], ['60', '60 fps'], ['auto', 'Adaptive']], def: 'auto' },
  { id: 'data_history', section: 'Performance', name: 'In-memory history', desc: 'How many minutes of demonstration samples the open charts keep in memory.', depth: 2, type: 'range', min: 5, max: 120, step: 5, unit: 'min', def: 30 },
  { id: 'reflow_debounce', section: 'Performance', name: 'Reflow debounce', desc: 'How long the layout waits during rapid window resizing before refitting itself.', depth: 3, type: 'stepper', min: 0, max: 240, step: 10, unit: 'ms', def: 40 },
  { id: 'layer_promotion_threshold', section: 'Performance', name: 'Layer-promotion threshold', desc: 'How many moving things it takes before a panel gets its own graphics layer (a rendering optimization).', depth: 4, type: 'stepper', min: 1, max: 64, step: 1, unit: 'nodes', def: 12 },

  { id: 'scenario_tick_rate', section: 'Data & Sim', name: 'Demonstration speed', desc: 'How fast the demonstration fleet generates new activity (its scenario tick rate).', depth: 1, type: 'range', min: 30, max: 300, step: 5, unit: '%', def: 100 },
  { id: 'seed_mode', section: 'Data & Sim', name: 'Seed mode', desc: 'Whether the demonstration replays the same history every time (stable) or varies it (varied).', depth: 1, type: 'seg', options: ['stable', 'varied'], def: 'stable' },
  { id: 'retain_samples', section: 'Data & Sim', name: 'Retain samples on navigation', desc: 'Keep a page’s demonstration data when you navigate away and come back.', depth: 1, type: 'toggle', def: true },
  /* 'offline_fallback' was removed 2026-08-13 rather than left as a row: it was
     declared here and read by NOTHING in the tree, so the toggle moved and
     changed no behavior — a control that looks real and is not, the exact
     defect class the owner has ruled on ("a user setting needs registry,
     enforcement, and a control, or it's a lie"). If a demonstration fallback
     for unreadable live data is ever wanted, it gets built first and its row
     returns with a reader. */
  ...LIVE_VIEW_FLAGS.map(flag => ({
    id: `live_${flag.id}`,
    section: 'Data & Sim',
    name: `${flag.label} live data`,
    desc: `Show your computer’s own records on this page (read from ${flag.domain}.json). Turn off to see the labelled demonstration instead.`,
    depth: 1,
    type: 'toggle',
    def: true,
  })),
  { id: 'event_variance', section: 'Data & Sim', name: 'Event variance', desc: 'How bursty the demonstration workload looks: steady, or arriving in waves.', depth: 2, type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 35 },
  /* "Synthetic failure rate" was a name written from inside the code. Nothing a
     person owns is synthetic, and the row is about the built-in example. */
  { id: 'failure_rate', section: 'Data & Sim', name: 'Practice problems', desc: 'How often the demonstration shows a problem it recovers from, as a percentage. It is there so the screens have something to show.', depth: 2, type: 'range', min: 0, max: 20, step: 1, unit: '%', def: 3 },
  { id: 'sample_bucket', section: 'Data & Sim', name: 'Sample bucket width', desc: 'How many seconds of raw demonstration ticks are grouped into one chart point.', depth: 3, type: 'stepper', min: 1, max: 60, step: 1, unit: 's', def: 5 },
  { id: 'sim_worker_tick_bias', section: 'Data & Sim', name: 'Sim worker tick bias', desc: 'Whether the demonstration favors the freshest data or does more work per batch.', depth: 4, type: 'range', min: -100, max: 100, step: 5, unit: '%', def: 0 },

  ...WRITE_ACTION_FLAGS.map(flag => ({
    id: `write_${flag.id}`,
    section: 'Write',
    name: flag.label,
    desc: `${flag.description} This ships switched off; nothing acts until you turn it on.`,
    depth: ['dispatch', 'report-read'].includes(flag.id) ? 1 : 2,
    type: 'toggle',
    def: false,
  })),

  { id: 'diagnostic_labels', section: 'Developer', name: 'Diagnostic labels', desc: 'Show small internal component names beside live surfaces, useful for reporting a problem precisely.', depth: 1, type: 'toggle', def: false },
  { id: 'log_level', section: 'Developer', name: 'Console detail', desc: 'How much diagnostic detail the demonstration writes to the console.', depth: 1, type: 'seg', options: ['quiet', 'normal', 'verbose'], def: 'normal' },
  { id: 'copy_ids', section: 'Developer', name: 'Copy stable identifiers', desc: 'When you copy a row, agent, or channel, copy its permanent ID rather than its display name.', depth: 1, type: 'toggle', def: true },
  { id: 'expose_timings', section: 'Developer', name: 'Expose render timings', desc: 'Show how long each screen took to draw, in development-only readouts.', depth: 2, type: 'toggle', def: false },
  { id: 'mock_failures', section: 'Developer', name: 'Show practice problems', desc: 'Let a pretend problem appear on a screen that is actually healthy, so you can see what this program does when something goes wrong.', depth: 2, type: 'toggle', def: false },
  { id: 'observer_budget', section: 'Developer', name: 'Observer callback budget', desc: 'The soft time limit for one internal resize or layout callback, in milliseconds.', depth: 3, type: 'stepper', min: 1, max: 24, step: 1, unit: 'ms', def: 8 },
  { id: 'tier_guide_hairline_alpha', section: 'Developer', name: 'Tier-guide hairline alpha', desc: 'How faint the thin guide lines between the map’s levels are (their alpha).', depth: 4, type: 'range', min: 1, max: 20, step: 1, unit: '%', def: 7 },
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
  /* Like theme: the applied state on the root element is the truth, not a
     stored copy (src/font-choice.js reads the inline --font-ui property). */
  if (setting.id === 'ui_font') return currentFontChoice()
  if (setting.id === 'text_size') {
    const zoom = parseFloat(document.body.style.zoom)
    return zoom === 0.9 || zoom === 1.12 ? String(zoom) : '1'
  }
  if (setting.id === 'glow') {
    /* The applied value lives on the root element; the drawer's slider is a
       COPY of it and only exists once the drawer has rendered (it is built
       per page since R1520), so the variable is the source and the slider
       only a fallback. */
    const applied = parseFloat(document.documentElement.style.getPropertyValue('--glow'))
    if (Number.isFinite(applied)) return Math.round(applied * 100)
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
    /* The font row's options preview themselves: each button is set in the
       stack it would apply (R1523). Other segs carry no per-option style. */
    const optionStyle = option => setting.id === 'ui_font'
      ? ` style="font-family:${escapeHtml(fontStack(option.value))}"`
      : ''
    return `<div class="seg settings-seg" role="group" aria-labelledby="${labelId}">
      ${optionRecords(setting).map(option => `<button type="button" data-setting-value="${escapeHtml(option.value)}"${optionStyle(option)} aria-pressed="${sameValue(option.value, value)}" class="${sameValue(option.value, value) ? 'on' : ''}">${escapeHtml(option.label)}</button>`).join('')}
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

function searchHaystack(setting) {
  const guidance = describeSubject(setting.id, { section: setting.section })
  return [
    setting.name, setting.desc, setting.section,
    guidance.whatItDoes, ...guidance.capabilities, ...guidance.risks, guidance.absenceNote,
  ].join(' ').toLowerCase()
}

function rowMarkup(setting, searchResult = false) {
  return `<article class="settings-row ${setting.depth === 4 ? 'is-engineer' : ''}" data-setting-id="${setting.id}">
    <div class="settings-copy">
      ${searchResult ? `<div class="settings-prefix">${escapeHtml(setting.section)} · depth ${setting.depth}</div>` : ''}
      <div class="settings-name" id="setting-label-${setting.id}">${escapeHtml(setting.name)}</div>
      <div class="settings-desc" data-setting-message>${escapeHtml(setting.desc)}</div>
      ${guidanceMarkup(setting.id, { section: setting.section, probe })}
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

/* A sentence under a section title, for the two sections whose switches a person
   arrives at with the wrong question. Data, not markup in the render, so the
   words are visible in one place and a third section can be added without
   touching the renderer. A section with no note gets no element at all rather
   than an empty one. */
const SECTION_NOTES = Object.freeze({
  'Data & Sim': Object.freeze({
    text: 'These switches choose between the live reading and a worked example, one screen at a time. They do not connect anything. On a fresh install the live readings are empty, because nothing has reported to this copy yet, and no switch on this page changes that.',
    link: Object.freeze({ label: 'What this copy needs', href: GUIDE_HREF }),
  }),
  Write: Object.freeze({
    text: 'Every action that writes anything ships switched off, so a copy nobody has configured cannot send, start or approve anything by accident. Turning one on here is what makes its control appear.',
    link: Object.freeze({ label: 'What this copy needs', href: GUIDE_HREF }),
  }),
})

function sectionNoteMarkup(section) {
  const note = SECTION_NOTES[section]
  if (!note) return ''
  return `<p class="settings-section-note host-absent-body" data-section-note="${escapeHtml(section)}">${escapeHtml(note.text)}
    <a class="host-absent-action" href="${escapeHtml(note.link.href)}">${escapeHtml(note.link.label)}</a></p>`
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
    ${sectionNoteMarkup(section)}
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

/**
 * The one row a link asked for, or null.
 *
 * A LINK MAY NAME A SWITCH, AND ONLY A SWITCH THIS PAGE HAS. The id arrives off
 * the address bar, so it is looked up in this page's own table and anything
 * else is ignored -- an unknown id lands the person at the top of Settings,
 * which is exactly where they landed before this existed, rather than throwing
 * an error at somebody who followed a link.
 */
function requestedSetting(query) {
  const id = query && typeof query.get === 'function' ? query.get('setting') : null
  if (typeof id !== 'string' || id.length === 0) return null
  return byId.get(id) || null
}

/* NOT NAMED `query`: this view already has a local `query` holding what is
   typed in the search box, and a parameter of the same name is a redeclaration
   the module would not even parse. */
export function settingsView({ query: routeQuery = null } = {}) {
  const landing = requestedSetting(routeQuery)
  const profileController = createFleetProfileSettings()
  const setupController = createSetupProfileSettings()
  const chatboxController = createChatboxSettings()
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
    chatboxController.afterRender(root)
  }

  function updateFooter() {
    footer.textContent = `${SETTINGS.length + FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT + CHATBOX_SETTING_COUNT} settings · ${shown} shown · search finds the hidden ones too`
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
    if (section === CHATBOX_SECTION) return chatboxController.markup()
    if (section === 'System') return profileController.markup()
    if (section === 'Setup') return setupController.markup()
    return sectionMarkup(section, levels.get(section))
  }

  function renderSectioned() {
    sectionsNode.innerHTML = SECTIONS.map(sectionNodeMarkup).join('')
    shown = FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT + CHATBOX_SETTING_COUNT
      + SETTINGS.filter(setting => setting.depth <= levels.get(setting.section)).length
    // `inert` is the primary guard; the explicit tabindex pass keeps closed
    // tiers unreachable in older engines while preserving the CSS reveal.
    for (const section of SECTIONS) syncSectionDepth(section)
    wireControls()
    updateFooter()
    syncRail()
    markLanding()
  }

  function renderSearch() {
    const normalized = query.trim().toLowerCase()
    /* The capabilities and risks are searched too. A person who types "risk" is
       asking the one question this lane exists to answer, and a search that
       matched only the row's own name would send them away empty from a page
       that has the answer on every row. */
    const matches = SETTINGS.filter(setting => searchHaystack(setting).includes(normalized))
    const profileMatches = profileController.matches(normalized)
    const setupMatches = setupController.matches(normalized)
    const chatboxMatches = chatboxController.matches(normalized)
    sectionsNode.innerHTML = `<section class="settings-results">
      <h2 class="settings-section-title">Results</h2>
      ${chatboxMatches ? chatboxController.markup({ searchResult: true }) : ''}
      ${profileMatches ? profileController.markup({ searchResult: true }) : ''}
      ${setupMatches ? setupController.markup({ searchResult: true }) : ''}
      ${matches.map(setting => rowMarkup(setting, true)).join('')}
      ${profileMatches || setupMatches || chatboxMatches || matches.length ? '' : '<p class="settings-empty">No settings match this search.</p>'}
    </section>`
    shown = matches.length
      + (profileMatches ? FLEET_PROFILE_SETTING_COUNT : 0)
      + (setupMatches ? SETUP_PROFILE_SETTING_COUNT : 0)
      + (chatboxMatches ? CHATBOX_SETTING_COUNT : 0)
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
    } else if (setting.id === 'ui_font') {
      value = applyFontChoice(normalizeFontId(String(value)))
      try { localStorage.setItem(FONT_STORAGE_KEY, value) } catch {}
      setDrawerSegment('#font-seg', 'font', value)
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
    } else if (setting.id === 'scenario_tick_rate') {
      /* This row is live: it drives the sim clock the way the drawer's pace
         slider used to (R1520 moved that slider out of the drawer and here),
         and unlike that slider the choice persists — applyStoredSimPace()
         re-applies it at launch. */
      const number = clampNumber(setting, value)
      sim.setPace(number / 100)
      writeStored(setting, number)
      value = number
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
    shown = FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT + CHATBOX_SETTING_COUNT
      + SETTINGS.filter(setting => setting.depth <= levels.get(setting.section)).length
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

  /* The row a link named, marked so the eye finds it. Re-applied on every
     render rather than only on the first, because the capability probes answer
     a second or two after this page paints and re-render it -- without this the
     mark a person was following vanished under them. */
  function markLanding() {
    if (!landing) return
    const row = sectionsNode.querySelector(`[data-setting-id="${landing.id}"]`)
    if (row) row.classList.add('is-landed')
  }

  /* INSTANT, NOT SMOOTH, and that is a decision rather than an oversight. The
     row this lands on measured 10170px down the page; a smooth scroll over that
     distance is a long animated journey past two hundred controls, which reads
     as the page running away from the person who followed the link. Arriving is
     what was asked for. */
  function scrollToLanding() {
    if (!landing) return
    requestAnimationFrame(() => {
      const row = sectionsNode.querySelector(`[data-setting-id="${landing.id}"]`)
      if (!row) return
      row.scrollIntoView({ behavior: 'auto', block: 'center' })
      /* Focus goes to the CONTROL, so somebody who followed the link with the
         keyboard arrives on the switch itself and can press space. preventScroll
         because the line above is what decides where the page sits; letting
         focus scroll as well moves the row off centre again. */
      const control = row.querySelector('input, select, button')
      control?.focus?.({ preventScroll: true })
    })
  }

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

  /* The drawer's controls used to be static nodes this view could bind to by
     id; since R1520 the drawer is rebuilt per page at every open, so a node
     bound here would be a dead reference after the next open. The drawer
     announces every applied value instead (src/quick-settings.js), and this
     page re-syncs its copy of that control. */
  const onQuickSetting = (event) => {
    const id = event?.detail?.settingId
    if (id && byId.has(id)) syncSetting(id)
  }
  window.addEventListener(QUICK_SETTING_EVENT, onQuickSetting)

  /* The guided steps say whether the outside thing a setting depends on was
     actually found. Asking costs a round trip, so the page paints first with
     the honest "this copy could not check" and repaints once when the answer
     arrives. Painting a cheerful default while waiting would be the same defect
     in a different coat: a claim about a computer nobody has looked at yet. */
  const onCapabilityProbes = () => { renderCurrent() }
  window.addEventListener(CAPABILITY_PROBE_EVENT, onCapabilityProbes)

  profileController.bind(root)
  /* MEASURED, NOT ASSUMED: neither of these two was bound. `createSetupProfileSettings`
     builds its own click handler and only `bind` attaches it, so every control
     in Settings -> Setup -- the permission level, the working folder, the four
     recorded intents -- rendered, looked live, and did nothing when clicked.
     The seg indicator moved because attachSeg() runs over every `.settings-seg`
     on the page, which is exactly what made it look like it had worked. */
  setupController.bind(root)
  chatboxController.bind(root)

  /* LANDING ON THE SWITCH A LINK NAMED, and the reason this is more than a
     scroll.
     MEASURED on the packaged build, following "Turn on agent sessions in
     Settings" from the home screen with a real mouse press: the row it means
     (write_agent-session, "Run an agent session") sat at y=10170 in a 946px
     viewport AND inside a collapsed depth-2 tier carrying `inert`. So it was
     not merely below the fold -- no amount of scrolling reached it, because the
     tier it lives in renders closed and `inert` removes it from hit testing and
     from the tab order. A person who followed that link had to know to open the
     "Write" section's reveal first, which is the one thing the link did not
     say.
     So the section is opened to the depth the row lives at BEFORE the first
     render, which is what makes the row exist un-inert at all, and the scroll
     happens after. Both halves are required; either alone leaves the link
     landing somewhere the control is not. */
  if (landing) {
    activeSection = landing.section
    levels.set(landing.section, Math.max(levels.get(landing.section) || 1, landing.depth))
  }
  renderSectioned()
  if (landing) scrollToLanding()
  void refreshCapabilityProbes()

  return {
    el: root,
    destroy() {
      cleanupControls()
      archiveController.destroy()
      profileController.destroy()
      setupController.destroy()
      chatboxController.destroy()
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      window.removeEventListener(QUICK_SETTING_EVENT, onQuickSetting)
      window.removeEventListener(CAPABILITY_PROBE_EVENT, onCapabilityProbes)
    },
  }
}

/* SIMULATION PACE, THE BOOT HALF. The pace control lives in this page's
   Data & Sim section (scenario_tick_rate) since R1520 retired the drawer's
   per-session slider; the choice is stored like every other row here, and
   main.js calls this at launch so the sim clock actually runs at it. */
export function applyStoredSimPace() {
  const setting = byId.get('scenario_tick_rate')
  if (setting) sim.setPace(Number(readStored(setting)) / 100)
}
