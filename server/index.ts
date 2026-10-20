import Fastify from 'fastify'
import cors from '@fastify/cors'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const databasePath = join(root, 'data', 'billetera.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec([
  'create table if not exists credentials (id text primary key, kind text not null, title text not null, detail text not null, holder text not null, issued_at text not null, expires_at text, status text not null default "Activa", created_at text not null);',
  'create table if not exists attendance_sessions (id text primary key, subject text not null, section text not null, expires_at text not null, status text not null default "Abierta");',
  'create table if not exists attendance_records (id text primary key, session_id text not null references attendance_sessions(id), holder text not null, recorded_at text not null, unique(session_id, holder));',
].join('\n'))

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })
app.get('/health', async () => ({ ok: true, service: 'billetera-universitaria-api' }))
app.get('/api/credentials', async () => db.prepare('select * from credentials order by created_at desc').all())

app.post<{ Body: { kind: string; title: string; detail: string; holder?: string; expiresAt?: string | null } }>('/api/credentials', async (request, reply) => {
  const now = new Date().toISOString()
  const credential = {
    id: randomUUID(),
    kind: request.body.kind,
    title: request.body.title,
    detail: request.body.detail,
    holder: request.body.holder ?? 'did:key:estudiante-demo',
    issuedAt: now,
    expiresAt: request.body.expiresAt ?? null,
    status: 'Activa',
    createdAt: now,
  }
  db.prepare('insert into credentials (id, kind, title, detail, holder, issued_at, expires_at, status, created_at) values (@id, @kind, @title, @detail, @holder, @issuedAt, @expiresAt, @status, @createdAt)').run(credential)
  return reply.code(201).send(credential)
})

app.post<{ Params: { id: string } }>('/api/credentials/:id/revoke', async (request, reply) => {
  const result = db.prepare('update credentials set status = ? where id = ?').run('Revocada', request.params.id)
  if (!result.changes) return reply.code(404).send({ message: 'Credencial inexistente' })
  return { id: request.params.id, status: 'Revocada' }
})

app.post<{ Body: { subject: string; section?: string; minutes?: number } }>('/api/attendance/sessions', async (request, reply) => {
  const id = randomUUID().slice(0, 8).toUpperCase()
  const minutes = Math.min(Math.max(request.body.minutes ?? 2, 1), 10)
  const session = {
    id,
    subject: request.body.subject,
    section: request.body.section ?? 'Comisión A',
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  }
  db.prepare('insert into attendance_sessions (id, subject, section, expires_at) values (@id, @subject, @section, @expiresAt)').run(session)
  return reply.code(201).send({ ...session, status: 'Abierta' })
})

app.post<{ Params: { id: string }; Body: { holder?: string } }>('/api/attendance/sessions/:id/check-in', async (request, reply) => {
  const session = db.prepare('select * from attendance_sessions where id = ?').get(request.params.id) as { expires_at: string; status: string } | undefined
  if (!session || session.status !== 'Abierta') return reply.code(404).send({ message: 'Sesión no disponible' })
  if (new Date(session.expires_at).getTime() < Date.now()) return reply.code(410).send({ message: 'La sesión venció' })
  try {
    db.prepare('insert into attendance_records (id, session_id, holder, recorded_at) values (?, ?, ?, ?)').run(randomUUID(), request.params.id, request.body.holder ?? 'did:key:estudiante-demo', new Date().toISOString())
    return { id: request.params.id, registered: true }
  } catch {
    return reply.code(409).send({ message: 'La billetera ya registró asistencia en esta sesión' })
  }
})

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
