import '../chat-view.css'

const BRIDGE_MISSING = 'No agent bridge — this surface is not connected.'

const eventName = (event) => {
  const candidate = typeof event?.type === 'string'
    ? event.type
    : typeof event?.event === 'string'
      ? event.event
      : ''
  return candidate.toLowerCase().replace(/[._:\s]+/g, '-')
}

const eventData = (event) => {
  if (!event || typeof event !== 'object') return {}
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : event
  if (!detail.event || typeof detail.event !== 'object') return detail

  const engineEvent = detail.event
  const transportSessionId = detail.sessionId || detail.session_id
  if (transportSessionId && !engineEvent.sessionId && !engineEvent.session_id) {
    return { ...engineEvent, sessionId: transportSessionId }
  }
  return engineEvent
}

const textFrom = (value) => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (typeof value.delta === 'string') return value.delta
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (typeof value.message?.content === 'string') return value.message.content
  if (Array.isArray(value.message?.content)) {
    return value.message.content
      .map((part) => typeof part === 'string' ? part : part?.text || '')
      .join('')
  }
  if (value.data && value.data !== value) return textFrom(value.data)
  return ''
}

export function chatView() {
  const root = document.createElement('main')
  root.className = 'agent-chat-view'
  root.innerHTML = `
    <header class="agent-chat-head">
      <div>
        <p class="agent-chat-kicker">NATIVE AGENT</p>
        <h1>Chat</h1>
      </div>
      <div class="agent-chat-connection" data-state="connecting" aria-live="polite">
        <span class="agent-chat-state-dot" aria-hidden="true"></span>
        <span>
          <strong class="agent-chat-state-label">Connecting</strong>
          <small class="agent-chat-state-detail">Looking for the agent bridge…</small>
        </span>
      </div>
    </header>

    <section class="agent-chat-panel" aria-label="Agent conversation">
      <div class="agent-chat-log" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="false"></div>
      <div class="agent-chat-thinking" role="status" hidden>
        <span class="agent-chat-thinking-mark" aria-hidden="true"></span>
        Agent is responding
      </div>
      <form class="agent-chat-composer">
        <label class="agent-chat-composer-label" for="agent-chat-input">Message the agent</label>
        <div class="agent-chat-compose-row">
          <textarea id="agent-chat-input" rows="1" placeholder="Ask Codex or Claude…" disabled></textarea>
          <button type="submit" disabled aria-label="Send message">Send</button>
        </div>
        <p class="agent-chat-hint">Enter to send · Shift+Enter for a new line</p>
      </form>
    </section>
  `

  const log = root.querySelector('.agent-chat-log')
  const connection = root.querySelector('.agent-chat-connection')
  const stateLabel = root.querySelector('.agent-chat-state-label')
  const stateDetail = root.querySelector('.agent-chat-state-detail')
  const thinking = root.querySelector('.agent-chat-thinking')
  const form = root.querySelector('.agent-chat-composer')
  const input = root.querySelector('textarea')
  const sendButton = root.querySelector('button[type="submit"]')

  let disposed = false
  let connected = false
  let streaming = false
  let inFlight = null
  let sessionId = null
  let unsubscribe = null
  let scrollFrame = 0

  const bridge = window.mcAgent
  const hasBridge = !!bridge
    && typeof bridge.start === 'function'
    && typeof bridge.send === 'function'
    && typeof bridge.onEvent === 'function'

  function pinToReply() {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight
    })
  }

  function setConnection(state, label, detail) {
    connection.dataset.state = state
    stateLabel.textContent = label
    stateDetail.textContent = detail
  }

  function syncComposer() {
    const disabled = !connected || streaming
    input.disabled = disabled
    sendButton.disabled = disabled || !input.value.trim()
  }

  function setStreaming(active) {
    streaming = active
    log.setAttribute('aria-busy', active ? 'true' : 'false')
    thinking.hidden = !active
    syncComposer()
    if (active) pinToReply()
  }

  function addNotice(text, tone = 'neutral') {
    const notice = document.createElement('p')
    notice.className = 'agent-chat-notice'
    notice.dataset.tone = tone
    notice.textContent = text
    log.appendChild(notice)
    pinToReply()
    return notice
  }

  function addMessage(role, text = '') {
    const article = document.createElement('article')
    article.className = `agent-chat-message is-${role}`
    article.dataset.role = role

    const meta = document.createElement('p')
    meta.className = 'agent-chat-message-meta'
    meta.textContent = role === 'user' ? 'YOU' : 'AGENT'

    const body = document.createElement('div')
    body.className = 'agent-chat-message-body'
    body.textContent = text

    article.append(meta, body)
    log.appendChild(article)
    pinToReply()
    return { article, body }
  }

  function beginAssistantMessage(messageId = null) {
    if (inFlight) return inFlight
    const message = addMessage('assistant')
    inFlight = { ...message, id: messageId }
    setStreaming(true)
    return inFlight
  }

  // Deliberate streaming entry point: live bridge deltas grow one stable DOM
  // message instead of repeatedly replacing a completed response.
  function appendAssistantDelta(delta, messageId = null) {
    if (disposed || typeof delta !== 'string' || !delta) return
    if (inFlight && messageId && inFlight.id && inFlight.id !== messageId) {
      finishAssistantMessage()
    }
    const message = beginAssistantMessage(messageId)
    if (messageId && !message.id) message.id = messageId
    message.body.append(document.createTextNode(delta))
    pinToReply()
  }

  function setAssistantText(text, messageId = null) {
    if (disposed || typeof text !== 'string') return
    if (inFlight && messageId && inFlight.id && inFlight.id !== messageId) {
      finishAssistantMessage()
    }
    const message = beginAssistantMessage(messageId)
    if (messageId && !message.id) message.id = messageId
    message.body.textContent = text
    pinToReply()
  }

  function finishAssistantMessage(finalText = '') {
    if (finalText) {
      const message = beginAssistantMessage()
      message.body.textContent = finalText
    }
    if (inFlight && !inFlight.body.textContent) inFlight.article.remove()
    inFlight = null
    setStreaming(false)
  }

  function failReply(message) {
    if (inFlight && !inFlight.body.textContent) inFlight.article.remove()
    inFlight = null
    setStreaming(false)
    addNotice(message || 'The agent bridge reported an error.', 'error')
  }

  function applySession(value) {
    const id = value?.sessionId || value?.session_id || value?.id
    if (id) sessionId = id
    connected = true
    setConnection('connected', 'Connected', sessionId ? `Session ${sessionId}` : 'Agent bridge ready')
    syncComposer()
  }

  function handleBridgeEvent(rawEvent) {
    if (disposed) return
    const event = eventData(rawEvent)
    const type = eventName(event)
    const messageId = event.messageId || event.message_id || event.itemId || event.item_id || event.id || event.data?.messageId || null

    if (type.includes('error') || type.includes('failed')) {
      failReply(textFrom(event) || event.message || 'The agent bridge reported an error.')
      return
    }

    if (type.includes('session') && (type.includes('start') || type.includes('ready') || type.includes('connect'))) {
      applySession(event.data || event)
      return
    }

    if (type.includes('disconnect') || type === 'closed') {
      connected = false
      finishAssistantMessage()
      setConnection('disconnected', 'Disconnected', 'The agent bridge closed the session.')
      syncComposer()
      return
    }

    if (type === 'assistant-text-delta') {
      appendAssistantDelta(textFrom(event), messageId)
      return
    }

    if (type === 'assistant-text') {
      setAssistantText(textFrom(event), messageId)
      return
    }

    if (type === 'turn-completed') {
      const status = typeof event.status === 'string' ? event.status : event.data?.status
      if (status === 'completed') {
        finishAssistantMessage()
      } else {
        const detail = typeof event.message === 'string'
          ? event.message
          : `The agent turn ended with status: ${status || 'unknown'}.`
        failReply(detail)
      }
      return
    }

    if (type === 'usage' || type === 'tool-call' || type === 'tool-result') return

    if (type === 'approval-request') {
      addNotice('The agent is waiting for approval before it can continue.')
      return
    }

    if (type.includes('delta')) {
      appendAssistantDelta(textFrom(event), messageId)
      return
    }

    if ((type.includes('assistant') || event.role === 'assistant') && type.includes('start')) {
      beginAssistantMessage(messageId)
      return
    }

    if (type.includes('done') || type.includes('complete') || type.includes('finish') || type === 'end') {
      finishAssistantMessage()
      return
    }

    if ((type === 'message' || type.includes('assistant-message')) && (event.role === 'assistant' || event.message?.role === 'assistant' || type.includes('assistant'))) {
      finishAssistantMessage(textFrom(event))
      return
    }

    if (type.includes('status')) {
      const label = event.label || event.status || 'Connected'
      setConnection('connected', String(label), event.detail || event.message || 'Agent bridge ready')
    }
  }

  async function startBridge() {
    if (!hasBridge) {
      connected = false
      setConnection('disconnected', 'Disconnected', BRIDGE_MISSING)
      addNotice(BRIDGE_MISSING, 'disconnected')
      syncComposer()
      return
    }

    try {
      const off = bridge.onEvent(handleBridgeEvent)
      if (typeof off === 'function') unsubscribe = off
      const result = await bridge.start({ surface: 'chat' })
      if (!disposed) applySession(result || {})
    } catch (error) {
      if (disposed) return
      connected = false
      setConnection('disconnected', 'Disconnected', 'The agent bridge could not start a session.')
      addNotice(error?.message || 'The agent bridge could not start a session.', 'error')
      syncComposer()
    }
  }

  async function sendMessage(text) {
    addMessage('user', text)
    beginAssistantMessage()
    try {
      await bridge.send({ text, sessionId })
    } catch (error) {
      if (!disposed) failReply(error?.message || 'The message could not be sent.')
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text || !connected || streaming) return
    input.value = ''
    input.style.height = ''
    syncComposer()
    sendMessage(text)
  })

  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`
    syncComposer()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    form.requestSubmit()
  })

  startBridge()

  return {
    el: root,
    appendAssistantDelta,
    destroy() {
      disposed = true
      cancelAnimationFrame(scrollFrame)
      if (typeof unsubscribe === 'function') unsubscribe()
    },
  }
}
