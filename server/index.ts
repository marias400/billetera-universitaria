import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { SessionStore, verifyPassword } from './access.ts'
import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cloudMode = process.env.APP_MODE === 'cloud'
const dataDir = process.env.DATA_DIR || join(root, 'data')
const databasePath = join(dataDir, 'billetera.sqlite')
const privateKeyPath = join(dataDir, 'issuer-ml-dsa-65.json')
const attendanceFilePath = join(dataDir, 'planilla-asistencia.csv')
const classPhotoPath = join(dataDir, 'foto-clase.jpg')
const teacherName = 'Marcelo Roldan'
const courseName = 'Seminario de Actualización II'
const demoStudents = [
  { id: 'mariano-arias-simone', fullName: 'Mariano Arias Simone', enrollmentNumber: 'DEMO-ISI-001' },
  { id: 'peralta-herrar-nahuel', fullName: 'Peralta Herrera Nahuel', enrollmentNumber: 'DEMO-ISI-002' },
]
type DemoRole = 'student' | 'teacher' | 'institutional' | 'photographer' | 'demo-tools'
type DemoActor = { id: string; role: DemoRole; name: string; scope?: 'academic' | 'library' | 'gym'; studentId?: string }
const hasPhotographerAccess = (actor: DemoActor) => actor.role === 'teacher' || (!cloudMode && (actor.role === 'photographer' || actor.studentId === 'mariano-arias-simone'))
const isPhotographerName = (name: string) => {
  if (cloudMode) return false
  const normalizedName = name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return normalizedName === 'fotografo' || normalizedName === 'fotografa'
}
const demoAccounts: Record<string, { password: string; actor: DemoActor }> = {
  'student-mariano': { password: 'demo2026', actor: { id: 'student-mariano', role: 'student', name: demoStudents[0].fullName, studentId: demoStudents[0].id } },
  'student-nahuel': { password: 'demo2026', actor: { id: 'student-nahuel', role: 'student', name: demoStudents[1].fullName, studentId: demoStudents[1].id } },
  'teacher-marcelo': { password: 'demo2026', actor: { id: 'teacher-marcelo', role: 'teacher', name: teacherName } },
  'admin-academic': { password: 'demo2026', actor: { id: 'admin-academic', role: 'institutional', name: 'Administración académica', scope: 'academic' } },
  'admin-library': { password: 'demo2026', actor: { id: 'admin-library', role: 'institutional', name: 'Administración de Biblioteca', scope: 'library' } },
  'admin-gym': { password: 'demo2026', actor: { id: 'admin-gym', role: 'institutional', name: 'Administración de Gimnasio', scope: 'gym' } },
  'demo-tools': { password: 'demo2026', actor: { id: 'demo-tools', role: 'demo-tools', name: 'Herramientas Demo' } },
}
const passwordHashes: Record<string, string> = JSON.parse(process.env.ACCESS_PASSWORD_HASHES ?? '{}')
if (cloudMode && ['teacher-marcelo', 'admin-academic', 'admin-library', 'admin-gym', 'demo-tools'].some((id) => !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(passwordHashes[id] ?? ''))) {
  throw new Error('En modo cloud configurá ACCESS_PASSWORD_HASHES para todas las cuentas institucionales y docentes.')
}
const activeSessions = new SessionStore<DemoActor>()
const loginAttempts = new Map<string, { count: number; until: number }>()
const cleanupTimer = setInterval(() => {
  activeSessions.cleanup()
  for (const [ip, attempt] of loginAttempts) if (attempt.until <= Date.now()) loginAttempts.delete(ip)
}, 60_000)
cleanupTimer.unref()
mkdirSync(dataDir, { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec([
  'create table if not exists credentials (id text primary key, kind text not null, title text not null, detail text not null, holder text not null, issued_at text not null, expires_at text, status text not null default "Activa", created_at text not null);',
  'create table if not exists attendance_sessions (id text primary key, subject text not null, section text not null, expires_at text not null, status text not null default "Abierta", created_at text not null);',
  'create table if not exists attendance_records (id text primary key, session_id text not null references attendance_sessions(id), holder text not null, recorded_at text not null, student_id text, student_name text, unique(session_id, holder));',
  'create table if not exists students (id text primary key, full_name text not null, wallet_public_key text unique, created_at text not null);',
  'create table if not exists credential_deliveries (code text primary key, credential_id text not null, expires_at text not null, used_at text);',
  'create table if not exists reward_sessions (code text primary key, title text not null, detail text not null, expires_at text not null, created_at text not null);',
  'create table if not exists reward_claims (code text not null references reward_sessions(code), student_id text not null references students(id), credential_id text not null references credentials(id), primary key(code, student_id));',
  'create table if not exists presentation_requests (code text primary key, kind text not null, subject text, minimum_grade real, request_note text, expires_at text not null, status text not null default "Abierta", result_json text);',
  'create table if not exists wallet_bindings (holder text primary key, public_key text not null, created_at text not null);',
  'create table if not exists raffle_prize_requests (id text primary key, student_id text not null references students(id), student_name text not null, place integer not null, email text, created_at text not null, answered_at text, unique(student_id, created_at));',
].join('\n'))

const studentColumns = db.prepare('pragma table_info(students)').all() as { name: string }[]
if (!studentColumns.some((column) => column.name === 'enrollment_number')) db.exec('alter table students add column enrollment_number text')
if (!studentColumns.some((column) => column.name === 'identity_locked')) db.exec('alter table students add column identity_locked integer not null default 1')
const uniqueNameIndex = (db.prepare('pragma index_list(students)').all() as { name: string; unique: number }[]).find((index) => index.unique && (db.prepare(`pragma index_info(${index.name})`).all() as { name: string }[]).some((column) => column.name === 'full_name'))
if (uniqueNameIndex) {
  db.exec('create table students_new (id text primary key, full_name text not null, wallet_public_key text unique, created_at text not null, enrollment_number text, identity_locked integer not null default 1);')
  db.exec('insert into students_new (id, full_name, wallet_public_key, created_at, enrollment_number, identity_locked) select id, full_name, wallet_public_key, created_at, enrollment_number, identity_locked from students; drop table students; alter table students_new rename to students;')
}

const columns = db.prepare('pragma table_info(credentials)').all() as { name: string }[]
if (!columns.some((column) => column.name === 'credential_json')) db.exec('alter table credentials add column credential_json text')

const sessionColumns = db.prepare('pragma table_info(attendance_sessions)').all() as { name: string }[]
if (!sessionColumns.some((column) => column.name === 'created_at')) {
  db.exec('alter table attendance_sessions add column created_at text')
  db.exec("update attendance_sessions set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '-1 minute') where created_at is null")
}
const presentationRequestColumns = db.prepare('pragma table_info(presentation_requests)').all() as { name: string }[]
if (!presentationRequestColumns.some((column) => column.name === 'subject')) db.exec('alter table presentation_requests add column subject text')
if (!presentationRequestColumns.some((column) => column.name === 'minimum_grade')) db.exec('alter table presentation_requests add column minimum_grade real')
if (!presentationRequestColumns.some((column) => column.name === 'request_note')) db.exec('alter table presentation_requests add column request_note text')
if (!presentationRequestColumns.some((column) => column.name === 'required_claims')) db.exec("alter table presentation_requests add column required_claims text not null default '[]'")
if (!presentationRequestColumns.some((column) => column.name === 'include_exact_grade')) db.exec('alter table presentation_requests add column include_exact_grade integer not null default 0')
const prizeRequestColumns = db.prepare('pragma table_info(raffle_prize_requests)').all() as { name: string }[]
if (!prizeRequestColumns.some((column) => column.name === 'raffle_id')) db.exec('alter table raffle_prize_requests add column raffle_id text')
if (!prizeRequestColumns.some((column) => column.name === 'retired_at')) db.exec('alter table raffle_prize_requests add column retired_at text')
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
  const pair = ml_dsa65.keygen()
  writeFileSync(privateKeyPath, JSON.stringify({ publicKey: Buffer.from(pair.publicKey).toString('base64'), secretKey: Buffer.from(pair.secretKey).toString('base64') }), { mode: 0o600, flag: 'wx' })
}
const issuerKeys = JSON.parse(readFileSync(privateKeyPath, 'utf8')) as { publicKey: string; secretKey: string }
const issuerPublicKey = Buffer.from(issuerKeys.publicKey, 'base64')
const issuerPrivateKey = Buffer.from(issuerKeys.secretKey, 'base64')
const issuerId = 'did:web:unlar.edu.ar:prototipo#issuer-ml-dsa-65-1'

function verifyWallet(message: string, publicKey: string, signature: string) {
  return ml_dsa65.verify(Buffer.from(signature, 'base64url'), Buffer.from(message), Buffer.from(publicKey, 'base64'))
}

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
type SignedCredential = CredentialPayload & { proof: { algorithm: 'ML-DSA-65'; verificationMethod: string; signature: string } }
type AttendanceSessionRow = { id: string; subject: string; section: string; expiresAt: string; status: string }

function canonicalize(value: CredentialPayload) {
  return JSON.stringify({ claims: value.claims, expiresAt: value.expiresAt, holder: value.holder, id: value.id, issuedAt: value.issuedAt, issuer: value.issuer, type: value.type })
}

function signCredential(payload: CredentialPayload): SignedCredential {
  const signature = Buffer.from(ml_dsa65.sign(Buffer.from(canonicalize(payload)), issuerPrivateKey)).toString('base64url')
  return { ...payload, proof: { algorithm: 'ML-DSA-65', verificationMethod: issuerId, signature } }
}

function verifyCredential(credential: SignedCredential) {
  if (!credential?.proof || credential.proof.algorithm !== 'ML-DSA-65' || credential.proof.verificationMethod !== issuerId) return false
  const { proof, ...payload } = credential
  try { return ml_dsa65.verify(Buffer.from(proof.signature, 'base64url'), Buffer.from(canonicalize(payload)), issuerPublicKey) } catch { return false }
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
  const fixedDates = ['2026-10-13', '2026-10-20']
  const fixedAttendance = new Map([['2026-10-13', 'mariano-arias-simone'], ['2026-10-20', 'peralta-herrar-nahuel']])
  const dateKeys = [...new Set([...sessions.map((session) => dateKey(session.createdAt ?? session.expiresAt)), ...fixedDates])].sort()
  const students = db.prepare('select id, full_name as fullName from students order by id').all() as { id: string; fullName: string }[]
  const records = db.prepare('select student_id as studentId, recorded_at as recordedAt from attendance_records where student_id is not null').all() as { studentId: string; recordedAt: string }[]
  const present = new Set(records.map((record) => `${record.studentId}|${dateKey(record.recordedAt)}`))
  return {
    teacherName,
    courseName,
    dates: dateKeys.map((key) => ({ key, label: dateLabel(key) })),
    students: students.map((student) => ({
      ...student,
      attendance: Object.fromEntries(dateKeys.map((key) => {
        const fixedStudent = fixedAttendance.get(key)
        const isPresent = fixedStudent ? student.id === fixedStudent : present.has(`${student.id}|${key}`)
        return [key, isPresent ? 'P' : 'A']
      })),
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

const app = Fastify({ logger: { level: 'warn', base: { service: 'api' } }, disableRequestLogging: true, bodyLimit: 5 * 1024 * 1024, trustProxy: cloudMode ? 1 : true })
app.addHook('onResponse', (request, reply, done) => {
  const address = (request.ip || request.socket.remoteAddress || 'desconocida').replace(/^::ffff:/, '')
  if (['127.0.0.1', '::1'].includes(address)) { done(); return }
  const route = request.routeOptions.url ?? request.url.split('?')[0].replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:qr')
  const status = reply.statusCode
  const actor = actorFor(request)
  if (route === '/api/presence') {
    const clientId = (request.body as { clientId?: string } | undefined)?.clientId
    if (clientId && /^[A-Za-z0-9_-]{12,80}$/.test(clientId)) console.log(`DEMO_CLIENT ${JSON.stringify({ id: clientId, name: actor && ['student', 'photographer'].includes(actor.role) ? actor.name : 'Visitante', ip: address, at: Date.now() })}`)
  } else {
    console.log(`DEMO_ACTIVITY ${JSON.stringify({ ip: address, name: actor && ['student', 'photographer'].includes(actor.role) ? actor.name : '', method: request.method, route, status, at: Date.now() })}`)
  }
  done()
})
if (!cloudMode) await app.register(cors, { origin: true })
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin')
  if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  return payload
})
app.get('/health', async () => ({ ok: true, service: 'billetera-universitaria-api' }))
app.get('/api/network-info', async () => {
  if (cloudMode) return { ssid: '', addresses: [] }
  let ssid = ''
  let wifiDevice = ''
  if (process.platform === 'darwin') {
    const devices: string[] = []
    try {
      const ports = execFileSync('/usr/sbin/networksetup', ['-listallhardwareports'], { encoding: 'utf8', timeout: 2000 })
      const blocks = ports.split(/\n(?=Hardware Port:)/)
      for (const block of blocks) {
        if (!/^Hardware Port:\s*(?:Wi-Fi|AirPort)\s*$/im.test(block)) continue
        wifiDevice = block.match(/^Device:\s*(\S+)/im)?.[1] ?? ''
        if (wifiDevice) devices.push(wifiDevice)
      }
    } catch { /* Continue with known macOS Wi-Fi interface names. */ }
    for (const device of [...new Set([...devices, 'en0', 'en1'])]) {
      try {
        const output = execFileSync('/usr/sbin/networksetup', ['-getairportnetwork', device], { encoding: 'utf8', timeout: 1500 }).trim()
        const match = output.match(/(?:Current Wi-Fi Network|Current AirPort Network):\s*(.+)$/im)
        if (match && !/not associated|unknown|none/i.test(match[1])) { ssid = match[1].trim(); wifiDevice = device; break }
      } catch { ssid = '' }
    }
    if (!ssid) {
      for (const device of [...new Set([...devices, 'en0', 'en1'])]) {
        try {
          const summary = execFileSync('/usr/sbin/ipconfig', ['getsummary', device], { encoding: 'utf8', timeout: 1500 })
          const candidate = summary.match(/^\s*SSID\s*:\s*(.+)\s*$/im)?.[1]?.trim() ?? ''
          if (candidate && !/^(?:<redacted>|unknown|none)$/i.test(candidate)) { ssid = candidate; wifiDevice = device; break }
        } catch { /* Try another interface or detection method. */ }
      }
    }
    // Recent macOS versions may hide SSID from individual command-line tools.
    // system_profiler can still report the connected network under the Wi-Fi section.
    if (!ssid) {
      try {
        const report = execFileSync('/usr/sbin/system_profiler', ['SPAirPortDataType', '-detailLevel', 'basic'], { encoding: 'utf8', timeout: 5000 })
        const currentNetwork = report.match(/Current Network Information:\s*\n\s*([^\n:]+):/i)?.[1]?.trim() ?? ''
        if (currentNetwork && !/^(?:unknown|none|not connected)$/i.test(currentNetwork)) ssid = currentNetwork
      } catch { /* SSID remains empty; the UI allows manual entry. */ }
    }
  }
  const interfaces = networkInterfaces()
  const wifiAddresses = wifiDevice ? (interfaces[wifiDevice] ?? []) : []
  const addresses = wifiAddresses.filter((item) => item.family === 'IPv4' && !item.internal).map((item) => item.address)
  if (!addresses.length) {
    for (const [name, entries] of Object.entries(interfaces)) {
      if (name === 'lo0' || name.startsWith('utun') || name.startsWith('llw')) continue
      addresses.push(...(entries ?? []).filter((item) => item.family === 'IPv4' && !item.internal).map((item) => item.address))
    }
  }
  return { ssid, addresses }
})
app.post<{ Body: { fullName?: string; walletPublicKey?: string; holderSignature?: string } }>('/api/guests/register', async (request, reply) => {
  const fullName = request.body?.fullName?.trim().replace(/\s+/g, ' ')
  const { walletPublicKey, holderSignature } = request.body ?? {}
  if (!fullName || fullName.length < 2 || fullName.length > 100) return reply.code(400).send({ message: 'Ingresá tu nombre y apellido (2 a 100 caracteres).' })
  if (!walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'No se pudo crear la billetera en este teléfono.' })
  try {
    if (!verifyWallet(`guest-register.${fullName}`, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'La prueba de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const normalizedName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
  const demoStudent = demoStudents.find((student) => normalizedName(student.fullName) === normalizedName(fullName))
  if (demoStudent && !cloudMode) {
    const isMariano = normalizedName(demoStudent.fullName) === normalizedName('Mariano Arias Simone')
    db.prepare('insert or ignore into students (id, full_name, enrollment_number, identity_locked, created_at) values (?, ?, ?, 1, ?)').run(demoStudent.id, demoStudent.fullName, demoStudent.enrollmentNumber, new Date().toISOString())
    const savedStudent = db.prepare('select wallet_public_key as walletPublicKey from students where id = ?').get(demoStudent.id) as { walletPublicKey: string | null } | undefined
    if (!savedStudent) return reply.code(500).send({ message: 'No se pudo preparar el perfil de asistencia.' })
    if (!isMariano && savedStudent.walletPublicKey && savedStudent.walletPublicKey !== walletPublicKey) return reply.code(409).send({ message: 'Este perfil de demo ya está vinculado a otra billetera. Usá el teléfono donde se vinculó por primera vez.' })
    try {
      if (isMariano && savedStudent.walletPublicKey !== walletPublicKey) {
        db.prepare('delete from wallet_bindings where holder = ?').run(`did:unlar:student:${demoStudent.id}`)
        db.prepare('update students set wallet_public_key = ? where id = ?').run(walletPublicKey, demoStudent.id)
      } else {
        db.prepare('update students set wallet_public_key = ? where id = ? and (wallet_public_key is null or wallet_public_key = ?)').run(walletPublicKey, demoStudent.id, walletPublicKey)
      }
      const holder = `did:unlar:student:${demoStudent.id}`
      const existingBinding = db.prepare('select public_key from wallet_bindings where holder = ?').get(holder) as { public_key: string } | undefined
      if (existingBinding && existingBinding.public_key !== walletPublicKey) return reply.code(409).send({ message: 'Este perfil de demo ya está vinculado a otra billetera.' })
      db.prepare('insert or ignore into wallet_bindings (holder, public_key, created_at) values (?, ?, ?)').run(holder, walletPublicKey, new Date().toISOString())
    } catch { return reply.code(409).send({ message: 'Esta billetera ya está vinculada a otro perfil.' }) }
    regenerateAttendanceFile()
    const actor: DemoActor = { id: demoStudent.id, role: 'student', name: demoStudent.fullName, studentId: demoStudent.id }
    const token = randomBytes(32).toString('base64url')
    activeSessions.set(token, actor)
    return reply.code(200).send({ token, actor, enrollmentNumber: demoStudent.enrollmentNumber, demoProfile: true })
  }
  const id = `guest-${randomUUID()}`
  const enrollmentNumber = `INV-${randomBytes(4).toString('hex').toUpperCase()}`
  const existingWalletStudent = db.prepare('select full_name as fullName from students where wallet_public_key = ?').get(walletPublicKey) as { fullName: string } | undefined
  if (existingWalletStudent) {
    return reply.code(409).send({ message: `Esta billetera ya está asociada a un registro (${existingWalletStudent.fullName}). Para registrar a otra persona, abrí la demo en otro dispositivo o perfil de navegador.` })
  }
  try {
    db.transaction(() => {
      db.prepare('insert into students (id, full_name, enrollment_number, identity_locked, wallet_public_key, created_at) values (?, ?, ?, 1, ?, ?)').run(id, fullName, enrollmentNumber, walletPublicKey, new Date().toISOString())
      const holder = `did:unlar:student:${id}`
      db.prepare('insert into wallet_bindings (holder, public_key, created_at) values (?, ?, ?)').run(holder, walletPublicKey, new Date().toISOString())
    })()
  } catch (error) {
    const detail = error instanceof Error ? error.message : ''
    if (detail.includes('students.wallet_public_key') || detail.includes('wallet_bindings.public_key')) {
      return reply.code(409).send({ message: 'Esta billetera ya está asociada a otro registro. Para registrar a otra persona, usá otro dispositivo o perfil de navegador.' })
    }
    request.log.error({ err: error }, 'No se pudo guardar el registro invitado')
    return reply.code(500).send({ message: 'No se pudo completar el registro. Intentá nuevamente.' })
  }
  const actor: DemoActor = { id, role: isPhotographerName(fullName) ? 'photographer' : 'student', name: fullName, studentId: id }
  const token = randomBytes(32).toString('base64url')
  activeSessions.set(token, actor)
  regenerateAttendanceFile()
  return reply.code(201).send({ token, actor, enrollmentNumber })
})
app.post<{ Body: { walletPublicKey?: string; holderSignature?: string } }>('/api/guests/restore', async (request, reply) => {
  const { walletPublicKey, holderSignature } = request.body ?? {}
  if (!walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'No se encontró la clave de la billetera en este dispositivo.' })
  try {
    if (!verifyWallet('guest-restore', walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'No se pudo comprobar esta billetera.' })
  } catch { return reply.code(422).send({ message: 'La clave guardada en este dispositivo no es válida.' }) }
  const student = db.prepare('select id, full_name as name from students where wallet_public_key = ?').get(walletPublicKey) as { id: string; name: string } | undefined
  if (!student) return reply.code(404).send({ message: 'No encontramos un registro vinculado a esta billetera.' })
  const actor: DemoActor = { id: student.id, role: isPhotographerName(student.name) ? 'photographer' : 'student', name: student.name, studentId: student.id }
  const token = randomBytes(32).toString('base64url')
  activeSessions.set(token, actor)
  return { token, actor }
})
app.post<{ Body: { account: string; password: string } }>('/api/demo/login', async (request, reply) => {
  const account = request.body?.account
  const entry = typeof account === 'string' && Object.hasOwn(demoAccounts, account) ? demoAccounts[account] : undefined
  const ip = request.ip
  const previous = loginAttempts.get(ip)
  const attempt = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60_000 }
  if (attempt.count >= 10) return reply.header('Retry-After', Math.ceil((attempt.until - Date.now()) / 1000)).code(429).send({ message: 'Demasiados intentos. Esperá 15 minutos antes de volver a ingresar.' })
  const valid = cloudMode
    ? !!entry && entry.actor.role !== 'student' && verifyPassword(request.body?.password, passwordHashes[account])
    : !!entry && request.body?.password === entry.password
  if (!valid) {
    attempt.count += 1
    loginAttempts.set(ip, attempt)
    return reply.code(401).send({ message: 'Usuario o contraseña incorrectos.' })
  }
  if (!entry) return reply.code(401).send({ message: 'Usuario o contraseña incorrectos.' })
  if (!cloudMode && entry.actor.role !== 'student' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return reply.code(403).send({ message: 'El acceso de docente e institución solo está disponible desde la Mac. Abrí la demo en https://localhost:5173/.' })
  loginAttempts.delete(ip)
  const token = randomBytes(32).toString('base64url')
  activeSessions.set(token, entry.actor)
  return { token, actor: entry.actor, demoOnly: true }
})
app.addHook('preHandler', async (request, reply) => {
  if (!request.url.startsWith('/api/') || request.url === '/api/demo/login' || request.url === '/api/network-info' || request.url === '/api/presence' || request.url === '/api/guests/register' || request.url === '/api/guests/restore') return
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token || !activeSessions.has(token)) return reply.code(401).send({ message: 'Iniciá sesión para continuar.' })
  const sessionActor = activeSessions.get(token)
  if (sessionActor?.role === 'photographer') {
    const allowed = request.method === 'GET' && (['/api/demo/me', '/api/issuer-key', '/api/credentials', '/api/students', '/api/rewards/class-photo', '/api/rewards/class-photo/image'].includes(request.url.split('?')[0]) || /^\/api\/attendance\/sessions\/[A-Za-z0-9_-]+$/.test(request.url.split('?')[0]))
      || request.method === 'POST' && (request.url === '/api/presence' || request.url === '/api/rewards/class-photo' || /^\/api\/rewards\/[A-Za-z0-9_-]+\/claim$/.test(request.url))
      || request.method === 'POST' && /^\/api\/attendance\/sessions\/[A-Za-z0-9_-]+\/check-in$/.test(request.url.split('?')[0])
    if (!allowed) return reply.code(403).send({ message: 'El acceso de fotografía solo permite guardar la foto de la clase y usar la billetera propia.' })
  }
  if (!cloudMode && sessionActor && !['student', 'photographer'].includes(sessionActor.role) && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ message: 'El panel docente e institucional solo está disponible desde la Mac.' })
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
app.post('/api/demo/logout', async (request) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (token) activeSessions.delete(token)
  return { loggedOut: true }
})
app.get('/api/demo/me', async (request, reply) => {
  const actor = actorFor(request)
  if (!actor) return reply.code(401).send({ message: 'La sesión venció.' })
  return { actor, demoOnly: true }
})
app.post<{ Body: { clientId?: string } }>('/api/presence', async (request, reply) => {
  const clientId = request.body?.clientId
  if (!clientId || !/^[A-Za-z0-9_-]{12,80}$/.test(clientId)) return reply.code(400).send({ message: 'Identificador de dispositivo inválido.' })
  return { connected: true }
})
app.get('/api/issuer-key', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'photographer', 'teacher', 'institutional'])) return
  return { keyId: issuerId, algorithm: 'ML-DSA-65', publicKeyPem: issuerKeys.publicKey }
})
app.get('/api/credentials', async (request, reply) => {
  const actor = requireRole(request, reply, ['student', 'photographer', 'teacher', 'institutional'])
  if (!actor) return
  const columns = "id, kind, title, detail, holder, issued_at as issuedAt, expires_at as expiresAt, status, created_at as createdAt, json_extract(credential_json, '$.claims.nombreEstudiante') as studentName, json_extract(credential_json, '$.claims.matricula') as enrollmentNumber"
  if (actor.role === 'student' || actor.role === 'photographer') return db.prepare(`select ${columns} from credentials where holder = ? or holder in (select holder from wallet_bindings where public_key = (select wallet_public_key from students where id = ?)) order by created_at desc`).all(`did:unlar:student:${actor.studentId}`, actor.studentId)
  if (actor.role === 'teacher') return []
  const allowed = actor.scope === 'library' ? ['Biblioteca'] : actor.scope === 'gym' ? ['Gimnasio'] : ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia']
  return db.prepare(`select ${columns} from credentials where kind in (${allowed.map(() => '?').join(',')}) order by created_at desc`).all(...allowed)
})
app.get('/api/students', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'photographer', 'teacher', 'institutional', 'demo-tools'])) return
  const actor = actorFor(request)
  const rows = db.prepare('select id, full_name as fullName, enrollment_number as enrollmentNumber, identity_locked as identityLocked, wallet_public_key as walletPublicKey from students order by id').all() as { id: string; fullName: string; enrollmentNumber: string; identityLocked: number; walletPublicKey: string | null }[]
  const profiles = rows.map(({ walletPublicKey, ...student }) => ({ ...student, walletLinked: Boolean(walletPublicKey) }))
  return actor && ['student', 'photographer'].includes(actor.role) ? profiles.filter((student) => student.id === actor.studentId) : profiles
})

