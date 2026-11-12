// dsh-incognito — browser half.
//
// Registers two slots:
//   conversation.input.left     → the glasses button beside the composer plus
//   conversation.composer.bar   → a priority -1 single entry that shadows the
//                                 stock composer while incognito is open
//
// The floating window is mounted in its own React root under document.body so
// it survives session switches and composer remounts. Nothing here writes to
// localStorage, session storage, IndexedDB, or the resident session.

;(function () {
  'use strict'

  var PLUGIN = 'dsh-incognito'
  var API = '/api/dsh-incognito'
  var CSS_ID = PLUGIN + '.css'
  var FADE_MS = 5000

  window.__ModuleLoader__.load({
    id: PLUGIN,
    factory: function (require) {
      var React = require('react')
      var ReactDOMClient = require('react-dom/client')
      var h = React.createElement
      var module = { exports: {} }
      var exports = module.exports

      // ── styles ─────────────────────────────────────────────────────────
      var css = [
        '.dsh-incog-overlay-root{display:contents}',
        'button.dsh-incog-entry{width:28px;height:28px;min-height:0;flex:none;display:grid;place-items:center;order:-1;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s}',
        '.dsh-incog-entry:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#8882);color:#b9a8ff}',
        '.dsh-incog-entry:disabled{opacity:.4;cursor:not-allowed}',
        '.dsh-incog-window{position:fixed;z-index:100000;display:flex;flex-direction:column;width:min(400px,calc(100vw - 32px));height:min(620px,calc(100vh - 80px));min-height:300px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#ffffff24);border-radius:20px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#111) 92%,transparent);box-shadow:0 24px 70px #0009,0 0 0 1px #7c5cff22 inset;color:var(--dsw-alias-label-primary,#eee);font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:var(--dsh-content-font-size,14px);line-height:1.5;backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);opacity:1;transform:translateZ(0) scale(1);transition:opacity .16s ease,transform .16s ease}',
        '.dsh-incog-window[data-phase=closing]{opacity:0;transform:scale(.985);transition:opacity 5s linear,transform 5s ease}.dsh-incog-window[data-finalizing=true]{pointer-events:none}',
        '.dsh-incog-window[data-phase=opening]{opacity:.95}',
        '.dsh-incog-head{flex:none;display:flex;align-items:center;gap:10px;padding:13px 14px 11px;border-bottom:1px solid var(--dsw-alias-border-l1,#ffffff14);cursor:move;touch-action:none;user-select:none;background:linear-gradient(180deg,#7c5cff12,transparent)}',
        '.dsh-incog-logo{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:10px;color:#c4b5ff;background:linear-gradient(145deg,#7c5cff33,#39d0ff1a);border:1px solid #7c5cff44}',
        '.dsh-incog-headtext{min-width:0;flex:1}',
        '.dsh-incog-title{font-size:13px;font-weight:700;letter-spacing:.02em;display:flex;align-items:center;gap:6px}',
        '.dsh-incog-title-badge{font-size:9px;font-weight:700;letter-spacing:.08em;padding:1px 5px;border-radius:999px;background:#7c5cff26;color:#c4b5ff;border:1px solid #7c5cff33}',
        '.dsh-incog-sub{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-incog-close{flex:none;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);cursor:pointer;font-size:18px;line-height:1;display:grid;place-items:center}',
        '.dsh-incog-close:hover{background:#ff6b6b22;color:#ff8989}',
        '.dsh-incog-close:disabled{opacity:.35;cursor:not-allowed}',
        '.dsh-incog-closing{flex:none;padding:7px 14px;font-size:12px;color:#ffd28a;background:#ffb02014;border-bottom:1px solid #ffb02024;display:flex;align-items:center;gap:7px}',
        '.dsh-incog-closing-dot{width:6px;height:6px;border-radius:50%;background:#ffb020;box-shadow:0 0 8px #ffb020cc;animation:dsh-incog-pulse 1s infinite}',
        '@keyframes dsh-incog-pulse{50%{opacity:.25}}',
        '.dsh-incog-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow-y:auto;padding:16px;scrollbar-width:thin}',
        '.dsh-incog-empty{margin:auto;max-width:340px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:12.5px;line-height:1.65}',
        '.dsh-incog-empty-icon{width:44px;height:44px;margin:0 auto 12px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(145deg,#7c5cff26,#39d0ff14);color:#c4b5ff;border:1px solid #7c5cff33}',
        '.dsh-incog-empty-title{display:block;margin-bottom:4px;color:var(--dsw-alias-label-primary,#eee);font-size:14px;font-weight:650}',
        '.dsh-incog-msg{display:flex;flex-direction:column;max-width:100%}',
        '.dsh-incog-msg-user{align-items:flex-end}',
        '.dsh-incog-msg-assistant{align-items:flex-start}',
        '.dsh-incog-bubble{max-width:88%;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;padding:9px 12px;border-radius:14px;font-size:13px;line-height:1.6}',
        '.dsh-incog-msg-user .dsh-incog-bubble{background:#4b3dbe;color:#fff;border-bottom-right-radius:5px;box-shadow:0 2px 10px #4b3dbe33}',
        '.dsh-incog-msg-assistant .dsh-incog-bubble{background:var(--dsw-alias-interactive-bg-hover,#ffffff0d);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l1,#ffffff12);border-bottom-left-radius:5px}',
        '.dsh-incog-msg-error .dsh-incog-bubble{color:#ff9b9b;background:#ff5c5c14;border-color:#ff5c5c2e}',
        '.dsh-incog-role{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#888);margin:0 4px 4px}',
        '.dsh-incog-caret{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:#b9a8ff;animation:dsh-incog-caret .8s steps(2) infinite}',
        '@keyframes dsh-incog-caret{50%{opacity:0}}',
        '.dsh-incog-activity{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:7px 11px;border-radius:999px;background:#7c5cff14;border:1px solid #7c5cff26;color:#b9a8ff;font-size:12px}',
        '.dsh-incog-activity-dot{width:6px;height:6px;border-radius:50%;background:#b9a8ff;animation:dsh-incog-pulse .9s infinite}',
        '.dsh-incog-error{font-size:12px;line-height:1.55;color:#ff9b9b;background:#ff5c5c12;border:1px solid #ff5c5c28;border-radius:10px;padding:8px 10px;white-space:pre-wrap;word-break:break-word}',
        '.dsh-incog-foot{flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid var(--dsw-alias-border-l1,#ffffff14);color:var(--dsw-alias-label-tertiary,#888);font-size:10.5px;letter-spacing:.02em;white-space:nowrap}',
        '.dsh-incog-foot-dot{width:5px;height:5px;border-radius:50%;background:#69d99b;box-shadow:0 0 6px #69d99b88}',
        '.dsh-incog-foot-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-incog-foot-spacer{flex:1}.dsh-incog-foot-side{flex:none;white-space:nowrap}',
        '.dsh-incog-foot-live{color:#b9a8ff}',
        '.dsh-incog-progress{flex:none;height:2px;background:#ffffff0d;overflow:hidden}',
        '.dsh-incog-progress span{display:block;height:100%;width:100%;background:linear-gradient(90deg,#7c5cff,#39d0ff);transform-origin:left;animation:dsh-incog-drain 5s linear forwards}',
        '@keyframes dsh-incog-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}',
        /* incognito composer bar that shadows the stock bar */
        '.dsh-incog-bar{width:100%;max-width:var(--dsh-composer-card-max-width);margin:0 auto;padding:0 var(--dsh-composer-side-clearance) 8px;display:flex;flex-direction:column;align-items:center;font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:var(--dsh-content-font-size,14px);line-height:1.5}',
        '.dsh-incog-bar-badge{display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px;color:#c4b5ff;background:#7c5cff16;border:1px solid #7c5cff2e;border-radius:999px;padding:2px 10px;margin-bottom:6px}',
        '.dsh-incog-bar-badge-dot{width:5px;height:5px;border-radius:50%;background:#b9a8ff;box-shadow:0 0 6px #b9a8ffaa}',
        '.dsh-incog-card{width:100%;box-sizing:border-box;border:1px solid #7c5cff3d;background:var(--dsw-specific-input-major,#1b1b22);box-shadow:0 8px 30px #0004,0 0 0 1px #7c5cff12 inset;border-radius:20px;padding:10px 12px 9px;display:flex;flex-direction:column;gap:6px}',
        '.dsh-incog-card[data-busy=true]{border-color:#7c5cff22}',
        '.dsh-incog-card textarea{resize:none;width:100%;box-sizing:border-box;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary,#eee);font:inherit;font-size:15px;line-height:22px;padding:3px 8px;min-height:44px;max-height:140px}',
        '.dsh-incog-card textarea::placeholder{color:var(--dsw-alias-label-caption,#777)}',
        '.dsh-incog-card textarea:disabled{opacity:.55;cursor:not-allowed}',
        '.dsh-incog-actions{display:flex;justify-content:space-between;align-items:center;gap:8px}',
        '.dsh-incog-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-incog-send{flex:none;width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:999px;background:#6a55e8;color:#fff;cursor:pointer}',
        '.dsh-incog-send:hover:not(:disabled){background:#7a65f2}',
        '.dsh-incog-send:disabled{opacity:.35;cursor:default}',
        '.dsh-incog-bar-enter{display:inline-flex;align-items:center;gap:5px}',
      ].join('')

      function injectStyle() {
        if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return
        var tag = document.createElement('style')
        tag.dataset.plugin = PLUGIN
        tag.dataset.pluginCss = CSS_ID
        tag.textContent = css
        document.head.appendChild(tag)
      }

      // ── tiny module store ──────────────────────────────────────────────
      var initial = {
        phase: 'idle',
        sessionId: null,
        cwd: null,
        messages: [],
        busy: false,
        live: '',
        activity: null,
        error: null,
        status: { ready: false, checked: false, reason: 'Checking the incognito environment…' },
        closeAt: 0,
        finalizing: false,
      }
      var store = initial
      var listeners = new Set()
      function getSnapshot() { return store }
      function subscribe(fn) {
        listeners.add(fn)
        return function () { listeners.delete(fn) }
      }
      function update(patch) {
        store = Object.assign({}, store, patch)
        listeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }
      function useStore() { return React.useSyncExternalStore(subscribe, getSnapshot) }

      // ── RPC ─────────────────────────────────────────────────────────────
      function rpc(method, payload) {
        return fetch(API + '/' + method, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        }).then(function (res) {
          return res.json().catch(function () { return {} }).then(function (body) {
            if (!res.ok || !body || body.ok !== true) {
              throw new Error((body && body.error && body.error.message) || ('incognito ' + method + ' failed (HTTP ' + res.status + ')'))
            }
            return body.value
          })
        })
      }

      var ctxRef = null
      var pollTimer = null
      var closeTimer = null
      var closeToken = 0
      var overlayEl = null
      var overlayRoot = null
      var entryFiber = null
      var shadowFiber = null

      // ── helpers ─────────────────────────────────────────────────────────
      function shortId(id) {
        if (typeof id !== 'string') return ''
        var tail = id.slice(-8)
        return tail.length > 0 ? tail : id.slice(0, 8)
      }
      function isFloating(phase) {
        return phase === 'opening' || phase === 'active' || phase === 'closing' || phase === 'error'
      }
      function stopPolling() {
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
      }
      function startPolling(sessionId) {
        stopPolling()
        pollTimer = setInterval(function () {
          if (store.sessionId !== sessionId) return
          if (store.phase !== 'active' && store.phase !== 'closing') return
          rpc('poll', { sessionId: sessionId }).then(function (r) {
            if (store.sessionId !== sessionId) return
            var patch = {}
            if (typeof r.live === 'string' && r.live !== store.live) patch.live = r.live
            if (r.activity !== undefined && r.activity !== store.activity) patch.activity = r.activity
            if (typeof r.error === 'string' && r.error !== '') patch.error = r.error
            if (Object.keys(patch).length > 0) update(patch)
          }).catch(function () { /* transient; the send result is authoritative */ })
        }, 180)
      }

      function checkStatus(retry) {
        rpc('status').then(function (s) {
          update({ status: {
            ready: s.ready === true,
            checked: true,
            reason: s.ready === true ? '' : statusReason(s),
            detail: s,
          } })
          if (s.ready !== true) setTimeout(function () { checkStatus(true) }, 2500)
        }).catch(function (e) {
          update({ status: { ready: false, checked: true, reason: 'Incognito service unavailable: ' + e.message } })
          setTimeout(function () { checkStatus(true) }, 2500)
        })
      }
      function statusReason(s) {
        if (s.projectionCache !== 'guarded') return 'The projection cache cannot be guarded; refusing to open to avoid disk traces.'
        if (s.model === undefined) return 'No default model is configured.'
        if (s.writable !== true) return 'The temporary directory is not writable.'
        if (!s.preset || s.preset.ok !== true) return (s.preset && s.preset.message) || 'The incognito preset is unavailable.'
        return 'The incognito environment is not ready.'
      }

      // ── shadow composer ────────────────────────────────────────────────
      function activateShadow() {
        if (shadowFiber !== null || ctxRef === null) return
        shadowFiber = ctxRef.slots.inject('conversation.composer.bar', function () {
          return ctxRef.slots.register({
            name: 'conversation.composer.bar',
            priority: -1,
            registrant: PLUGIN,
          }, IncognitoBar)
        })
      }
      function deactivateShadow() {
        var fiber = shadowFiber
        shadowFiber = null
        if (fiber === null) return Promise.resolve()
        try {
          var result = typeof fiber.dispose === 'function' ? fiber.dispose() : fiber()
          return Promise.resolve(result).catch(function () {})
        } catch (e) {
          return Promise.resolve()
        }
      }

      // ── open / send / close ────────────────────────────────────────────
      function openIncognito() {
        if (store.phase !== 'idle') return
        // Register the shadow first so the first render already has the
        // incognito composer instead of flashing the stock one.
        activateShadow()
        update({
          phase: 'opening',
          sessionId: null,
          cwd: null,
          messages: [],
          busy: true,
          live: '',
          activity: 'Creating the incognito agent…',
          error: null,
          closeAt: 0,
        })
        rpc('open').then(function (r) {
          update({
            phase: 'active',
            sessionId: r.sessionId,
            cwd: r.cwd,
            busy: false,
            activity: null,
          })
        }).catch(function (e) {
          update({ phase: 'error', busy: false, activity: null, error: e.message })
        })
      }

      function appendAssistant(text, error) {
        if (typeof text !== 'string' || text === '') return
        var messages = store.messages.concat([{ role: 'assistant', text: text, error: error === true }])
        update({ messages: messages })
      }

      function sendIncognito(text) {
        if (store.phase !== 'active' || store.busy || !store.sessionId) return
        var sessionId = store.sessionId
        update({
          busy: true,
          live: '',
          activity: 'Thinking…',
          error: null,
          messages: store.messages.concat([{ role: 'user', text: text }]),
        })
        startPolling(sessionId)
        rpc('send', { sessionId: sessionId, text: text }).then(function (r) {
          stopPolling()
          if (store.sessionId !== sessionId) return
          var reply = r && typeof r.reply === 'string' ? r.reply : ''
          var agentError = r && typeof r.error === 'string' && r.error !== '' ? r.error : ''
          if (reply !== '') appendAssistant(reply, false)
          else if (store.live !== '') appendAssistant(store.live, false)
          else if (agentError !== '') appendAssistant('', false)
          if (agentError !== '') {
            update({ error: agentError, busy: false, live: '', activity: null })
          } else if (reply === '' && store.live === '') {
            update({ busy: false, live: '', activity: null, error: 'The model returned no text.' })
          } else {
            update({ busy: false, live: '', activity: null, error: null })
          }
        }).catch(function (e) {
          stopPolling()
          if (store.sessionId !== sessionId) return
          if (store.phase === 'closing' || store.phase === 'idle') return
          var partial = store.live
          if (partial !== '') appendAssistant(partial, false)
          update({ busy: false, live: '', activity: null, error: e.message })
        })
      }

      function requestClose() {
        if (store.phase === 'idle' || store.phase === 'closing') return
        closeToken += 1
        var token = closeToken
        update({ phase: 'closing', closeAt: Date.now() + FADE_MS, finalizing: false, error: store.error })
        closeTimer = setTimeout(function () { finishClose(token) }, FADE_MS)
      }

      function cancelClose() {
        if (store.phase !== 'closing' || store.finalizing === true) return
        // The fade owns a five-second window. A click after it must not
        // resurrect a session whose teardown has already been requested.
        if (Date.now() >= store.closeAt) return
        closeToken += 1
        if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null }
        update({ phase: store.sessionId ? 'active' : 'error', closeAt: 0, finalizing: false })
      }

      function finishClose(token) {
        if (token !== closeToken || store.phase !== 'closing') return
        closeTimer = null
        var sessionId = store.sessionId
        update({ activity: 'Destroying…', finalizing: true })
        var job = sessionId ? rpc('close', { sessionId: sessionId }) : Promise.resolve({ burned: true })
        job.then(function (r) {
          if (token !== closeToken) return
          if (r && Array.isArray(r.residuals) && r.residuals.length > 0) {
            update({
              phase: 'error',
              busy: false,
              activity: null,
              finalizing: false,
              error: 'Disk cleanup did not finish; the window has been restored. Close it again to retry.\n' + r.residuals.join('\n'),
            })
            return
          }
          stopPolling()
          deactivateShadow().then(function () {
            update(Object.assign({}, initial, {
              status: store.status,
              phase: 'idle',
              sessionId: null,
              cwd: null,
              messages: [],
              busy: false,
              live: '',
              activity: null,
              error: null,
              closeAt: 0,
            }))
          })
        }).catch(function (e) {
          if (token !== closeToken) return
          update({ phase: 'error', busy: false, activity: null, finalizing: false, error: 'Destroy failed; the window has been restored: ' + e.message })
        })
      }

      // ── floating window ─────────────────────────────────────────────────
      function GlassesIcon(props) {
        return h('svg', {
          viewBox: '0 0 24 24',
          width: props && props.size ? props.size : 15,
          height: props && props.size ? props.size : 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
          h('circle', { cx: 6, cy: 14.5, r: 3.6 }),
          h('circle', { cx: 18, cy: 14.5, r: 3.6 }),
          h('path', { d: 'M9.6 14.5h4.8M2 14.5l1.3-7.2h3.2M22 14.5l-1.3-7.2h-3.2' }))
      }

      function defaultPosition(width, height) {
        // Keep the whole incognito composer visible: pin the card to the free
        // left gutter instead of covering the centered input card. On a narrow
        // viewport the CSS width already consumes the screen, so the card is
        // effectively a sheet with the composer below it.
        return { x: window.innerWidth < 900 ? 16 : 24, y: 16 }
      }

      function FloatingWindow() {
        var s = useStore()
        var winRef = React.useRef(null)
        var listRef = React.useRef(null)
        var dragRef = React.useRef(null)
        var posState = React.useState(null)
        var pos = posState[0]
        var setPos = posState[1]
        var remainingState = React.useState(0)
        var remaining = remainingState[0]
        var setRemaining = remainingState[1]
        var closing = s.phase === 'closing'

        // Establish a concrete size/position once mounted; CSS still owns the size.
        React.useLayoutEffect(function () {
          if (pos !== null || winRef.current === null) return
          var rect = winRef.current.getBoundingClientRect()
          setPos(defaultPosition(rect.width, rect.height))
        })

        React.useEffect(function () {
          var el = listRef.current
          if (el) el.scrollTop = el.scrollHeight
        })

        React.useEffect(function () {
          if (!closing) { setRemaining(0); return undefined }
          function tick() {
            setRemaining(Math.max(0, Math.ceil((store.closeAt - Date.now()) / 1000)))
          }
          tick()
          var timer = setInterval(tick, 200)
          return function () { clearInterval(timer) }
        }, [closing])

        var onHeaderPointerDown = function (e) {
          if (e.button !== undefined && e.button !== 0) return
          if (e.target && e.target.closest && e.target.closest('[data-no-drag]')) return
          if (winRef.current === null) return
          var rect = winRef.current.getBoundingClientRect()
          dragRef.current = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            baseX: rect.left,
            baseY: rect.top,
            width: rect.width,
            height: rect.height,
            moved: false,
          }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
        }
        var onHeaderPointerMove = function (e) {
          var d = dragRef.current
          if (d === null) return
          var dx = e.clientX - d.startX
          var dy = e.clientY - d.startY
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
          var nx = Math.min(Math.max(d.baseX + dx, 48 - d.width), window.innerWidth - 48)
          var ny = Math.min(Math.max(d.baseY + dy, 0), window.innerHeight - 48)
          setPos({ x: nx, y: ny })
        }
        var onHeaderPointerUp = function (e) {
          var d = dragRef.current
          dragRef.current = null
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) { /* ignore */ }
          if (d && d.moved) {
            var suppress = function (ce) {
              ce.preventDefault()
              ce.stopPropagation()
              document.removeEventListener('click', suppress, true)
            }
            document.addEventListener('click', suppress, true)
            setTimeout(function () { document.removeEventListener('click', suppress, true) }, 300)
          }
        }

        if (!isFloating(s.phase)) return null

        var subtitle
        if (s.phase === 'opening') subtitle = 'Creating an independent temporary agent…'
        else if (s.phase === 'closing') subtitle = 'Fading out · click anywhere in the window to keep it'
        else if (s.phase === 'error') subtitle = 'The incognito session is not open (or was restored).'
        else subtitle = 'Isolated context · temporary workspace · ' + shortId(s.sessionId)

        var title = h('div', { className: 'dsh-incog-title' },
          'Incognito',
          h('span', { className: 'dsh-incog-title-badge' }, 'INCOGNITO'))

        var body
        if (s.messages.length === 0 && !s.busy && !s.error) {
          body = h('div', { className: 'dsh-incog-empty' },
            h('div', { className: 'dsh-incog-empty-icon' }, h(GlassesIcon, { size: 22 })),
            h('span', { className: 'dsh-incog-empty-title' }, 'This is a brand-new agent'),
            'It inherits no context, memory, or prompts from this conversation. Its working directory is a dedicated temporary directory.',
            h('br'),
            'When you close the window, the session and that directory are destroyed.'
          )
        } else {
          var rows = []
          s.messages.forEach(function (m, index) {
            rows.push(h('div', {
              className: 'dsh-incog-msg dsh-incog-msg-' + (m.role === 'user' ? 'user' : 'assistant') + (m.error ? ' dsh-incog-msg-error' : ''),
              key: 'm' + index,
            },
              h('div', { className: 'dsh-incog-role' }, m.role === 'user' ? 'You' : 'Incognito agent'),
              h('div', { className: 'dsh-incog-bubble' }, m.text)
            ))
          })
          if (s.busy) {
            if (s.live !== '') {
              rows.push(h('div', { className: 'dsh-incog-msg dsh-incog-msg-assistant', key: 'live' },
                h('div', { className: 'dsh-incog-role' }, 'Incognito agent'),
                h('div', { className: 'dsh-incog-bubble' }, s.live, h('span', { className: 'dsh-incog-caret' }))
              ))
            } else if (s.activity) {
              rows.push(h('div', { className: 'dsh-incog-activity', key: 'activity' },
                h('span', { className: 'dsh-incog-activity-dot' }),
                s.activity
              ))
            }
          }
          if (s.error) {
            rows.push(h('div', { className: 'dsh-incog-error', key: 'error' }, s.error))
          }
          body = rows
        }

        var closingBar = closing
          ? h('div', { className: 'dsh-incog-closing' },
              h('span', { className: 'dsh-incog-closing-dot' }),
              'Destroying in ' + Math.max(1, remaining) + 's · click anywhere in this window to keep it')
          : null

        return h('div', {
          ref: winRef,
          className: 'dsh-incog-window',
          'data-phase': s.phase,
          'data-finalizing': s.finalizing === true,
          style: pos === null ? { visibility: 'hidden' } : { left: pos.x + 'px', top: pos.y + 'px' },
          onPointerDownCapture: function (e) {
            if (store.phase !== 'closing' || store.finalizing === true) return
            e.preventDefault()
            e.stopPropagation()
            cancelClose()
          },
        },
          h('div', {
            className: 'dsh-incog-head',
            onPointerDown: onHeaderPointerDown,
            onPointerMove: onHeaderPointerMove,
            onPointerUp: onHeaderPointerUp,
            onPointerCancel: onHeaderPointerUp,
          },
            h('span', { className: 'dsh-incog-logo' }, h(GlassesIcon, { size: 16 })),
            h('div', { className: 'dsh-incog-headtext' }, title, h('div', { className: 'dsh-incog-sub' }, subtitle)),
            h('button', {
              type: 'button',
              className: 'dsh-incog-close',
              'data-no-drag': true,
              onClick: requestClose,
              disabled: s.phase === 'closing' || s.phase === 'opening',
              title: 'Close and destroy (click the window within 5s to cancel)',
              'aria-label': 'Close and destroy the incognito session',
              children: '×',
            })
          ),
          closingBar,
          h('div', { className: 'dsh-incog-body', ref: listRef }, body),
          h('div', { className: 'dsh-incog-foot' },
            h('span', { className: 'dsh-incog-foot-dot' }),
            h('span', { className: 'dsh-incog-foot-note' }, 'Burn after use · never in the resident session'),
            h('span', { className: 'dsh-incog-foot-spacer' }),
            s.busy
              ? h('span', { className: 'dsh-incog-foot-live' }, s.activity || 'Replying…')
              : h('span', { className: 'dsh-incog-foot-side' }, s.cwd ? 'Temporary workspace isolated' : '')
          ),
          closing ? h('div', { className: 'dsh-incog-progress' }, h('span')) : null
        )
      }

      // ── shadow input bar ────────────────────────────────────────────────
      function IncognitoBar() {
        var s = useStore()
        var draftState = React.useState('')
        var draft = draftState[0]
        var setDraft = draftState[1]
        var textareaRef = React.useRef(null)
        var composingRef = React.useRef(false)

        React.useEffect(function () {
          if (s.phase === 'active' && textareaRef.current) textareaRef.current.focus({ preventScroll: true })
        }, [s.phase])

        if (s.phase === 'idle') return null

        var canSend = s.phase === 'active' && !s.busy && draft.trim() !== ''
        var submit = function () {
          if (!canSend) return
          var text = draft
          setDraft('')
          sendIncognito(text)
        }
        var onKeyDown = function (e) {
          if (e.key !== 'Enter' || e.shiftKey) return
          var composing = composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
          if (composing) return
          e.preventDefault()
          submit()
        }
        var placeholder = s.phase === 'opening'
          ? 'Creating the incognito agent…'
          : s.phase === 'error'
            ? 'Incognito could not start. Close the window and retry.'
            : s.busy
              ? 'The incognito agent is working…'
              : 'Message the incognito agent. Enter sends; this text never enters the resident session.'

        var sendButton = h('button', {
          type: 'button',
          className: 'dsh-incog-send',
          onClick: submit,
          disabled: !canSend,
          title: 'Send to the incognito agent',
          'aria-label': 'Send to the incognito agent',
        }, h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
          h('path', {
            fill: 'currentColor',
            d: 'M8.31 1.98c.58.12 1.01.52 1.38.88l4.02 4.02-1.41 1.42L9 5.04v9.92H7V5.04L3.7 8.3 2.29 6.88 6.3 2.86c.37-.36.8-.76 1.38-.88a2.2 2.2 0 0 1 .63 0Z',
          })
        ))

        var actions = h('div', { className: 'dsh-incog-actions' },
          h('span', { className: 'dsh-incog-hint' },
            h('span', { className: 'dsh-incog-bar-enter' }, 'Shift+Enter for a newline · closing destroys it')
          ),
          sendButton
        )

        var textarea = h('textarea', {
          ref: textareaRef,
          rows: 2,
          value: draft,
          disabled: s.phase !== 'active' || s.busy,
          placeholder: placeholder,
          onChange: function (e) { setDraft(e.target.value) },
          onKeyDown: onKeyDown,
          onCompositionStart: function () { composingRef.current = true },
          onCompositionEnd: function () { setTimeout(function () { composingRef.current = false }, 10) },
        })

        var card = h('div', { className: 'dsh-incog-card', 'data-busy': s.busy === true }, textarea, actions)

        var badge = h('span', { className: 'dsh-incog-bar-badge' },
          h('span', { className: 'dsh-incog-bar-badge-dot' }),
          'Incognito input · never enters this conversation'
        )

        return h('div', { className: 'dsh-incog-bar', 'data-phase': s.phase }, badge, card)
      }

      // ── entry button ────────────────────────────────────────────────────
      function EntryButton() {
        var s = useStore()
        if (s.phase !== 'idle') return null
        var status = s.status || {}
        var blocked = status.checked === true && status.ready !== true
        return h('button', {
          type: 'button',
          className: 'dsh-incog-entry',
          'aria-label': 'Incognito',
          title: blocked
            ? 'Incognito unavailable: ' + (status.reason || 'the environment is not ready')
            : 'Incognito: an independent temporary agent, destroyed when the window closes',
          disabled: blocked,
          onClick: openIncognito,
        }, h(GlassesIcon, { size: 15 }))
      }

      // ── mount / dispose ─────────────────────────────────────────────────
      function mountOverlay() {
        if (overlayRoot !== null) return
        overlayEl = document.createElement('div')
        overlayEl.className = 'dsh-incog-overlay-root'
        overlayEl.setAttribute('data-dsh-incognito-root', '')
        document.body.appendChild(overlayEl)
        overlayRoot = ReactDOMClient.createRoot(overlayEl)
        overlayRoot.render(h(FloatingWindow))
      }

      function beforeUnload() {
        if (store.sessionId && store.phase !== 'idle') {
          try {
            navigator.sendBeacon(API + '/close', new Blob([JSON.stringify({ sessionId: store.sessionId })], { type: 'application/json' }))
          } catch (e) { /* best effort */ }
        }
      }

      function apply(ctx) {
        ctxRef = ctx
        injectStyle()
        mountOverlay()
        window.addEventListener('beforeunload', beforeUnload)

        // A refresh or a newly opened tab has no way to resume a floating
        // window, so any live host-side session from the previous document is
        // stale and must be destroyed. The host also sweeps on boot.
        rpc('cleanup').catch(function () { /* host may still be booting */ })
        checkStatus(true)

        entryFiber = ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: PLUGIN + '-entry',
            order: 5,
            registrant: PLUGIN,
          }, EntryButton)
        })

        ctx.effect(function () {
          return function () {
            window.removeEventListener('beforeunload', beforeUnload)
            closeToken += 1
            if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null }
            stopPolling()
            try { if (entryFiber !== null && typeof entryFiber.dispose === 'function') entryFiber.dispose() } catch (e) { /* ignore */ }
            try { if (shadowFiber !== null && typeof shadowFiber.dispose === 'function') shadowFiber.dispose() } catch (e) { /* ignore */ }
            entryFiber = null
            shadowFiber = null
            if (overlayRoot !== null) {
              try { overlayRoot.unmount() } catch (e) { /* ignore */ }
              overlayRoot = null
            }
            if (overlayEl !== null) { overlayEl.remove(); overlayEl = null }
            ctxRef = null
          }
        }, 'dsh-incognito.client')
      }

      exports.name = PLUGIN
      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})()
