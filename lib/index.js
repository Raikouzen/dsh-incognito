// dsh-incognito — host half.
//
// The whole feature deliberately bypasses the resident conversation: there is
// no "main session tool call", no parent seed, and no transcript copied into
// the resident session. The browser talks to these exact Fetch routes, and a
// fresh root agent is created for the incognito window. Its cwd is a dedicated
// OS-temp directory outside every DSH workspace; closing the window disposes
// the agent and deletes both that directory and its session-log project dir.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import {
  API_PREFIX,
  PRESET_ID,
  errorText,
  finalAssistantText,
  incognitoTempRoot,
  isIncognitoId,
  isInside,
  newSessionId,
  sessionProjectDir,
  sessionsRoot,
  streamActivity,
  streamText,
} from './core.js'

export const name = 'dsh-incognito'
export const inject = ['agents', 'agentPresets', 'connection']

const SEND_TIMEOUT_MS = 15 * 60 * 1000
const DISPOSE_TIMEOUT_MS = 20 * 1000
const CLEANUP_RETRY_MS = 350
const CLEANUP_ATTEMPTS = 20
const PROJECTION_CACHE_MARK = Symbol.for('dsh-incognito.projection-cache')

/** Cordis wraps services in ownership-tracking proxies; patch the original object. */
function originalService(service) {
  const raw = service?.[Symbol.for('cordis.original')]
  return raw ?? service
}

/** Keep the projection cache from persisting incognito titles/usage/last-prompt. */
function patchProjectionCache(cache) {
  if (typeof cache?.put !== 'function' || cache.put.length < 2) return false
  if (cache[PROJECTION_CACHE_MARK]) return null
  const hadOwn = Object.prototype.hasOwnProperty.call(cache, 'put')
  const original = cache.put
  async function put(id, ...rest) {
    if (isIncognitoId(id)) return
    return original.call(this ?? cache, id, ...rest)
  }
  try {
    cache.put = put
  } catch {
    return false
  }
  if (cache.put !== put) return false
  cache[PROJECTION_CACHE_MARK] = true
  return () => {
    if (cache.put === put) {
      if (hadOwn) cache.put = original
      else delete cache.put
    }
    delete cache[PROJECTION_CACHE_MARK]
  }
}

/** Wait for a promise, rejecting with a stable message after `ms`. */
function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Build one user message without importing dsh-llm. Keeping this plugin free
 * of bare @deepseek-ai imports lets a `file:` install resolve with only Node
 * builtins (peer packages are not linked for local bundles).
 */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** JSON response shape used by every route. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Read a JSON body without letting a malformed one 500 the route. */
