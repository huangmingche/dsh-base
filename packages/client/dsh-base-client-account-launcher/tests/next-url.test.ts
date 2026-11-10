import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLoginHref } from '../src/client/next-url.ts'
import { loginReturnPath } from '../../dsh-base-client-auth-login/src/client/return-url.ts'

test('root target keeps the origin and uses the base locale', () => {
  assert.equal(buildLoginHref({ pathname: '/', search: '', hash: '' }, 'en'), '/login?next=%2F&locale=en')
})

test('locale prefix, query and hash survive the round trip', () => {
  const href = buildLoginHref({ pathname: '/zh-CN/app/session/abc', search: '?x=1', hash: '#y' }, 'zh-CN')
  const url = new URL(href, 'https://app.example.test')
  assert.equal(url.pathname, '/login')
  assert.equal(url.searchParams.get('next') ?? '', '/zh-CN/app/session/abc?x=1#y')
  assert.equal(url.searchParams.get('locale'), 'zh-CN')
})

test('deep links with encoded characters are encoded exactly once', () => {
  const href = buildLoginHref({ pathname: '/app/session/a%20b', search: '?q=caf%C3%A9', hash: '' }, 'en')
  const next = new URL(href, 'https://app.example.test').searchParams.get('next') ?? ''
  assert.equal(next, '/app/session/a%20b?q=caf%C3%A9')
  // The login document reads `next` from URLSearchParams (decoded once) and
  // routes it through loginReturnPath; the path stays on this origin.
  assert.equal(loginReturnPath(next, 'https://app.example.test'), '/app/session/a%20b?q=caf%C3%A9')
})

test('cross-origin next values fall back to the application root', () => {
  for (const hostile of ['https://evil.example/x', '//evil.example/x']) {
    assert.equal(loginReturnPath(hostile, 'https://app.example.test'), '/', hostile)
  }
  const href = buildLoginHref({ pathname: '/', search: '', hash: '' }, 'en')
  const next = new URL(href, 'https://app.example.test').searchParams.get('next') ?? ''
  assert.equal(new URL(next, 'https://app.example.test').origin, 'https://app.example.test', 'next stays same-origin')
})

test('an empty pathname falls back to the root path', () => {
  assert.equal(buildLoginHref({ pathname: '', search: '', hash: '#x' }, 'en'), '/login?next=%2F%23x&locale=en')
})
