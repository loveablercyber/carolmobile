import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { safeReturnPath } from '../server/lib/sso.js'

const auth = await readFile(new URL('../server/lib/auth.js', import.meta.url), 'utf8')
const sso = await readFile(new URL('../server/lib/sso.js', import.meta.url), 'utf8')
const api = await readFile(new URL('../api/auth.js', import.meta.url), 'utf8')

test('sessão do Agenda permanece restrita ao próprio host', () => {
  assert.doesNotMatch(auth, /Domain=/)
  assert.match(auth, /HttpOnly/)
  assert.match(auth, /SameSite=Lax/)
})

test('alterar a senha invalida tokens emitidos com a credencial anterior', () => {
  assert.match(auth, /credentialVersion/)
  assert.match(auth, /payload\.cv/)
  assert.match(auth, /!payload\.cv/)
  assert.match(auth, /identity\.encrypted_password/)
})

test('SSO usa hash, destino exato, expiração e consumo atômico', () => {
  assert.match(sso, /codeHash\(code\)/)
  assert.match(sso, /interval '60 seconds'/)
  assert.match(sso, /target_origin=\$2/)
  assert.match(sso, /for update/)
  assert.match(sso, /set used_at=now\(\)/)
  assert.match(api, /Cache-Control.*no-store/)
})

test('caminho de retorno bloqueia redirecionamento para outro domínio', () => {
  assert.equal(safeReturnPath('/admin/dashboard'), '/admin/dashboard')
  assert.equal(safeReturnPath('//evil.example/path', '/'), '/')
  assert.equal(safeReturnPath('https://evil.example', '/conta'), '/conta')
})
