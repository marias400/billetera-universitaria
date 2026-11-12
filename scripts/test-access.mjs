import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { SessionStore, verifyPassword } from '../server/access.ts'

test('password checks reject missing, malformed and incorrect credentials', () => {
  const salt=randomBytes(16).toString('hex')
  const encoded=`${salt}:${scryptSync('test-only-password',salt,32).toString('hex')}`
  assert.equal(verifyPassword('test-only-password',encoded),true)
  for(const value of ['wrong',undefined,{},'a'.repeat(257)]) assert.equal(verifyPassword(value,encoded),false)
  assert.equal(verifyPassword('anything',undefined),false)
  assert.equal(verifyPassword('anything','malformed'),false)
})
test('sessions expire and cannot be reused after deletion', async () => {
  const sessions=new SessionStore(20)
  sessions.set('token',{role:'teacher'})
  assert.equal(sessions.get('token').role,'teacher')
  await new Promise(resolve=>setTimeout(resolve,30))
  assert.equal(sessions.get('token'),undefined)
  assert.equal(sessions.has('token'),false)
  assert.deepEqual([...sessions],[])
  sessions.set('new',{role:'teacher'})
  sessions.delete('new')
  assert.equal(sessions.has('new'),false)
})
