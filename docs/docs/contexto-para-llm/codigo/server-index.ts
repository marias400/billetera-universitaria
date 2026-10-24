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
const attendanceFilePath = join(dataDir, 'planilla-asistencia.csv')
const teacherName = 'Marcelo Roldan'
const courseName = 'Seminario de Actualización II'
const demoStudents = [
  { id: 'mariano-arias-simone', fullName: 'Mariano Arias Simone', enrollmentNumber: 'DEMO-ISI-001' },
  { id: 'peralta-herrar-nahuel', fullName: 'Peralta Herrera Nahuel', enrollmentNumber: 'DEMO-ISI-002' },
]
type DemoRole = 'student' | 'teacher' | 'institutional'
type DemoActor = { id: string; role: DemoRole; name: string; scope?: 'academic' | 'library' | 'gym'; studentId?: string }
const demoAccounts: Record<string, { password: string; actor: DemoActor }> = {
  'student-mariano': { password: 'demo2026', actor: { id: 'student-mariano', role: 'student', name: demoStudents[0].fullName, studentId: demoStudents[0].id } },
  'student-nahuel': { password: 'demo2026', actor: { id: 'student-nahuel', role: 'student', name: demoStudents[1].fullName, studentId: demoStudents[1].id } },
  'teacher-marcelo': { password: 'demo2026', actor: { id: 'teacher-marcelo', role: 'teacher', name: teacherName } },
  'admin-academic': { password: 'demo2026', actor: { id: 'admin-academic', role: 'institutional', name: 'Administración académica', scope: 'academic' } },
  'admin-library': { password: 'demo2026', actor: { id: 'admin-library', role: 'institutional', name: 'Administración de Biblioteca', scope: 'library' } },
  'admin-gym': { password: 'demo2026', actor: { id: 'admin-gym', role: 'institutional', name: 'Administración de Gimnasio', scope: 'gym' } },
}
const activeSessions = new Map<string, DemoActor>()
mkdirSync(dataDir, { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec([
  'create table if not exists credentials (id text primary key, kind text not null, title text not null, detail text not null, holder text not null, issued_at text not null, expires_at text, status text not null default "Activa", created_at text not null);',
  'create table if not exists attendance_sessions (id text primary key, subject text not null, section text not null, expires_at text not null, status text not null default "Abierta", created_at text not null);',
  'create table if not exists attendance_records (id text primary key, session_id text not null references attendance_sessions(id), holder text not null, recorded_at text not null, student_id text, student_name text, unique(session_id, holder));',
  'create table if not exists students (id text primary key, full_name text not null unique, wallet_public_key text unique, created_at text not null);',
  'create table if not exists credential_deliveries (code text primary key, credential_id text not null, expires_at text not null, used_at text);',
  'create table if not exists presentation_requests (code text primary key, kind text not null, expires_at text not null, status text not null default "Abierta", result_json text);',
  'create table if not exists wallet_bindings (holder text primary key, public_key text not null, created_at text not null);',
].join('\n'))

const studentColumns = db.prepare('pragma table_info(students)').all() as { name: string }[]
if (!studentColumns.some((column) => column.name === 'enrollment_number')) db.exec('alter table students add column enrollment_number text')
if (!studentColumns.some((column) => column.name === 'identity_locked')) db.exec('alter table students add column identity_locked integer not null default 1')

const columns = db.prepare('pragma table_info(credentials)').all() as { name: string }[]
if (!columns.some((column) => column.name === 'credential_json')) db.exec('alter table credentials add column credential_json text')

const sessionColumns = db.prepare('pragma table_info(attendance_sessions)').all() as { name: string }[]
if (!sessionColumns.some((column) => column.name === 'created_at')) {
  db.exec('alter table attendance_sessions add column created_at text')
  db.exec("update attendance_sessions set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '-1 minute') where created_at is null")
}
const attendanceColumns = db.prepare('pragma table_info(attendance_records)').all() as { name: string }[]
if (!attendanceColumns.some((column) => column.name === 'student_id')) db.exec('alter table attendance_records add column student_id text')
if (!attendanceColumns.some((column) => column.name === 'student_name')) db.exec('alter table attendance_records add column student_name text')

for (const student of demoStudents) {
  db.prepare('insert or ignore into students (id, full_name, enrollment_number, identity_locked, created_at) values (?, ?, ?, 1, ?)').run(student.id, student.fullName, student.enrollmentNumber, new Date().toISOString())
  db.prepare('update students set full_name = ?, enrollment_number = ?, identity_locked = 1 where id = ?').run(student.fullName, student.enrollmentNumber, student.id)
}
db.prepare('update attendance_records set student_id = ?, student_name = ? where student_id is null and holder = ?')
  .run(demoStudents[0].id, demoStudents[0].fullName, 'did:demo:estudiante')
const legacyWalletBinding = db.prepare('select public_key from wallet_bindings where holder = ?').get('did:demo:estudiante') as { public_key: string } | undefined
if (legacyWalletBinding) {
  db.prepare('update students set wallet_public_key = ? where id = ? and wallet_public_key is null')
    .run(legacyWalletBinding.public_key, demoStudents[0].id)
}

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

function dateKey(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/La_Rioja', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function dateLabel(key: string) {
  const [year, month, day] = key.split('-')
  return `${day}/${month}/${year}`
}

function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

function getAttendanceRoster() {
  const sessions = db.prepare('select created_at as createdAt, expires_at as expiresAt from attendance_sessions').all() as { createdAt: string | null; expiresAt: string }[]
  const dateKeys = [...new Set(sessions.map((session) => dateKey(session.createdAt ?? session.expiresAt)))].sort()
  const students = db.prepare('select id, full_name as fullName from students order by id').all() as { id: string; fullName: string }[]
  const records = db.prepare('select student_id as studentId, recorded_at as recordedAt from attendance_records where student_id is not null').all() as { studentId: string; recordedAt: string }[]
  const present = new Set(records.map((record) => `${record.studentId}|${dateKey(record.recordedAt)}`))
  return {
    teacherName,
    courseName,
    dates: dateKeys.map((key) => ({ key, label: dateLabel(key) })),
    students: students.map((student) => ({
      ...student,
      attendance: Object.fromEntries(dateKeys.map((key) => [key, present.has(`${student.id}|${key}`) ? 'P' : 'A'])),
    })),
  }
}

function regenerateAttendanceFile() {
  const roster = getAttendanceRoster()
  const rows = [
    ['Profesor', 'Materia', 'Estudiante', ...roster.dates.map((date) => date.label)],
    ...roster.students.map((student) => [
      roster.teacherName,
      roster.courseName,
      student.fullName,
      ...roster.dates.map((date) => student.attendance[date.key] ?? 'A'),
    ]),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
  writeFileSync(attendanceFilePath, csv, 'utf8')
  return csv
}

regenerateAttendanceFile()

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 })
await app.register(cors, { origin: true })
app.get('/health', async () => ({ ok: true, service: 'billetera-universitaria-api' }))
app.post<{ Body: { account: string; password: string } }>('/api/demo/login', async (request, reply) => {
  const entry = demoAccounts[request.body?.account]
  if (!entry || request.body?.password !== entry.password) return reply.code(401).send({ message: 'Usuario o contraseña incorrectos.' })
  const token = randomBytes(32).toString('base64url')
  activeSessions.set(token, entry.actor)
  return { token, actor: entry.actor, demoOnly: true }
})
app.addHook('preHandler', async (request, reply) => {
  if (!request.url.startsWith('/api/') || request.url === '/api/demo/login') return
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token || !activeSessions.has(token)) return reply.code(401).send({ message: 'Iniciá sesión para continuar.' })
})
function actorFor(request: { headers: { authorization?: string } }) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  return token ? activeSessions.get(token) : undefined
}
function requireRole(request: { headers: { authorization?: string } }, reply: { code: (status: number) => { send: (body: { message: string }) => unknown } }, roles: DemoRole[]) {
  const actor = actorFor(request)
  if (!actor || !roles.includes(actor.role)) {
    reply.code(403).send({ message: 'Tu usuario no tiene permiso para esta acción.' })
    return undefined
  }
  return actor
}
app.get('/api/demo/me', async (request, reply) => {
  const actor = actorFor(request)
  if (!actor) return reply.code(401).send({ message: 'La sesión venció.' })
  return { actor, demoOnly: true }
})
app.get('/api/issuer-key', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'teacher', 'institutional'])) return
  return { keyId: issuerId, algorithm: 'Ed25519', publicKeyPem: issuerPublicPem }
})
app.get('/api/credentials', async (request, reply) => {
  const actor = requireRole(request, reply, ['student', 'teacher', 'institutional'])
  if (!actor) return
  const columns = "id, kind, title, detail, holder, issued_at as issuedAt, expires_at as expiresAt, status, created_at as createdAt, json_extract(credential_json, '$.claims.nombreEstudiante') as studentName, json_extract(credential_json, '$.claims.matricula') as enrollmentNumber"
  if (actor.role === 'student') return db.prepare(`select ${columns} from credentials where holder = ? or holder in (select holder from wallet_bindings where public_key = (select wallet_public_key from students where id = ?)) order by created_at desc`).all(`did:unlar:student:${actor.studentId}`, actor.studentId)
  if (actor.role === 'teacher') return []
  const allowed = actor.scope === 'library' ? ['Biblioteca'] : actor.scope === 'gym' ? ['Gimnasio'] : ['Regularidad', 'Materia aprobada', 'Nota de materia']
  return db.prepare(`select ${columns} from credentials where kind in (${allowed.map(() => '?').join(',')}) order by created_at desc`).all(...allowed)
})
app.get('/api/students', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'teacher', 'institutional'])) return
  const actor = actorFor(request)
  const rows = db.prepare('select id, full_name as fullName, enrollment_number as enrollmentNumber, identity_locked as identityLocked, wallet_public_key as walletPublicKey from students order by id').all() as { id: string; fullName: string; enrollmentNumber: string; identityLocked: number; walletPublicKey: string | null }[]
  const profiles = rows.map(({ walletPublicKey, ...student }) => ({ ...student, walletLinked: Boolean(walletPublicKey) }))
  return actor?.role === 'student' ? profiles.filter((student) => student.id === actor.studentId) : profiles
})