async function bodyOf(request) {
  try {
    const body = await request.json()
    return body !== null && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

class IncognitoHost {
  constructor(ctx) {
    this.ctx = ctx
    this.sessions = new Map()
    this.routeDisposers = []
    this.cacheDispose = undefined
    this.cacheState = 'absent'
    this.closed = false
    this.errors = []
    this.tempRoot = incognitoTempRoot()
  }

  log(message) {
    this.ctx.logger?.info?.(`[dsh-incognito] ${message}`)
  }

  warn(message, error) {
    const text = error === undefined ? message : `${message}: ${errorText(error)}`
    this.errors.push(text)
    this.ctx.logger?.warn?.(`[dsh-incognito] ${text}`)
  }

  /** Mount the exact Fetch routes. */
  registerRoutes() {
    const actions = {
      open: body => this.open(body),
      send: body => this.send(body),
      poll: body => this.poll(body),
      close: body => this.close(body),
      status: () => this.status(),
      cleanup: () => this.cleanupAll('client-refresh'),
    }
    for (const [method, action] of Object.entries(actions)) {
      const dispose = this.ctx.connection.fetch.register({
        path: `${API_PREFIX}/${method}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          if (this.closed) return json({ ok: false, error: { code: 'closed', message: 'plugin is shutting down' } }, 503)
          const body = await bodyOf(request)
          try {
            const value = await action(body)
            return json({ ok: true, value })
          } catch (error) {
            return json({ ok: false, error: { code: 'incognito', message: errorText(error) } })
          }
        },
      })
      this.routeDisposers.push(dispose)
    }
  }

  /** Patch the projection cache once it exists; absent is fine on a lean deployment. */
  installProjectionCacheGuard() {
    this.ctx.inject(['sessionProjectionCache'], child => {
      const cache = originalService(child.sessionProjectionCache)
      const restore = patchProjectionCache(cache)
      if (typeof restore === 'function') {
        this.cacheState = 'guarded'
        this.cacheDispose = restore
        child.effect(() => () => {
          restore()
          this.cacheState = 'absent'
        }, 'dsh-incognito.projection-cache')
      } else if (restore === false) {
        this.cacheState = 'unsupported'
        this.warn('projection cache does not expose a guardable put(); refusing to promise a zero-trace session')
      } else {
        this.cacheState = 'guarded'
      }
    })
  }

  /** A light preflight the client uses to grey out its entry button honestly. */
  async status() {
    let preset = { ok: false, message: 'agent preset service unavailable' }
    try {
      const resolved = await this.ctx.agentPresets.resolve(PRESET_ID)
      preset = { ok: true, id: resolved?.id ?? PRESET_ID }
    } catch (error) {
      preset = { ok: false, message: errorText(error) }
    }
    let model = undefined
    try {
      const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
      if (selection?.provider && selection?.model) model = { provider: selection.provider, model: selection.model }
    } catch (error) {
      this.warn('could not read the default model', error)
    }
    let writable = false
    try {
      fs.mkdirSync(this.tempRoot, { recursive: true })
      const probe = join(this.tempRoot, `.probe-${randomUUID()}`)
      fs.writeFileSync(probe, 'ok')
      fs.rmSync(probe, { force: true })
      // The probe must not leave a dedicated directory behind after close.
      try { fs.rmdirSync(this.tempRoot) } catch { /* active sessions keep it non-empty */ }
      writable = true
    } catch (error) {
      this.warn('incognito temp root is not writable', error)
    }
    // Fail closed: if the cache cannot be guarded, the session would leave
    // title/last-prompt checkpoints on disk, which is exactly what this plugin
    // promises not to do.
    const cacheOK = this.cacheState === 'guarded'
    const ready = preset.ok && model !== undefined && writable && cacheOK && !this.closed
    return {
      ready,
      preset,
      model,
      writable,
      projectionCache: this.cacheState,
      tempRoot: this.tempRoot,
      liveSessions: this.sessions.size,
      liveIds: [...this.sessions.keys()],
      errors: [...this.errors],
    }
  }

  /** Create a fresh, independent agent in a fresh temp directory. */
  async open() {
    await this.cleanupAll('open')
    if (this.closed) throw new Error('plugin is shutting down')
    const status = await this.status()
    if (!status.ready) {
      const reason = !status.preset.ok
        ? `incognito preset unavailable: ${status.preset.message ?? 'unknown error'}`
        : status.model === undefined
          ? 'no default model is configured for this profile'
          : !status.writable
            ? 'the incognito temporary directory is not writable'
            : 'the projection cache cannot be guarded on this DSH version'
      throw new Error(reason)
    }
    const selection = this.ctx.get('agentDefaultModel').currentSelection()
    if (!selection?.provider || !selection?.model) throw new Error('no default model is configured for this profile')
    const agentOptions = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }

    fs.mkdirSync(this.tempRoot, { recursive: true })
    const sessionId = newSessionId(randomUUID)
    const cwd = join(this.tempRoot, sessionId)
    fs.mkdirSync(cwd, { recursive: true })
    if (!isInside(this.tempRoot, cwd)) throw new Error('resolved incognito cwd escaped its temp root')

    const entry = {
      sessionId,
      cwd,
      handle: undefined,
      agent: undefined,
      busy: false,
      live: '',
      activity: 'Thinking…',
      error: null,
      createdAt: Date.now(),
    }

    const setup = async (childCtx, agent) => {
      await this.ctx.agentPresets.mount(childCtx, PRESET_ID)
      try {
        agent.session.append('agent-preset/selected', { agentPreset: PRESET_ID })
      } catch {
        // The preset is already carried by the session header; the event is a
        // projection convenience, not a creation requirement.
      }
      try {
        agent.session.append('approval/policy', { policy: 'never', source: 'delegation' })
      } catch {
        // A deployment without the approval plugin already fails closed.
      }
      childCtx.on('agent/assistant-stream', payload => {
        const chunk = payload?.frame?.type === 'chunk' ? payload.frame.chunk : undefined
        if (chunk === undefined) {
          if (payload?.frame?.type === 'start') entry.activity = 'Thinking…'
          if (payload?.frame?.type === 'end') entry.activity = null
          return
        }
        const text = streamText(chunk)
        if (text !== '') {
          entry.live += text
          entry.activity = null
          return
        }
        const activity = streamActivity(chunk)
        if (activity !== null) entry.activity = activity
      })
      childCtx.on('agent/error', payload => {
        entry.error = errorText(payload?.error ?? 'agent failed')
      })
    }

    try {
      const handle = await this.ctx.agents.create({
        sessionId,
        meta: { origin: 'subagent', agentPreset: PRESET_ID, cwd },
        agentOptions,
        setup,
      })
      entry.handle = handle
      entry.agent = handle.agent
      this.sessions.set(sessionId, entry)
      this.log(`opened ${sessionId} in ${cwd}`)
      return { sessionId, cwd, model: { provider: selection.provider, model: selection.model } }
    } catch (error) {
      try { fs.rmSync(cwd, { recursive: true, force: true }) } catch { /* best effort */ }
      throw error
    }
  }

  entryOf(body) {
    const sessionId = body?.sessionId
    if (!isIncognitoId(sessionId)) throw new Error('invalid incognito session id')
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) throw new Error('incognito session is not live (it may have been closed)')
    return entry
  }

  /** Queue one user turn and wait for it to settle. The client polls for live text meanwhile. */
  async send(body) {
    const entry = this.entryOf(body)
    const text = typeof body?.text === 'string' ? body.text : ''
    if (text.trim() === '') throw new Error('message cannot be empty')
    if (entry.busy) throw new Error('the incognito agent is still answering')
    entry.busy = true
    entry.live = ''
    entry.activity = 'Thinking…'
    entry.error = null
    const turnStartedAt = Date.now()
    try {
      entry.agent.followup(userMessage(text))
      await withTimeout(entry.agent.whenIdle(), SEND_TIMEOUT_MS, 'incognito agent timed out')
      const reply = finalAssistantText(entry.agent.session.snapshotEvents()) || entry.live
      return { reply, error: entry.error, durationMs: Date.now() - turnStartedAt }
    } catch (error) {
      if (entry.agent?.status === 'running') {
        try { entry.agent.cancel({ kind: 'user' }) } catch { /* already gone */ }
      }
      throw error
    } finally {
      entry.busy = false
      entry.activity = null
      entry.live = ''
    }
  }

  /** Current one-turn stream state for the floating window. */
  poll(body) {
    const entry = this.entryOf(body)
    return {
      status: entry.busy ? 'running' : 'idle',
      live: entry.live,
      activity: entry.activity,
      error: entry.error,
    }
  }

  /** Dispose one agent and delete every artifact we know about. */
  async close(body) {
    const sessionId = body?.sessionId
    if (!isIncognitoId(sessionId)) throw new Error('invalid incognito session id')
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) {
      // A retry after a refresh can still have an orphaned temp dir/log dir.
      await this.burnPathsFor(sessionId, join(this.tempRoot, sessionId))
      return { burned: true, existed: false }
    }
    this.sessions.delete(sessionId)
    return { burned: true, existed: true, ...(await this.destroyEntry(entry)) }
  }

  /** Dispose without throwing; returns residual paths so the client can report an honest failure. */
  async destroyEntry(entry) {
    const residuals = []
    try {
      if (entry.agent?.status === 'running') {
        try { entry.agent.cancel({ kind: 'user' }) } catch { /* ignore */ }
      }
      if (entry.handle !== undefined) {
        await withTimeout(entry.handle.dispose(), DISPOSE_TIMEOUT_MS, 'agent disposal timed out')
      }
    } catch (error) {
      this.warn(`dispose failed for ${entry.sessionId}`, error)
    }
    try {
      await this.detachFromWorkspace(entry.sessionId)
    } catch (error) {
      this.warn(`workspace detach failed for ${entry.sessionId}`, error)
    }
    residuals.push(...await this.burnPathsFor(entry.sessionId, entry.cwd))
    if (residuals.length > 0) this.warn(`cleanup left residual paths: ${residuals.join(', ')}`)
    return { residuals }
  }

  /** Delete the session log project dir, cwd, and any workspace/cache references. */
  async burnPathsFor(sessionId, cwd) {
    const residuals = []
    const projectDir = sessionProjectDir(cwd)
    if (!isInside(incognitoTempRoot(), cwd) && !isIncognitoId(sessionId)) return residuals
    for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt++) {
      let remaining = false
      for (const target of [projectDir, cwd]) {
        try {
          await fsp.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
        } catch (error) {
          this.warn(`delete failed for ${target}`, error)
        }
        if (fs.existsSync(target)) remaining = true
      }
      if (!remaining) {
        try { fs.rmdirSync(this.tempRoot) } catch { /* shared with another live session */ }
        return residuals
      }
      await new Promise(resolve => setTimeout(resolve, CLEANUP_RETRY_MS))
    }
    for (const target of [projectDir, cwd]) if (fs.existsSync(target)) residuals.push(target)
    return residuals
  }

  /** Remove an incognito id from workspace accounting if a listener managed to attach it. */
  async detachFromWorkspace(sessionId) {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return
    for (const workspace of registry.list?.() ?? []) {
      const ids = workspace?.record?.sessionIds ?? workspace?.sessionIds ?? []
      if (Array.isArray(ids) && ids.includes(sessionId) && typeof workspace.detachSession === 'function') {
        await workspace.detachSession(sessionId)
      }
    }
    if (registry.archivedSessionIds?.includes(sessionId) && typeof registry.unarchiveSession === 'function') {
      await registry.unarchiveSession(sessionId)
    }
    if (registry.pinnedSessionIds?.includes(sessionId) && typeof registry.unpinSession === 'function') {
      await registry.unpinSession(sessionId)
    }
  }

  /** Close every live incognito agent and remove stale temp/log dirs. */
  async cleanupAll(reason) {
    const live = [...this.sessions.values()]
    this.sessions.clear()
    for (const entry of live) {
      try {
        await this.destroyEntry(entry)
      } catch (error) {
        this.warn(`cleanup failed for ${entry.sessionId}`, error)
      }
    }
    try {
      this.sweepStaleDirectories()
    } catch (error) {
      this.warn(`stale sweep failed after ${reason}`, error)
    }
  }

  /**
   * Delete every leftover temp cwd and its project log dir. This runs at boot
   * (host restart) and on an explicit client cleanup (page refresh). It only
   * touches directories under the dedicated incognito temp root or project
   * dirs whose name contains `dsh-incognito`.
   */
  sweepStaleDirectories() {
    const root = incognitoTempRoot()
    let entries = []
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { /* no temp root yet */ }
    for (const entry of entries) {
      const target = join(root, entry.name)
      if (!isInside(root, target)) continue
      try { fs.rmSync(target, { recursive: true, force: true }) } catch (error) { this.warn(`stale temp cleanup failed for ${target}`, error) }
      if (isIncognitoId(entry.name)) {
        const logProject = sessionProjectDir(target)
        try {
          if (projectKeyLooksIncognito(logProject)) fs.rmSync(logProject, { recursive: true, force: true })
        } catch (error) {
          this.warn(`stale session-log cleanup failed for ${logProject}`, error)
        }
      }
    }
    // Swing a second time for logs whose cwd disappeared before this run.
    try {
      const sessions = sessionsRoot()
      for (const name of fs.readdirSync(sessions)) {
        if (!name.includes('dsh-incognito')) continue
        const target = join(sessions, name)
        if (!isInside(sessions, target)) continue
        try { fs.rmSync(target, { recursive: true, force: true }) } catch (error) { this.warn(`stale log sweep failed for ${target}`, error) }
      }
    } catch { /* no sessions root yet */ }
    try { fs.rmdirSync(root) } catch { /* not empty or absent */ }
  }

  dispose() {
    this.closed = true
    for (const dispose of this.routeDisposers) {
      try { void dispose() } catch { /* ignore */ }
    }
    this.routeDisposers = []
    try { this.cacheDispose?.() } catch { /* ignore */ }
    this.cacheDispose = undefined
    for (const entry of this.sessions.values()) {
      try { void entry.handle?.dispose() } catch { /* ignore */ }
    }
    this.sessions.clear()
    try { this.sweepStaleDirectories() } catch { /* ignore */ }
  }
}

/** Narrow check used by the stale-log sweep; keeps the pattern in one place. */
function projectKeyLooksIncognito(path) {
  return path.includes('dsh-incognito')
}

export function apply(ctx) {
  const host = new IncognitoHost(ctx)
  host.registerRoutes()
  host.installProjectionCacheGuard()
  // A boot is the one moment every prior incognito agent is dead. Sweep before
  // the first open so a crash/restart cannot accumulate temp dirs or logs.
  try { host.sweepStaleDirectories() } catch (error) { host.warn('boot cleanup failed', error) }
  ctx.effect(() => () => host.dispose(), 'dsh-incognito.lifecycle')
}
