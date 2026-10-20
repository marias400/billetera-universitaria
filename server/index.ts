import Fastify from 'fastify'
import cors from '@fastify/cors'
import Database from 'better-sqlite3'
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dataDir = join(root, 'data')
const databasePath = join(dataDir, 'billetera.sqlite')
const privateKeyPath = join(dataDir, 'issuer-ed25519-private.pem')
mkdirSync(dataDir, { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec([
  'create table if not exists credentials (id text primary key, kind text not null, title text not null, detail text not null, holder text not null, issued_at text not null, expires_at text, status text not null default "Activa", created_at text not null);',
  'create table if not exists attendance_sessions (id text primary key, subject text not null, section text not null, expires_at text not null, status text not null default "Abierta");',
  'create table if not exists attendance_records (id text primary key, session_id text not null references attendance_sessions(id), holder text not null, recorded_at text not null, unique(session_id, holder));',
  'create table if not exists credential_deliveries (code text primary key, credential_id text not null, expires_at text not null, used_at text);',
  'create table if not exists presentation_requests (code text primary key, kind text not null, expires_at text not null, status text not null default "Abierta", result_json text);',
  'create table if not exists wallet_bindings (holder text primary key, public_key text not null, created_at text not null);',
].join('\n'))

const columns = db.prepare('pragma table_info(credentials)').all() as { name: string }[]
if (!columns.some((column) => column.name === 'credential_json')) db.exec('alter table credentials add column credential_json text')

if (!fileExists(privateKeyPath)) {
  const pair = generateKeyPairSync('ed25519')
  writeFileSync(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(join(dataDir, 'issuer-ed25519-public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }))
}
const issuerPrivateKey = createPrivateKey(readFileSync(privateKeyPath))
const issuerPublicKey = createPublicKey(issuerPrivateKey)
const issuerPublicPem = issuerPublicKey.export({ type: 'spki', format: 'pem' }).toString()
const issuerId = 'did:web:unlar.edu.ar:prototipo#issuer-ed25519-1'

function fileExists(path: string) {
  try { readFileSync(path); return true } catch { return false }
}

type CredentialPayload = {
  id: string
  type: string
  issuer: string
  holder: string
  claims: Record<string, string>
  issuedAt: string
  expiresAt?: string
}
type SignedCredential = CredentialPayload & { proof: { algorithm: 'Ed25519'; verificationMethod: string; signature: string } }
type AttendanceSessionRow = { id: string; subject: string; section: string; expiresAt: string; status: string }

function canonicalize(value: CredentialPayload) {
  return JSON.stringify({ claims: value.claims, expiresAt: value.expiresAt, holder: value.holder, id: value.id, issuedAt: value.issuedAt, issuer: value.issuer, type: value.type })
}

function signCredential(payload: CredentialPayload): SignedCredential {
  const signature = sign(null, Buffer.from(canonicalize(payload)), issuerPrivateKey).toString('base64url')
  return { ...payload, proof: { algorithm: 'Ed25519', verificationMethod: issuerId, signature } }
}

function verifyCredential(credential: SignedCredential) {
  if (!credential?.proof || credential.proof.algorithm !== 'Ed25519' || credential.proof.verificationMethod !== issuerId) return false
  const { proof, ...payload } = credential
  try { return verify(null, Buffer.from(canonicalize(payload)), issuerPublicKey, Buffer.from(proof.signature, 'base64url')) } catch { return false }
}

function newCode() { return randomBytes(18).toString('base64url') }

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 })
await app.register(cors, { origin: true })
app.get('/health', async () => ({ ok: true, service: 'billetera-universitaria-api' }))
app.get('/api/issuer-key', async () => ({ keyId: issuerId, algorithm: 'Ed25519', publicKeyPem: issuerPublicPem }))
app.get('/api/credentials', async () => db.prepare('select id, kind, title, detail, holder, issued_at as issuedAt, expires_at as expiresAt, status, created_at as createdAt from credentials order by created_at desc').all())

app.post<{ Body: { kind: string; title: string; detail: string; holder?: string; expiresAt?: string | null } }>('/api/credentials', async (request, reply) => {
  const { kind, title, detail } = request.body ?? {}
  if (!kind || !title || !detail) return reply.code(400).send({ message: 'Completá el tipo, título y detalle de la credencial.' })
  const issuedAt = new Date().toISOString()
  const credential = signCredential({
    id: randomUUID(), type: kind, issuer: 'did:web:unlar.edu.ar:prototipo', holder: request.body.holder ?? 'did:demo:estudiante',
    claims: { titulo: title, detalle: detail }, issuedAt, ...(request.body.expiresAt ? { expiresAt: request.body.expiresAt } : {}),
  })
  db.prepare('insert into credentials (id, kind, title, detail, holder, issued_at, expires_at, status, created_at, credential_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(credential.id, kind, title, detail, credential.holder, issuedAt, credential.expiresAt ?? null, 'Activa', issuedAt, JSON.stringify(credential))
  const code = newCode()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  db.prepare('insert into credential_deliveries (code, credential_id, expires_at) values (?, ?, ?)').run(code, credential.id, expiresAt)
  return reply.code(201).send({ credential, delivery: { code, expiresAt } })
})

app.post<{ Params: { code: string }; Body: { walletPublicKey: string; holderSignature: string } }>('/api/deliveries/:code/claim', async (request, reply) => {
  const delivery = db.prepare('select credential_id, expires_at, used_at from credential_deliveries where code = ?').get(request.params.code) as { credential_id: string; expires_at: string; used_at: string | null } | undefined
  if (!delivery) return reply.code(404).send({ message: 'El QR de entrega no existe o ya no está disponible.' })
  if (delivery.used_at) return reply.code(409).send({ message: 'Este QR ya fue utilizado.' })
  if (Date.parse(delivery.expires_at) <= Date.now()) return reply.code(410).send({ message: 'El QR de entrega venció. Generá uno nuevo desde Emisor.' })
  const credentialRow = db.prepare('select credential_json from credentials where id = ?').get(delivery.credential_id) as { credential_json: string } | undefined
  if (!credentialRow?.credential_json) return reply.code(404).send({ message: 'La credencial ya no está disponible.' })
  const credential = JSON.parse(credentialRow.credential_json) as SignedCredential
  const { walletPublicKey, holderSignature } = request.body ?? {}
  if (!walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Falta la prueba de posesión de la billetera.' })
  try {
    const walletKey = createPublicKey({ key: Buffer.from(walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(`claim.${request.params.code}.${credential.holder}`), walletKey, Buffer.from(holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const binding = db.prepare('select public_key from wallet_bindings where holder = ?').get(credential.holder) as { public_key: string } | undefined
  if (binding && binding.public_key !== walletPublicKey) return reply.code(409).send({ message: 'Esta credencial está vinculada a otra billetera.' })
  const claim = db.transaction(() => {
    const updated = db.prepare('update credential_deliveries set used_at = ? where code = ? and used_at is null').run(new Date().toISOString(), request.params.code)
    if (!updated.changes) return null
    db.prepare('insert or ignore into wallet_bindings (holder, public_key, created_at) values (?, ?, ?)').run(credential.holder, walletPublicKey, new Date().toISOString())
    return credentialRow
  })()
  if (!claim) return reply.code(409).send({ message: 'Este QR ya fue utilizado.' })
  return { credential: JSON.parse(claim.credential_json) as SignedCredential }
})

app.post<{ Params: { id: string } }>('/api/credentials/:id/revoke', async (request, reply) => {
  const result = db.prepare('update credentials set status = ? where id = ?').run('Revocada', request.params.id)
  if (!result.changes) return reply.code(404).send({ message: 'Credencial inexistente' })
  return { id: request.params.id, status: 'Revocada' }
})

app.post<{ Body: { kind: string; minutes?: number } }>('/api/presentation-requests', async (request, reply) => {
  if (!request.body?.kind) return reply.code(400).send({ message: 'Indicá el tipo de credencial requerido.' })
  const code = newCode()
  const minutes = Math.min(Math.max(request.body.minutes ?? 2, 1), 5)
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString()
  db.prepare('insert into presentation_requests (code, kind, expires_at) values (?, ?, ?)').run(code, request.body.kind, expiresAt)
  return reply.code(201).send({ code, kind: request.body.kind, expiresAt })
})

app.get<{ Params: { code: string } }>('/api/presentation-requests/:code', async (request, reply) => {
  const row = db.prepare('select kind, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; expiresAt: string; status: string } | undefined
  if (!row) return reply.code(404).send({ message: 'La solicitud no existe.' })
  if (Date.parse(row.expiresAt) <= Date.now() || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue utilizada.' })
  return row
})

app.post<{ Params: { code: string }; Body: { credential: SignedCredential; walletPublicKey: string; holderSignature: string } }>('/api/presentation-requests/:code/respond', async (request, reply) => {
  const row = db.prepare('select kind, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; expiresAt: string; status: string } | undefined
  if (!row || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue respondida.' })
  if (Date.parse(row.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La solicitud de verificación venció.' })
  const { credential, walletPublicKey, holderSignature } = request.body ?? {}
  if (!credential || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Falta la credencial o la prueba de posesión de la billetera.' })
  if (credential.type !== row.kind) return reply.code(422).send({ message: `Se solicitó ${row.kind} y se presentó ${credential.type}.` })
  if (!verifyCredential(credential)) return reply.code(422).send({ message: 'La firma del emisor no es válida.' })
  const stored = db.prepare('select status, expires_at from credentials where id = ?').get(credential.id) as { status: string; expires_at: string | null } | undefined
  if (!stored || stored.status !== 'Activa') return reply.code(422).send({ message: 'La credencial fue revocada o no figura en el registro del emisor.' })
  if ((stored.expires_at && Date.parse(stored.expires_at) <= Date.now()) || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())) return reply.code(422).send({ message: 'La credencial venció.' })
  try {
    const binding = db.prepare('select public_key from wallet_bindings where holder = ?').get(credential.holder) as { public_key: string } | undefined
    if (!binding || binding.public_key !== walletPublicKey) return reply.code(422).send({ message: 'Esta credencial no está vinculada a esta billetera.' })
    const proofKey = createPublicKey({ key: Buffer.from(walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    const proofMessage = `${request.params.code}.${credential.id}.${credential.holder}`
    if (!verify(null, Buffer.from(proofMessage), proofKey, Buffer.from(holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const result = { valid: true, credentialId: credential.id, title: credential.claims.titulo, kind: credential.type, verifiedAt: new Date().toISOString() }
  const changed = db.prepare('update presentation_requests set status = ?, result_json = ? where code = ? and status = ?').run('Respondida', JSON.stringify(result), request.params.code, 'Abierta')
  if (!changed.changes) return reply.code(409).send({ message: 'La solicitud ya fue respondida.' })
  return result
})

app.get<{ Params: { code: string } }>('/api/presentation-requests/:code/result', async (request, reply) => {
  const row = db.prepare('select status, result_json as resultJson from presentation_requests where code = ?').get(request.params.code) as { status: string; resultJson: string | null } | undefined
  if (!row) return reply.code(404).send({ message: 'La solicitud no existe.' })
  if (row.status !== 'Respondida' || !row.resultJson) return { status: row.status }
  return { status: row.status, result: JSON.parse(row.resultJson) }
})

app.post<{ Body: { subject: string; section?: string; minutes?: number } }>('/api/attendance/sessions', async (request, reply) => {
  const id = newCode()
  const minutes = Math.min(Math.max(request.body.minutes ?? 1, 1), 5)
  const session = { id, subject: request.body.subject, section: request.body.section ?? 'Comisión A', expiresAt: new Date(Date.now() + minutes * 60_000).toISOString() }
  db.prepare('insert into attendance_sessions (id, subject, section, expires_at) values (@id, @subject, @section, @expiresAt)').run(session)
  return reply.code(201).send({ ...session, status: 'Abierta' })
})

app.get<{ Params: { id: string } }>('/api/attendance/sessions/:id', async (request, reply) => {
  const session = db.prepare('select id, subject, section, expires_at as expiresAt, status from attendance_sessions where id = ?').get(request.params.id) as AttendanceSessionRow | undefined
  if (!session || session.status !== 'Abierta' || Date.parse(session.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La sesión de asistencia venció o fue cerrada.' })
  return session
})

app.post<{ Params: { id: string }; Body: { holder?: string; walletPublicKey?: string; holderSignature?: string } }>('/api/attendance/sessions/:id/check-in', async (request, reply) => {
  const session = db.prepare('select * from attendance_sessions where id = ?').get(request.params.id) as { expires_at: string; status: string } | undefined
  if (!session || session.status !== 'Abierta') return reply.code(404).send({ message: 'Sesión no disponible.' })
  if (Date.parse(session.expires_at) <= Date.now()) return reply.code(410).send({ message: 'La sesión venció.' })
  if (!request.body?.walletPublicKey || !request.body?.holderSignature) return reply.code(400).send({ message: 'Falta la prueba firmada de la billetera.' })
  try {
    const holder = request.body.holder ?? 'did:demo:estudiante'
    const binding = db.prepare('select public_key from wallet_bindings where holder = ?').get(holder) as { public_key: string } | undefined
    if (!binding || binding.public_key !== request.body.walletPublicKey) return reply.code(422).send({ message: 'Esta sesión no pertenece a la billetera vinculada.' })
    const proofKey = createPublicKey({ key: Buffer.from(request.body.walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    const proofMessage = `attendance.${request.params.id}.${holder}`
    if (!verify(null, Buffer.from(proofMessage), proofKey, Buffer.from(request.body.holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  try {
    db.prepare('insert into attendance_records (id, session_id, holder, recorded_at) values (?, ?, ?, ?)').run(randomUUID(), request.params.id, request.body.holder ?? 'did:demo:estudiante', new Date().toISOString())
    return { id: request.params.id, registered: true }
  } catch { return reply.code(409).send({ message: 'Esta billetera ya registró asistencia en la sesión.' }) }
})

app.get<{ Params: { id: string } }>('/api/attendance/sessions/:id/records', async (request) => db.prepare('select holder, recorded_at as recordedAt from attendance_records where session_id = ? order by recorded_at').all(request.params.id))
app.post<{ Params: { id: string } }>('/api/attendance/sessions/:id/close', async (request, reply) => {
  const updated = db.prepare('update attendance_sessions set status = ? where id = ? and status = ?').run('Cerrada', request.params.id, 'Abierta')
  if (!updated.changes) return reply.code(404).send({ message: 'La sesión ya estaba cerrada o no existe.' })
  return { id: request.params.id, status: 'Cerrada' }
})

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