app.post<{ Body: { fullName?: string; walletPublicKey: string; holderSignature: string } }>('/api/students/register', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const { walletPublicKey, holderSignature } = request.body ?? {}
  const student = db.prepare('select id, full_name as fullName, enrollment_number as enrollmentNumber, wallet_public_key as walletPublicKey from students where id = ?').get(actor.studentId) as { id: string; fullName: string; enrollmentNumber: string; walletPublicKey: string | null } | undefined
  if (!student || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'No se pudo validar el perfil del estudiante.' })
  if (request.body.fullName && request.body.fullName.trim() !== student.fullName) return reply.code(403).send({ message: 'El nombre y la matrícula están asociados al perfil y no se pueden editar desde la billetera.' })
  if (student.walletPublicKey && student.walletPublicKey !== walletPublicKey) return reply.code(409).send({ message: 'Este perfil ya está vinculado a otra billetera.' })
  try {
    const publicKey = createPublicKey({ key: Buffer.from(walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    const message = `student.${student.id}.${student.enrollmentNumber}`
    if (!verify(null, Buffer.from(message), publicKey, Buffer.from(holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  try { db.prepare('update students set wallet_public_key = ? where id = ? and (wallet_public_key is null or wallet_public_key = ?)').run(walletPublicKey, student.id, walletPublicKey) }
  catch { return reply.code(409).send({ message: 'Esta billetera ya está vinculada a otro perfil.' }) }
  const holder = `did:unlar:student:${student.id}`
  const existingBinding = db.prepare('select public_key from wallet_bindings where holder = ?').get(holder) as { public_key: string } | undefined
  if (existingBinding && existingBinding.public_key !== walletPublicKey) return reply.code(409).send({ message: 'El perfil ya está vinculado a otra billetera.' })
  db.prepare('insert or ignore into wallet_bindings (holder, public_key, created_at) values (?, ?, ?)').run(holder, walletPublicKey, new Date().toISOString())
  regenerateAttendanceFile()
  return { id: student.id, fullName: student.fullName, enrollmentNumber: student.enrollmentNumber, identityLocked: true, walletLinked: true }
})

app.get('/api/attendance/roster', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher', 'institutional'])) return
  return getAttendanceRoster()
})
app.get('/api/attendance/export.csv', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher', 'institutional'])) return
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="planilla-asistencia.csv"')
    .send(regenerateAttendanceFile())
})

app.post<{ Body: { kind: string; title: string; detail?: string; grade?: number; holder?: string; studentId?: string; expiresAt?: string | null } }>('/api/credentials', async (request, reply) => {
  const actor = requireRole(request, reply, ['institutional'])
  if (!actor) return
  const { kind, title } = request.body ?? {}
  if (!kind || !title?.trim()) return reply.code(400).send({ message: 'Completá el tipo y la materia o el servicio.' })
  if (kind === 'Nota de materia' && (!Number.isFinite(request.body.grade) || (request.body.grade as number) < 1 || (request.body.grade as number) > 10)) return reply.code(400).send({ message: 'Ingresá una nota válida entre 1 y 10.' })
  const detail = kind === 'Nota de materia' ? `Nota: ${request.body.grade}` : request.body.detail?.trim()
  if (!detail) return reply.code(400).send({ message: 'Completá el detalle de la credencial.' })
  const permittedKinds: Record<string, string[]> = { academic: ['Regularidad', 'Materia aprobada', 'Nota de materia'], library: ['Biblioteca'], gym: ['Gimnasio'] }
  if (!actor.scope || !permittedKinds[actor.scope]?.includes(kind)) return reply.code(403).send({ message: 'Este usuario institucional no puede emitir ese tipo de credencial.' })
  const studentId = request.body.studentId ?? demoStudents[0].id
  const student = db.prepare('select id, full_name as fullName, enrollment_number as enrollmentNumber from students where id = ?').get(studentId) as { id: string; fullName: string; enrollmentNumber: string } | undefined
  if (!student) return reply.code(404).send({ message: 'Elegí un estudiante válido.' })
  const issuedAt = new Date().toISOString()
  const credential = signCredential({
    id: randomUUID(), type: kind, issuer: 'did:web:unlar.edu.ar:prototipo', holder: `did:unlar:student:${student.id}`,
    claims: { titulo: title.trim(), detalle: detail, ...(kind === 'Nota de materia' ? { nota: String(request.body.grade) } : {}), estudianteId: student.id, matricula: student.enrollmentNumber, nombreEstudiante: student.fullName }, issuedAt, ...(request.body.expiresAt ? { expiresAt: request.body.expiresAt } : {}),
  })
  db.prepare('insert into credentials (id, kind, title, detail, holder, issued_at, expires_at, status, created_at, credential_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(credential.id, kind, title.trim(), detail, credential.holder, issuedAt, credential.expiresAt ?? null, 'Activa', issuedAt, JSON.stringify(credential))
  const code = newCode()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  db.prepare('insert into credential_deliveries (code, credential_id, expires_at) values (?, ?, ?)').run(code, credential.id, expiresAt)
  return reply.code(201).send({ credential, delivery: { code, expiresAt } })
})

app.post<{ Params: { code: string }; Body: { walletPublicKey: string; holderSignature: string } }>('/api/deliveries/:code/claim', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const delivery = db.prepare('select credential_id, expires_at, used_at from credential_deliveries where code = ?').get(request.params.code) as { credential_id: string; expires_at: string; used_at: string | null } | undefined
  if (!delivery) return reply.code(404).send({ message: 'El QR de entrega no existe o ya no está disponible.' })
  if (delivery.used_at) return reply.code(409).send({ message: 'Este QR ya fue utilizado.' })
  if (Date.parse(delivery.expires_at) <= Date.now()) return reply.code(410).send({ message: 'El QR de entrega venció. Generá uno nuevo desde Emisor.' })
  const credentialRow = db.prepare('select credential_json from credentials where id = ?').get(delivery.credential_id) as { credential_json: string } | undefined
  if (!credentialRow?.credential_json) return reply.code(404).send({ message: 'La credencial ya no está disponible.' })
  const credential = JSON.parse(credentialRow.credential_json) as SignedCredential
  if (credential.claims.estudianteId !== actor.studentId || credential.holder !== `did:unlar:student:${actor.studentId}`) return reply.code(403).send({ message: 'Esta credencial fue emitida para otro perfil de estudiante.' })
  const { walletPublicKey, holderSignature } = request.body ?? {}
  if (!walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Falta la prueba de posesión de la billetera.' })
  try {
    const walletKey = createPublicKey({ key: Buffer.from(walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(`claim.${request.params.code}.${credential.holder}`), walletKey, Buffer.from(holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const studentBinding = db.prepare('select wallet_public_key as walletPublicKey from students where id = ?').get(actor.studentId) as { walletPublicKey: string | null } | undefined
  if (!studentBinding?.walletPublicKey || studentBinding.walletPublicKey !== walletPublicKey) return reply.code(403).send({ message: 'Vinculá primero esta billetera al perfil de estudiante correspondiente.' })
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
  const actor = requireRole(request, reply, ['institutional'])
  if (!actor) return
  const credential = db.prepare('select kind from credentials where id = ?').get(request.params.id) as { kind: string } | undefined
  const permittedKinds: Record<string, string[]> = { academic: ['Regularidad', 'Materia aprobada', 'Nota de materia'], library: ['Biblioteca'], gym: ['Gimnasio'] }
  if (credential && (!actor.scope || !permittedKinds[actor.scope]?.includes(credential.kind))) return reply.code(403).send({ message: 'No tenés permiso para revocar esta credencial.' })
  const result = db.prepare('update credentials set status = ? where id = ?').run('Revocada', request.params.id)
  if (!result.changes) return reply.code(404).send({ message: 'Credencial inexistente' })
  return { id: request.params.id, status: 'Revocada' }
})

app.post<{ Body: { kind: string; minutes?: number } }>('/api/presentation-requests', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher', 'institutional'])) return
  if (!request.body?.kind) return reply.code(400).send({ message: 'Indicá el tipo de credencial requerido.' })
  const code = newCode()
  const minutes = Math.min(Math.max(request.body.minutes ?? 2, 1), 5)
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString()
  db.prepare('insert into presentation_requests (code, kind, expires_at) values (?, ?, ?)').run(code, request.body.kind, expiresAt)
  return reply.code(201).send({ code, kind: request.body.kind, expiresAt })
})

app.get<{ Params: { code: string } }>('/api/presentation-requests/:code', async (request, reply) => {
  if (!requireRole(request, reply, ['student'])) return
  const row = db.prepare('select kind, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; expiresAt: string; status: string } | undefined
  if (!row) return reply.code(404).send({ message: 'La solicitud no existe.' })
  if (Date.parse(row.expiresAt) <= Date.now() || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue utilizada.' })
  return { code: request.params.code, ...row }
})

app.post<{ Params: { code: string }; Body: { credential: SignedCredential; walletPublicKey: string; holderSignature: string } }>('/api/presentation-requests/:code/respond', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const row = db.prepare('select kind, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; expiresAt: string; status: string } | undefined
  if (!row || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue respondida.' })
  if (Date.parse(row.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La solicitud de verificación venció.' })
  const { credential, walletPublicKey, holderSignature } = request.body ?? {}
  if (!credential || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Falta la credencial o la prueba de posesión de la billetera.' })
  if (credential.type !== row.kind) return reply.code(422).send({ message: `Se solicitó ${row.kind} y se presentó ${credential.type}.` })
  if (credential.claims.estudianteId !== actor.studentId || credential.holder !== `did:unlar:student:${actor.studentId}`) return reply.code(403).send({ message: 'Esta credencial no pertenece al perfil de estudiante activo.' })
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
  if (!requireRole(request, reply, ['teacher', 'institutional'])) return
  const row = db.prepare('select status, result_json as resultJson from presentation_requests where code = ?').get(request.params.code) as { status: string; resultJson: string | null } | undefined
  if (!row) return reply.code(404).send({ message: 'La solicitud no existe.' })
  if (row.status !== 'Respondida' || !row.resultJson) return { status: row.status }
  return { status: row.status, result: JSON.parse(row.resultJson) }
})

app.post<{ Body: { subject: string; section?: string; minutes?: number } }>('/api/attendance/sessions', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher'])) return
  const id = newCode()
  const minutes = Math.min(Math.max(request.body.minutes ?? 1, 1), 5)
  const createdAt = new Date().toISOString()
  const session = { id, subject: request.body.subject, section: request.body.section ?? 'Comisión A', createdAt, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString() }
  db.prepare('insert into attendance_sessions (id, subject, section, expires_at, created_at) values (@id, @subject, @section, @expiresAt, @createdAt)').run(session)
  regenerateAttendanceFile()
  return reply.code(201).send({ ...session, status: 'Abierta' })
})

app.get<{ Params: { id: string } }>('/api/attendance/sessions/:id', async (request, reply) => {
  if (!requireRole(request, reply, ['student'])) return
  const session = db.prepare('select id, subject, section, expires_at as expiresAt, status from attendance_sessions where id = ?').get(request.params.id) as AttendanceSessionRow | undefined
  if (!session || session.status !== 'Abierta' || Date.parse(session.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La sesión de asistencia venció o fue cerrada.' })
  return session
})

app.post<{ Params: { id: string }; Body: { studentId?: string; walletPublicKey?: string; holderSignature?: string } }>('/api/attendance/sessions/:id/check-in', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const session = db.prepare('select * from attendance_sessions where id = ?').get(request.params.id) as { expires_at: string; status: string } | undefined
  if (!session || session.status !== 'Abierta') return reply.code(404).send({ message: 'Sesión no disponible.' })
  if (Date.parse(session.expires_at) <= Date.now()) return reply.code(410).send({ message: 'La sesión venció.' })
  const { walletPublicKey, holderSignature } = request.body ?? {}
  const studentId = actor.studentId
  if (!studentId || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Completá tus datos y registrá la billetera antes de marcar asistencia.' })
  const student = db.prepare('select id, full_name as fullName, wallet_public_key as walletPublicKey from students where id = ?').get(studentId) as { id: string; fullName: string; walletPublicKey: string | null } | undefined
  if (!student) return reply.code(404).send({ message: 'No se encontró el perfil del estudiante.' })
  try {
    const proofKey = createPublicKey({ key: Buffer.from(walletPublicKey, 'base64'), format: 'der', type: 'spki' })
    const proofMessage = `attendance.${request.params.id}.${student.id}`
    if (!verify(null, Buffer.from(proofMessage), proofKey, Buffer.from(holderSignature, 'base64url'))) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  try {
    db.prepare('insert into attendance_records (id, session_id, holder, recorded_at, student_id, student_name) values (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), request.params.id, student.id, new Date().toISOString(), student.id, student.fullName)
    regenerateAttendanceFile()
    return { id: request.params.id, registered: true }
  } catch { return reply.code(409).send({ message: 'Esta billetera ya registró asistencia en la sesión.' }) }
})

app.get<{ Params: { id: string } }>('/api/attendance/sessions/:id/records', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher'])) return
  return db.prepare('select holder, student_id as studentId, coalesce(student_name, ?) as studentName, recorded_at as recordedAt from attendance_records where session_id = ? order by recorded_at').all(demoStudents[0].fullName, request.params.id)
})
app.post<{ Params: { id: string } }>('/api/attendance/sessions/:id/close', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher'])) return
  const updated = db.prepare('update attendance_sessions set status = ? where id = ? and status = ?').run('Cerrada', request.params.id, 'Abierta')
  if (!updated.changes) return reply.code(404).send({ message: 'La sesión ya estaba cerrada o no existe.' })
  return { id: request.params.id, status: 'Cerrada' }
})

const port = Number(process.env.PORT ?? 4001)
const host = process.env.HOST ?? '127.0.0.1'
await app.listen({ port, host })
