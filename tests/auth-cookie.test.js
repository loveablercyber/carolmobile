import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSessionCookie,
  setSessionCookie,
  shouldUseSecureSessionCookie,
} from '../server/lib/auth.js'

function withEnvironment(values, work) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  )
  Object.assign(process.env, values)
  try {
    return work()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function responseHeaders() {
  const headers = new Map()
  return {
    headers,
    response: {
      setHeader(name, value) {
        headers.set(name, value)
      },
    },
  }
}

test('production HTTP preview uses a browser-compatible session cookie', () => {
  withEnvironment(
    {
      NODE_ENV: 'production',
      APP_URL: 'http://preview.example.test',
      SESSION_COOKIE_SECURE: '',
    },
    () => {
      const { headers, response } = responseHeaders()
      assert.equal(shouldUseSecureSessionCookie(), false)
      setSessionCookie(response, 'token')
      assert.doesNotMatch(headers.get('Set-Cookie'), /; Secure/)
    },
  )
})

test('HTTPS deployment uses a secure session cookie', () => {
  withEnvironment(
    {
      NODE_ENV: 'production',
      APP_URL: 'https://agenda.carolsol.com.br',
      SESSION_COOKIE_SECURE: '',
    },
    () => {
      const { headers, response } = responseHeaders()
      assert.equal(shouldUseSecureSessionCookie(), true)
      setSessionCookie(response, 'token')
      assert.match(headers.get('Set-Cookie'), /; Secure$/)
      clearSessionCookie(response)
      assert.match(headers.get('Set-Cookie'), /; Secure$/)
    },
  )
})

test('SESSION_COOKIE_SECURE explicitly overrides APP_URL', () => {
  withEnvironment(
    {
      NODE_ENV: 'production',
      APP_URL: 'http://preview.example.test',
      SESSION_COOKIE_SECURE: 'true',
    },
    () => assert.equal(shouldUseSecureSessionCookie(), true),
  )
})
