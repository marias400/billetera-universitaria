import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

const data = mkdtempSync(join(tmpdir(), 'unlar-email-test-'))
const port = 14983
const server = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
  env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', APP_MODE: 'local' }, stdio: 'pipe',
})
let logs = ''
server.stderr.on('data', (chunk) => { logs += chunk })
async function call(path, token, body, status = 200) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`)
  return result
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; if (ready) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(ready, logs)
  const login = async (account) => (await call('/api/demo/login', null, { account, password: 'demo2026' })).token
  const tools = await login('demo-tools')
  const teacher = await login('teacher-marcelo')
  const students = []
  for (let i = 0; i < 8; i++) {
    const { publicKey, secretKey } = ml_dsa65.keygen()
    const fullName = `Estudiante de prueba ${i + 1}`
    students.push(await call('/api/guests/register', null, {
      fullName, walletPublicKey: Buffer.from(publicKey).toString('base64'),
      holderSignature: Buffer.from(ml_dsa65.sign(Buffer.from(`guest-register.${fullName}`), secretKey)).toString('base64url'),
    }, 201))
  }
  const ids = students.slice(0, 7).map((student) => student.actor.studentId)
  const pending = (student) => call('/api/raffle/prize-requests/pending', student.token)
  await call('/api/demo/email-requests', null, { studentIds: ids }, 401)
  await call('/api/demo/email-requests', teacher, { studentIds: ids }, 403)
  await call('/api/demo/email-requests', students[0].token, { studentIds: ids }, 403)
  for (const studentIds of [[], [ids[0], ids[0]], [ids[0], 'no-existe'], [ids[0], 'mariano-arias-simone']]) {
    await call('/api/demo/email-requests', tools, { studentIds }, 400)
  }
  assert.equal((await pending(students[0])).length, 0, 'Invalid batches must be atomic')
  assert.deepEqual(await call('/api/demo/email-requests', tools, { studentIds: ids }), { created: 7, alreadyPending: 0 })
  assert.deepEqual(await call('/api/demo/email-requests', tools, { studentIds: ids }), { created: 0, alreadyPending: 7 })
  for (const student of students.slice(0, 7)) {
    const requests = await pending(student)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].source, 'manual')
  }
  assert.equal((await pending(students[7])).length, 0, 'Unselected student receives no notice')
  const request = (await pending(students[0]))[0]
  const emailPath = `/api/raffle/prize-requests/${request.id}/email`
  await call(emailPath, students[1].token, { email: 'otra@example.com' }, 404)
  await call(emailPath, students[0].token, { email: 'invalido' }, 400)
  await call(emailPath, students[0].token, { email: '  Elegido@Example.com  ' })
  await call(emailPath, students[0].token, { email: 'segunda@example.com' }, 404)
  assert.equal((await pending(students[0])).length, 0)
  const history = await call('/api/raffle/prize-requests', tools)
  assert.equal(history.length, 7)
  assert.equal(history.find((item) => item.id === request.id).email, 'elegido@example.com')
  assert.deepEqual(await call('/api/demo/email-requests', tools, { studentIds: [ids[0]] }), { created: 1, alreadyPending: 0 })
  // The original raffle still supports its own notices and enforces its five-place limit.
  const raffleId = 'raffle-regression-test'
  const winners = students.slice(0, 6).map((student, index) => ({ studentId: student.actor.studentId, place: index + 1 }))
  await call('/api/raffle/prize-requests', tools, { raffleId, winners }, 400)
  await call('/api/raffle/prize-requests', tools, { raffleId, winners: [{ studentId: students[7].actor.studentId, place: 1 }] })
  assert.equal((await pending(students[7]))[0].source, 'raffle')
  assert.deepEqual(await call('/api/demo/email-requests', tools, { studentIds: [students[7].actor.studentId] }), { created: 0, alreadyPending: 1 })
  console.log('Manual emails: selection of 7 students, recipient isolation, authorization, validation, deduplication, replies and raffle regression passed.')
} finally {
  const stopped = once(server, 'exit')
  if (server.exitCode === null) { server.kill(); await stopped }
  rmSync(data, { recursive: true, force: true })
}
