import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SESSION_PREFIX,
  encodeSegment,
  finalAssistantText,
  isInside,
  isIncognitoId,
  newSessionId,
  projectKey,
  streamActivity,
  streamText,
} from '../lib/core.js'

test('session ids are namespaced and recognized', () => {
  assert.equal(isIncognitoId(SESSION_PREFIX + 'abc'), true)
  assert.equal(isIncognitoId('session-abc'), false)
  assert.equal(isIncognitoId(undefined), false)
  assert.equal(newSessionId(() => '00000000-0000-0000-0000-000000000000'), SESSION_PREFIX + '00000000-0000-0000-0000-000000000000')
})

test('project key matches the persistence layout on Windows', () => {
  assert.equal(
    projectKey('C:\\Users\\example\\AppData\\Local\\Temp\\dsh-incognito\\session-incognito-abc'),
    '--C-Users-example-AppData-Local-Temp-dsh-incognito-session-incognito-abc--',
  )
  assert.equal(projectKey('/incognito/'), '--incognito---')
})

test('path segments escape separators and traversal', () => {
  assert.equal(encodeSegment('session-abc'), 'session-abc')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('a/b'), 'a~002Fb')
})

test('inside check is component-safe', () => {
  assert.equal(isInside('C:\\tmp\\x', 'C:\\tmp\\x\\y'), true)
  assert.equal(isInside('C:\\tmp\\x', 'C:\\tmp\\xy'), false)
  assert.equal(isInside('C:\\tmp\\x', 'C:\\tmp\\x'), true)
})

test('final assistant text takes the last non-empty text message', () => {
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '  ' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'last' }, { type: 'tool-call' }] } } },
    { type: 'user/message', data: {} },
  ]
  assert.equal(finalAssistantText(events), 'last')
  assert.equal(finalAssistantText([]), '')
})

test('stream helpers expose only visible text and friendly activity', () => {
  assert.equal(streamText({ type: 'text-delta', text: 'hi' }), 'hi')
  assert.equal(streamText({ type: 'reasoning-delta', text: 'secret' }), '')
  assert.equal(streamActivity({ type: 'reasoning-delta' }), 'Thinking…')
  assert.equal(streamActivity({ type: 'tool-call-delta', name: 'web_fetch' }), 'Using web_fetch…')
  assert.equal(streamActivity({ type: 'text-delta', text: 'x' }), null)
})