app.post<{ Body: { raffleId?: string; winners?: { studentId?: string; place?: number }[] } }>('/api/raffle/prize-requests', async (request, reply) => {
  if (!requireRole(request, reply, ['institutional', 'demo-tools'])) return
  const winners = request.body?.winners
  const raffleId = request.body?.raffleId
  if (!raffleId || !/^[A-Za-z0-9-]{16,80}$/.test(raffleId) || !Array.isArray(winners) || winners.length < 1 || winners.length > 5 || winners.some((winner, index) => !winner.studentId || winner.place !== index + 1)) {
    return reply.code(400).send({ message: 'El sorteo debe incluir entre uno y cinco puestos en orden.' })
  }
  if (winners.some((winner) => demoStudents.some((student) => student.id === winner.studentId))) {
    return reply.code(400).send({ message: 'Las billeteras de demo están excluidas del sorteo.' })
  }
  const createdAt = new Date().toISOString()
  const ids = winners.map((winner) => winner.studentId!)
  const placeholders = ids.map(() => '?').join(',')
  const retireMissing = db.prepare(`update raffle_prize_requests set retired_at = ? where raffle_id = ? and retired_at is null and student_id not in (${placeholders})`)
  const insert = db.prepare('insert into raffle_prize_requests (id, raffle_id, student_id, student_name, place, created_at) select ?, ?, id, full_name, ?, ? from students where id = ? and wallet_public_key is not null and not exists (select 1 from raffle_prize_requests r where r.raffle_id = ? and r.student_id = students.id and r.retired_at is null)')
  const tx = db.transaction(() => {
    retireMissing.run(createdAt, raffleId, ...ids)
    winners.forEach((winner) => insert.run(randomUUID(), raffleId, winner.place, createdAt, winner.studentId, raffleId))
    winners.forEach((winner) => db.prepare('update raffle_prize_requests set place = ? where raffle_id = ? and student_id = ? and retired_at is null').run(winner.place, raffleId, winner.studentId))
  })
  tx()
  const count = db.prepare('select count(*) as count from raffle_prize_requests where raffle_id = ? and retired_at is null').get(raffleId) as { count: number }
  return { created: count.count, skipped: winners.length - count.count }
})
app.get('/api/raffle/prize-requests', async (request, reply) => {
  const actor = requireRole(request, reply, ['institutional', 'demo-tools'])
  if (!actor) return
  return db.prepare('select id, raffle_id as raffleId, student_id as studentId, student_name as studentName, place, email, created_at as createdAt, answered_at as answeredAt, retired_at as retiredAt from raffle_prize_requests order by created_at desc, place asc').all()
})
app.get('/api/raffle/prize-requests/pending', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  return db.prepare('select id, student_name as studentName, place, created_at as createdAt from raffle_prize_requests where student_id = ? and email is null and retired_at is null order by created_at desc').all(actor.studentId)
})
app.post<{ Params: { id: string }; Body: { email?: string } }>('/api/raffle/prize-requests/:id/email', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const email = request.body?.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ message: 'Ingresá un email válido.' })
  const result = db.prepare('update raffle_prize_requests set email = ?, answered_at = ? where id = ? and student_id = ? and email is null').run(email, new Date().toISOString(), request.params.id, actor.studentId)
  if (!result.changes) return reply.code(404).send({ message: 'No se encontró una solicitud pendiente para esta billetera.' })
  return { saved: true }
})

