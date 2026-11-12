// dsh-incognito — pure helpers shared by the host half and tests.
//
// No DSH imports here: this module must stay loadable by plain Node so the
// cleanup/path rules can be tested without booting the harness.

import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Session ids created by this plugin. The prefix is the marker used by every guard. */
export const SESSION_PREFIX = 'session-incognito-'

/** Agent preset id declared in cordis.patch.yml. */
export const PRESET_ID = 'incognito'

/** API prefix for the plugin's exact Fetch routes. */
export const API_PREFIX = '/api/dsh-incognito'

/** True for ids owned by this plugin. */
export function isIncognitoId(value) {
  return typeof value === 'string' && value.startsWith(SESSION_PREFIX)
}

/** Resolve the single DSH home the same way the harness does (`$DSH_HOME`, then ~/.dsh). */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured.trim())
  return join(homedir(), '.dsh')
}

/** Root holding the durable session directories. */
export function sessionsRoot(env = process.env) {
  return join(dshHome(env), 'sessions')
}

/**
 * Base directory for incognito working directories. Kept outside every DSH
 * workspace on purpose: a session whose cwd is under a registered workspace
 * can show up in that workspace's history even when it was never opened there.
 */
export function incognitoTempRoot(env = process.env) {
  return join(tmpdir(), 'dsh-incognito')
}

/** One safe path segment, injective over JS strings (mirror of the DSH persistence encoder). */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** Human-readable project directory key for one cwd (mirror of DSH's persistence format). */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** Directory owned by one session's log (the parent may also hold subagent logs). */
export function sessionProjectDir(cwd, env = process.env) {
  return join(sessionsRoot(env), projectKey(cwd))
}

/** True when child is the same path as parent or strictly inside it. */
export function isInside(parent, child) {
  const p = resolve(parent)
  const c = resolve(child)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/** A random host-owned session id. */
export function newSessionId(randomUUID) {
  return SESSION_PREFIX + randomUUID()
}

/** Concatenated text parts of one assistant message event. */
export function textOfAssistantEvent(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/** The last non-empty assistant text in a session log. */
export function finalAssistantText(events) {
  if (!Array.isArray(events)) return ''
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const text = textOfAssistantEvent(event).trim()
    if (text !== '') return text
  }
  return ''
}

/** Text contributed by one raw model stream chunk. */
export function streamText(chunk) {
  return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : ''
}

/** A compact activity label for the floating window. */
export function streamActivity(chunk) {
  if (chunk?.type === 'reasoning-delta') return 'Thinking…'
  if (chunk?.type === 'tool-call-delta') {
    return typeof chunk.name === 'string' && chunk.name !== '' ? `Using ${chunk.name}…` : 'Using a tool…'
  }
  if (chunk?.type === 'block-start' && chunk.blockType === 'tool_use') return 'Using a tool…'
  if (chunk?.type === 'finish') return null
  return null
}

/** Convert an unknown thrown value into a short user-facing string. */
export function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