app.get('/api/rewards/class-photo', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'photographer', 'teacher', 'institutional', 'demo-tools'])) return
  return existsSync(classPhotoPath) ? { available: true, updatedAt: statSync(classPhotoPath).mtime.toISOString() } : { available: false }
})
app.get('/api/rewards/class-photo/image', async (request, reply) => {
  if (!requireRole(request, reply, ['student', 'photographer', 'teacher', 'institutional', 'demo-tools'])) return
  if (!existsSync(classPhotoPath)) return reply.code(404).send({ message: 'Todavía no se guardó la foto de la clase.' })
  return { dataUrl: `data:image/jpeg;base64,${readFileSync(classPhotoPath).toString('base64')}` }
})
app.post<{ Body: { dataUrl?: string } }>('/api/rewards/class-photo', async (request, reply) => {
  const sessionActor = activeSessions.get(request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '')
  if (!sessionActor || !hasPhotographerAccess(sessionActor)) {
    if (!requireRole(request, reply, ['photographer'])) return
  }
  const dataUrl = request.body?.dataUrl ?? ''
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return reply.code(400).send({ message: 'La imagen debe estar en formato JPEG.' })
  const image = Buffer.from(match[1], 'base64')
  if (image.length > 3 * 1024 * 1024 || image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) return reply.code(400).send({ message: 'La foto debe ser JPEG y pesar hasta 3 MB.' })
  writeFileSync(classPhotoPath, image)
  return { saved: true, updatedAt: statSync(classPhotoPath).mtime.toISOString() }
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
    const message = `student.${student.id}.${student.enrollmentNumber}`
    if (!verifyWallet(message, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
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

app.post('/api/demo/reset', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher'])) return
  if (!cloudMode && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ message: 'El reinicio solo está disponible desde localhost en la Mac.' })
  const keep = ['mariano-arias-simone', 'peralta-herrar-nahuel']
  db.transaction(() => {
    for (const table of ['raffle_prize_requests', 'credential_deliveries', 'reward_claims', 'reward_sessions', 'presentation_requests', 'attendance_records', 'attendance_sessions', 'credentials']) db.prepare(`delete from ${table}`).run()
    db.prepare('delete from wallet_bindings').run()
    db.prepare('update students set wallet_public_key = null').run()
    db.prepare('delete from students where id not in (?, ?)').run(...keep)
  })()
  for (const [token, actor] of activeSessions) if (actor.role === 'student' || actor.role === 'photographer') activeSessions.delete(token)
  if (existsSync(classPhotoPath)) unlinkSync(classPhotoPath)
  regenerateAttendanceFile()
  return { reset: true, retainedStudents: keep, deletedOperationalData: true }
})

app.post<{ Body: { title?: string; detail?: string } }>('/api/rewards/sessions', async (request, reply) => {
  const actor = requireRole(request, reply, ['teacher', 'demo-tools'])
  if (!actor) return
  const title = request.body?.title?.trim() || 'Souvenir · Seminario de Actualización II'
  const detail = request.body?.detail?.trim() || 'Gracias por participar de nuestro proyecto.'
  if (title.length > 120 || detail.length > 160) return reply.code(400).send({ message: 'El título admite hasta 120 caracteres y el mensaje hasta 160.' })
  const code = newCode()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  db.prepare('insert into reward_sessions (code, title, detail, expires_at, created_at) values (?, ?, ?, ?, ?)').run(code, title, detail, expiresAt, createdAt)
  return reply.code(201).send({ code, title, detail, expiresAt })
})

app.get<{ Params: { id: string } }>('/api/rewards/credentials/:id/preview', async (request, reply) => {
  const actor = requireRole(request, reply, ['student', 'photographer'])
  if (!actor) return
  const reward = db.prepare('select code from reward_claims where credential_id = ? and student_id = ?').get(request.params.id, actor.studentId) as { code: string } | undefined
  if (!reward) return reply.code(404).send({ message: 'No encontramos este recuerdo en tu perfil.' })
  return reward
})

app.post<{ Params: { code: string }; Body: { walletPublicKey?: string; holderSignature?: string } }>('/api/rewards/:code/claim', async (request, reply) => {
  const actor = requireRole(request, reply, ['student', 'photographer'])
  if (!actor?.studentId) return
  const session = db.prepare('select title, detail, expires_at as expiresAt from reward_sessions where code = ?').get(request.params.code) as { title: string; detail: string; expiresAt: string } | undefined
  if (!session) return reply.code(404).send({ message: 'Este QR de souvenir no existe.' })
  if (Date.parse(session.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'Este QR de souvenir venció. Pedile al docente que genere uno nuevo.' })
  const student = db.prepare('select full_name as fullName, enrollment_number as enrollmentNumber, wallet_public_key as walletPublicKey from students where id = ?').get(actor.studentId) as { fullName: string; enrollmentNumber: string; walletPublicKey: string | null } | undefined
  if (!student?.walletPublicKey) return reply.code(409).send({ message: 'Primero vinculá tu billetera a tu registro.' })
  const { walletPublicKey, holderSignature } = request.body ?? {}
  const holder = `did:unlar:student:${actor.studentId}`
  if (walletPublicKey !== student.walletPublicKey || !holderSignature) return reply.code(403).send({ message: 'Este souvenir requiere la billetera vinculada a tu registro.' })
  try {
    if (!verifyWallet(`reward-claim.${request.params.code}.${holder}`, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'No se pudo validar esta billetera.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const existing = db.prepare('select c.credential_json as credentialJson from reward_claims rc join credentials c on c.id = rc.credential_id where rc.code = ? and rc.student_id = ?').get(request.params.code, actor.studentId) as { credentialJson: string } | undefined
  if (existing) return { credential: JSON.parse(existing.credentialJson) as SignedCredential, alreadyClaimed: true }
  const issuedAt = new Date().toISOString()
  const credential = signCredential({
    id: randomUUID(), type: 'Souvenir', issuer: 'did:web:unlar.edu.ar:prototipo', holder,
    claims: { titulo: session.title, detalle: session.detail, estudianteId: actor.studentId, matricula: student.enrollmentNumber, nombreEstudiante: student.fullName }, issuedAt,
  })
  try {
    db.transaction(() => {
      db.prepare('insert into credentials (id, kind, title, detail, holder, issued_at, expires_at, status, created_at, credential_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(credential.id, 'Souvenir', session.title, session.detail, holder, issuedAt, null, 'Activa', issuedAt, JSON.stringify(credential))
      db.prepare('insert into reward_claims (code, student_id, credential_id) values (?, ?, ?)').run(request.params.code, actor.studentId, credential.id)
      db.prepare('insert or ignore into wallet_bindings (holder, public_key, created_at) values (?, ?, ?)').run(holder, walletPublicKey, issuedAt)
    })()
  } catch {
    const claimed = db.prepare('select c.credential_json as credentialJson from reward_claims rc join credentials c on c.id = rc.credential_id where rc.code = ? and rc.student_id = ?').get(request.params.code, actor.studentId) as { credentialJson: string } | undefined
    if (!claimed) throw new Error('No se pudo guardar el souvenir.')
    return { credential: JSON.parse(claimed.credentialJson) as SignedCredential, alreadyClaimed: true }
  }
  return { credential }
})

app.post<{ Body: { kind: string; title: string; detail?: string; grade?: number; holder?: string; studentId?: string; validityDays?: number; expiresAt?: string | null } }>('/api/credentials', async (request, reply) => {
  const actor = requireRole(request, reply, ['institutional'])
  if (!actor) return
  const { kind, title } = request.body ?? {}
  if (!kind || !title?.trim()) return reply.code(400).send({ message: kind === 'Regularidad' ? 'Completá la materia para emitir una regularidad.' : 'Completá el tipo y la materia o el servicio.' })
  if (kind === 'Nota de materia' && (!Number.isFinite(request.body.grade) || (request.body.grade as number) < 1 || (request.body.grade as number) > 10)) return reply.code(400).send({ message: 'Ingresá una nota válida entre 1 y 10.' })
  const validityDays = request.body.validityDays
  if (validityDays !== undefined && (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 36500)) return reply.code(400).send({ message: 'La vigencia debe indicarse en días enteros entre 1 y 36500.' })
  const detail = kind === 'Nota de materia' ? `Nota: ${request.body.grade}` : request.body.detail?.trim()
  if (!detail) return reply.code(400).send({ message: 'Completá el detalle de la credencial.' })
  const permittedKinds: Record<string, string[]> = { academic: ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia'], library: ['Biblioteca'], gym: ['Gimnasio'] }
  if (!actor.scope || !permittedKinds[actor.scope]?.includes(kind)) return reply.code(403).send({ message: 'Este usuario institucional no puede emitir ese tipo de credencial.' })
  const studentId = request.body.studentId ?? demoStudents[0].id
  const student = db.prepare('select id, full_name as fullName, enrollment_number as enrollmentNumber from students where id = ?').get(studentId) as { id: string; fullName: string; enrollmentNumber: string } | undefined
  if (!student) return reply.code(404).send({ message: 'Elegí un estudiante válido.' })
  const issuedAt = new Date().toISOString()
  const credentialExpiresAt = validityDays === undefined ? undefined : new Date(Date.parse(issuedAt) + validityDays * 24 * 60 * 60_000).toISOString()
  const credential = signCredential({
    id: randomUUID(), type: kind, issuer: 'did:web:unlar.edu.ar:prototipo', holder: `did:unlar:student:${student.id}`,
    claims: { titulo: title.trim(), detalle: detail, ...(['Regularidad', 'Materia aprobada', 'Nota de materia'].includes(kind) ? { materia: title.trim() } : {}), ...(kind === 'Nota de materia' ? { nota: String(request.body.grade) } : {}), estudianteId: student.id, matricula: student.enrollmentNumber, nombreEstudiante: student.fullName }, issuedAt, ...(credentialExpiresAt ? { expiresAt: credentialExpiresAt } : {}),
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
    if (!verifyWallet(`claim.${request.params.code}.${credential.holder}`, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
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
  const permittedKinds: Record<string, string[]> = { academic: ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia'], library: ['Biblioteca'], gym: ['Gimnasio'] }
  if (credential && (!actor.scope || !permittedKinds[actor.scope]?.includes(credential.kind))) return reply.code(403).send({ message: 'No tenés permiso para revocar esta credencial.' })
  const result = db.prepare('update credentials set status = ? where id = ?').run('Revocada', request.params.id)
  if (!result.changes) return reply.code(404).send({ message: 'Credencial inexistente' })
  return { id: request.params.id, status: 'Revocada' }
})

app.delete<{ Params: { id: string } }>('/api/credentials/:id', async (request, reply) => {
  const actor = requireRole(request, reply, ['institutional'])
  if (!actor) return
  const credential = db.prepare('select kind from credentials where id = ?').get(request.params.id) as { kind: string } | undefined
  if (!credential) return reply.code(404).send({ message: 'Credencial inexistente.' })
  const permittedKinds: Record<string, string[]> = { academic: ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia'], library: ['Biblioteca'], gym: ['Gimnasio'] }
  if (!actor.scope || !permittedKinds[actor.scope]?.includes(credential.kind)) return reply.code(403).send({ message: 'No tenés permiso para eliminar esta credencial.' })
  const deleted = db.transaction(() => {
    db.prepare('delete from credential_deliveries where credential_id = ?').run(request.params.id)
    return db.prepare('delete from credentials where id = ?').run(request.params.id).changes
  })()
  if (!deleted) return reply.code(404).send({ message: 'Credencial inexistente.' })
  return { id: request.params.id, deleted: true }
})

app.post<{ Body: { kind: string; subject?: string; minimumGrade?: number; requestNote?: string; requiredClaims?: string[]; includeExactGrade?: boolean; minutes?: number } }>('/api/presentation-requests', async (request, reply) => {
  if (!requireRole(request, reply, ['teacher', 'institutional'])) return
  if (!request.body?.kind) return reply.code(400).send({ message: 'Indicá el tipo de credencial requerido.' })
  const subject = request.body.subject?.trim() || null
  const minimumGrade = request.body.minimumGrade
  const requestNote = request.body.requestNote?.trim() || null
  const allowedClaims = new Set(['nombreEstudiante', 'matricula', 'titulo', 'detalle', 'materia', 'nota'])
  const requiredClaims = [...new Set(request.body.requiredClaims ?? [])]
  if (requiredClaims.some((claim) => !allowedClaims.has(claim))) return reply.code(400).send({ message: 'La solicitud contiene un dato no permitido.' })
  if (request.body.includeExactGrade && !requiredClaims.includes('nota')) requiredClaims.push('nota')
  if (subject && subject.length > 120) return reply.code(400).send({ message: 'La materia debe tener como máximo 120 caracteres.' })
  if (request.body.kind === 'Nota de materia' && minimumGrade !== undefined && (!Number.isFinite(minimumGrade) || minimumGrade < 1 || minimumGrade > 10)) return reply.code(400).send({ message: 'La nota mínima debe estar entre 1 y 10.' })
  if (request.body.kind !== 'Nota de materia' && minimumGrade !== undefined) return reply.code(400).send({ message: 'La nota mínima solo se puede pedir para una nota de materia.' })
  if (requestNote && requestNote.length > 300) return reply.code(400).send({ message: 'El detalle debe tener como máximo 300 caracteres.' })
  const code = newCode()
  const minutes = Math.min(Math.max(request.body.minutes ?? 2, 1), 5)
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString()
  db.prepare('insert into presentation_requests (code, kind, subject, minimum_grade, request_note, required_claims, include_exact_grade, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)').run(code, request.body.kind, subject, minimumGrade ?? null, requestNote, JSON.stringify(requiredClaims), request.body.includeExactGrade ? 1 : 0, expiresAt)
  return reply.code(201).send({ code, kind: request.body.kind, subject, minimumGrade: minimumGrade ?? null, requestNote, requiredClaims, includeExactGrade: Boolean(request.body.includeExactGrade), expiresAt })
})

app.get<{ Params: { code: string } }>('/api/presentation-requests/:code', async (request, reply) => {
  if (!requireRole(request, reply, ['student'])) return
  const row = db.prepare('select kind, subject, minimum_grade as minimumGrade, request_note as requestNote, required_claims as requiredClaimsJson, include_exact_grade as includeExactGrade, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; subject: string | null; minimumGrade: number | null; requestNote: string | null; requiredClaimsJson: string; includeExactGrade: number; expiresAt: string; status: string } | undefined
  if (!row) return reply.code(404).send({ message: 'La solicitud no existe.' })
  if (Date.parse(row.expiresAt) <= Date.now() || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue utilizada.' })
  const { requiredClaimsJson, ...publicRow } = row
  return { code: request.params.code, ...publicRow, requiredClaims: JSON.parse(requiredClaimsJson), includeExactGrade: Boolean(row.includeExactGrade) }
})

app.post<{ Params: { code: string }; Body: { credential: SignedCredential; walletPublicKey: string; holderSignature: string } }>('/api/presentation-requests/:code/respond', async (request, reply) => {
  const actor = requireRole(request, reply, ['student'])
  if (!actor?.studentId) return
  const row = db.prepare('select kind, subject, minimum_grade as minimumGrade, required_claims as requiredClaimsJson, expires_at as expiresAt, status from presentation_requests where code = ?').get(request.params.code) as { kind: string; subject: string | null; minimumGrade: number | null; requiredClaimsJson: string; expiresAt: string; status: string } | undefined
  if (!row || row.status !== 'Abierta') return reply.code(410).send({ message: 'La solicitud venció o ya fue respondida.' })
  if (Date.parse(row.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La solicitud de verificación venció.' })
  const { credential, walletPublicKey, holderSignature } = request.body ?? {}
  if (!credential || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Falta la credencial o la prueba de posesión de la billetera.' })
  if (credential.type !== row.kind) return reply.code(422).send({ message: `Se solicitó ${row.kind} y se presentó ${credential.type}.` })
  const normalizeSubject = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
  const stored = db.prepare('select status, expires_at, credential_json as credentialJson from credentials where id = ?').get(credential.id) as { status: string; expires_at: string | null; credentialJson: string | null } | undefined
  if (!stored || stored.status !== 'Activa' || !stored.credentialJson) return reply.code(422).send({ message: 'La credencial fue revocada o no figura en el registro del emisor.' })
  const issuedCredential = JSON.parse(stored.credentialJson) as SignedCredential
  if (!verifyCredential(issuedCredential) || credential.holder !== issuedCredential.holder) return reply.code(422).send({ message: 'La firma del emisor o el titular no son válidos.' })
  for (const required of [...(row.subject ? ['materia'] : []), ...(row.minimumGrade != null ? [`cumpleNotaMinima${row.minimumGrade}`] : [])]) {
    if (!(required in (credential.claims ?? {}))) return reply.code(422).send({ message: 'Falta un dato solicitado por el verificador.' })
  }
  for (const [key, value] of Object.entries(credential.claims ?? {})) {
    const threshold = /^cumpleNotaMinima(\d+(?:\.\d+)?)$/.exec(key)
    const expected = threshold ? String(Number(issuedCredential.claims.nota) >= Number(threshold[1])) : key === 'materia' ? issuedCredential.claims.materia ?? issuedCredential.claims.titulo : issuedCredential.claims[key]
    if (expected === undefined || expected !== value) return reply.code(422).send({ message: 'Los datos compartidos no coinciden con la credencial emitida.' })
  }
  const credentialSubject = issuedCredential.claims.materia ?? issuedCredential.claims.titulo ?? ''
  if (row.subject && normalizeSubject(credentialSubject) !== normalizeSubject(row.subject)) return reply.code(422).send({ message: `Se solicitó una credencial de ${row.subject}.` })
  if (row.minimumGrade !== null && row.minimumGrade !== undefined && !Number.isFinite(Number(issuedCredential.claims.nota))) return reply.code(422).send({ message: 'La credencial no contiene una nota verificable.' })
  if (issuedCredential.claims.estudianteId !== actor.studentId || credential.holder !== `did:unlar:student:${actor.studentId}`) return reply.code(403).send({ message: 'Esta credencial no pertenece al perfil de estudiante activo.' })
  if ((stored.expires_at && Date.parse(stored.expires_at) <= Date.now()) || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())) return reply.code(422).send({ message: 'La credencial venció.' })
  try {
    const binding = db.prepare('select public_key from wallet_bindings where holder = ?').get(credential.holder) as { public_key: string } | undefined
    if (!binding || binding.public_key !== walletPublicKey) return reply.code(422).send({ message: 'Esta credencial no está vinculada a esta billetera.' })
    const proofMessage = `${request.params.code}.${credential.id}.${credential.holder}`
    if (!verifyWallet(proofMessage, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
  } catch { return reply.code(422).send({ message: 'La clave de la billetera no es válida.' }) }
  const minimumGradeMet = row.minimumGrade !== null && row.minimumGrade !== undefined ? Number(issuedCredential.claims.nota) >= row.minimumGrade : undefined
  const result = { valid: true, credentialId: credential.id, title: credential.claims.titulo ?? credential.claims.materia ?? credential.type, kind: credential.type, subject: credential.claims.materia, grade: credential.claims.nota, minimumGrade: row.minimumGrade, minimumGradeMet, studentName: credential.claims.nombreEstudiante, verifiedAt: new Date().toISOString() }
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
  if (!requireRole(request, reply, ['student', 'photographer'])) return
  const session = db.prepare('select id, subject, section, expires_at as expiresAt, status from attendance_sessions where id = ?').get(request.params.id) as AttendanceSessionRow | undefined
  if (!session || session.status !== 'Abierta' || Date.parse(session.expiresAt) <= Date.now()) return reply.code(410).send({ message: 'La sesión de asistencia venció o fue cerrada.' })
  return session
})

app.post<{ Params: { id: string }; Body: { studentId?: string; walletPublicKey?: string; holderSignature?: string } }>('/api/attendance/sessions/:id/check-in', async (request, reply) => {
  const actor = requireRole(request, reply, ['student', 'photographer'])
  if (!actor?.studentId) return
  const session = db.prepare('select * from attendance_sessions where id = ?').get(request.params.id) as { expires_at: string; status: string } | undefined
  if (!session || session.status !== 'Abierta') return reply.code(404).send({ message: 'Sesión no disponible.' })
  if (Date.parse(session.expires_at) <= Date.now()) return reply.code(410).send({ message: 'La sesión venció.' })
  const { walletPublicKey, holderSignature } = request.body ?? {}
  const studentId = actor.studentId
  if (!studentId || !walletPublicKey || !holderSignature) return reply.code(400).send({ message: 'Completá tus datos y registrá la billetera antes de marcar asistencia.' })
  const student = db.prepare('select id, full_name as fullName, wallet_public_key as walletPublicKey from students where id = ?').get(studentId) as { id: string; fullName: string; walletPublicKey: string | null } | undefined
  if (!student) return reply.code(404).send({ message: 'No se encontró el perfil del estudiante.' })
  if (student.walletPublicKey !== walletPublicKey) return reply.code(403).send({ message: 'Esta billetera no está vinculada al perfil registrado.' })
  try {
    const proofMessage = `attendance.${request.params.id}.${student.id}`
    if (!verifyWallet(proofMessage, walletPublicKey, holderSignature)) return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
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

if (cloudMode) {
  await app.register(fastifyStatic, { root: join(root, 'dist'), wildcard: false })
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.includes('.')) return reply.code(404).send({ message: 'Ruta no encontrada.' })
    return reply.sendFile('index.html')
  })
}

const port = Number(process.env.PORT ?? 4001)
const host = process.env.HOST ?? (cloudMode ? '0.0.0.0' : '127.0.0.1')
await app.listen({ port, host })
