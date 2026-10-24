import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundledNode = path.resolve(projectDir, '..', '.tools', 'node', 'bin', 'node')
const node = existsSync(bundledNode) ? bundledNode : process.execPath
const viteCli = path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js')
const tsxLoader = path.join(projectDir, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const certDir = path.join(projectDir, 'certs', 'local-dev')
const rootCertificate = path.join(certDir, 'UNLaR-local-dev-rootCA.crt')
const rootKey = path.join(certDir, 'rootCA-key.pem')
const serverKey = path.join(certDir, 'server-key.pem')
const serverRequest = path.join(certDir, 'server.csr')
const serverCertificate = path.join(certDir, 'server-cert.pem')
const serverExtensions = path.join(certDir, 'server.ext')
const requiredFiles = [
  path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js'),
  path.join(projectDir, 'node_modules', 'tsx', 'dist', 'loader.mjs'),
  path.join(projectDir, 'certs', 'local-dev', 'server-cert.pem'),
  path.join(projectDir, 'certs', 'local-dev', 'server-key.pem'),
  rootCertificate,
  rootKey,
]

const missing = requiredFiles.filter((file) => !existsSync(file))
if (missing.length) {
  console.error('Faltan archivos necesarios para iniciar la demo.')
  console.error('Con internet, desde la carpeta del proyecto ejecutá una vez:')
  console.error('  ../.tools/node/bin/npm install')
  console.error('También verificá que estén disponibles los certificados locales en certs/local-dev/.')
  process.exit(1)
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

function listeningPids(port) {
  try {
    return [...new Set(execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))]
  } catch { return [] }
}

function processName(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'proceso' }
  catch { return 'proceso' }
}

async function confirmStop(services) {
  console.log('Ya hay servicios locales usando los puertos de la demo:')
  for (const service of services) {
    const owners = service.pids.map((pid) => `${processName(pid)} (PID ${pid})`).join(', ')
    console.log(`  ${service.name} · puerto ${service.port}: ${owners}`)
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Ejecutá este lanzador desde una terminal interactiva para elegir si querés cerrar esos procesos.')
    return false
  }
  const answer = await new Promise((resolve) => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    prompt.question('¿Querés cerrarlos y ejecutar la demo desde esta terminal? [s/N] ', (value) => {
      prompt.close()
      resolve(value.trim().toLocaleLowerCase('es-AR'))
    })
  })
  return ['s', 'si', 'sí'].includes(answer)
}

const services = [
  { name: 'API', port: 4001 },
  { name: 'Interfaz web', port: 5173 },
]
const busyServices = services.map((service) => ({ ...service, pids: listeningPids(service.port) })).filter((service) => service.pids.length)
if (busyServices.length) {
  if (!await confirmStop(busyServices)) {
    console.log('No se cerró ningún proceso. La demo no se inició.')
    process.exit(0)
  }
  const pids = [...new Set(busyServices.flatMap((service) => service.pids))]
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM') } catch (error) { if (error?.code !== 'ESRCH') throw error }
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && services.some((service) => isPortInUse(service.port))) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const remaining = services.filter((service) => isPortInUse(service.port))
  if (remaining.length) {
    console.error(`No se liberaron los puertos ${remaining.map((service) => service.port).join(' y ')}. No iniciaré otra copia.`)
    console.error('Cerrá los servicios desde la terminal donde están corriendo y volvé a ejecutar este lanzador.')
    process.exit(1)
  }
  console.log('Servicios anteriores cerrados. Iniciando API e interfaz desde esta terminal.\n')
}

const addresses = Object.entries(os.networkInterfaces())
  .filter(([name]) => !['lo0', 'lo'].includes(name) && !name.startsWith('utun') && !name.startsWith('llw'))
  .flatMap(([, entries]) => (entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address))
  .filter((address, index, list) => list.indexOf(address) === index)

try {
  const sans = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((address) => `IP:${address}`)].join(',')
  writeFileSync(serverExtensions, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=${sans}`,
    '',
  ].join('\n'))
  execFileSync('openssl', ['req', '-new', '-key', serverKey, '-out', serverRequest, '-subj', '/CN=UNLaR Local Demo'], { cwd: projectDir, stdio: 'ignore' })
  execFileSync('openssl', ['x509', '-req', '-in', serverRequest, '-CA', rootCertificate, '-CAkey', rootKey, '-CAcreateserial', '-out', serverCertificate, '-days', '825', '-sha256', '-extfile', serverExtensions], { cwd: projectDir, stdio: 'ignore' })
} catch (error) {
  console.error('No se pudo actualizar el certificado HTTPS para la IP actual de la Mac.')
  console.error('Verificá que macOS tenga openssl y que certs/local-dev/ conserve su CA local.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const children = []
const clients = new Map()
const activities = []
const maxActivities = 100
const connectedWindowMs = 35_000
let stopping = false
let exitCode = 0
let renderTimer

function addActivity(event) {
  activities.push(event)
  if (activities.length > maxActivities) activities.shift()
  if (!process.stdout.isTTY) {
    const time = new Date(event.at).toLocaleTimeString('es-AR', { hour12: false })
    console.log(`${time}  ${event.ip}  ${event.name ? `${event.name} · ` : ''}${event.method} ${event.route}  ${event.status}`)
  }
}

function handleOutputLine(source, line) {
  const trimmed = line.trim()
  if (!trimmed) return
  if (trimmed.startsWith('DEMO_CLIENT ')) {
    try {
      const client = JSON.parse(trimmed.slice('DEMO_CLIENT '.length))
      clients.set(client.id, { ...client, at: Number(client.at) || Date.now() })
      return
    } catch { /* Se muestra como aviso abajo. */ }
  }
  if (trimmed.startsWith('DEMO_ACTIVITY ')) {
    try { addActivity(JSON.parse(trimmed.slice('DEMO_ACTIVITY '.length))); return }
    catch { /* Se muestra como aviso abajo. */ }
  }
  let message = trimmed
  try {
    const parsed = JSON.parse(trimmed)
    message = parsed.msg ?? parsed.err?.message ?? parsed.message ?? trimmed
  } catch { /* Mensaje plano de un servicio. */ }
  addActivity({ ip: source, name: '', method: '', route: message, status: 'aviso', at: Date.now() })
}

function fit(value, width) {
  const text = String(value ?? '').replace(/[\r\n\t]/g, ' ')
  if (text.length <= width) return text.padEnd(width)
  if (width < 2) return text.slice(0, width)
  return `${text.slice(0, width - 1)}…`
}

function renderDashboard() {
  if (!process.stdout.isTTY) return
  const width = Math.max(64, process.stdout.columns || 120)
  const height = Math.max(16, process.stdout.rows || 30)
  const leftWidth = Math.floor((width - 7) * .36)
  const rightWidth = width - leftWidth - 7
  const now = Date.now()
  for (const [id, client] of clients) if (now - client.at > connectedWindowMs) clients.delete(id)
  const activeClients = [...clients.values()].sort((a, b) => b.at - a.at)
  const visibleRows = Math.max(3, height - 9)
  const clientLines = activeClients.slice(0, visibleRows).map((client) => {
    const ageSeconds = Math.max(0, Math.floor((now - client.at) / 1000))
    return `${client.ip} · ${client.name} · ${ageSeconds}s`
  })
  const activityLines = activities.slice(-visibleRows).reverse().map((event) => {
    const time = new Date(event.at).toLocaleTimeString('es-AR', { hour12: false })
    return `${time} · ${event.ip}${event.name ? ` · ${event.name}` : ''} · ${event.method} ${event.route} · ${event.status}`
  })
  if (!clientLines.length) clientLines.push('Esperando teléfonos…')
  if (!activityLines.length) activityLines.push('Todavía no hay actividad remota.')
  const rows = Math.max(clientLines.length, activityLines.length)
  const lines = [
    'BILLETERA UNIVERSITARIA · DEMO LOCAL',
    `Web: https://localhost:5173  ·  API: http://localhost:4001${addresses[0] ? `  ·  Teléfonos: https://${addresses[0]}:5173/?registro=1` : ''}`,
    '',
    `┌${'─'.repeat(leftWidth + 2)}┬${'─'.repeat(rightWidth + 2)}┐`,
    `│ ${fit(`CLIENTES CONECTADOS (${activeClients.length}) · ${connectedWindowMs / 1000}s`, leftWidth)} │ ${fit('ACTIVIDAD RECIENTE', rightWidth)} │`,
    `├${'─'.repeat(leftWidth + 2)}┼${'─'.repeat(rightWidth + 2)}┤`,
  ]
  for (let i = 0; i < rows; i += 1) lines.push(`│ ${fit(clientLines[i] ?? '', leftWidth)} │ ${fit(activityLines[i] ?? '', rightWidth)} │`)
  lines.push(`└${'─'.repeat(leftWidth + 2)}┴${'─'.repeat(rightWidth + 2)}┘`)
  lines.push('', 'Los teléfonos activos se actualizan cada 10 segundos. Ctrl+C detiene API e interfaz.')
  process.stdout.write(`\x1b[H\x1b[J${lines.slice(0, height).join('\n')}\x1b[?25l`)
}

console.log('\nBilletera Universitaria · Demo local')
console.log('Preparando API, interfaz y panel de actividad…\n')

function stop(code = 0) {
  if (stopping) return
  stopping = true
  exitCode = code
  clearInterval(renderTimer)
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h\nCerrando API e interfaz…\n')
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  const forceStop = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  }, 3000)
  forceStop.unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

function start(label, args) {
  const child = spawn(node, args, { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  children.push(child)
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue
    const lines = createInterface({ input: stream })
    lines.on('line', (line) => handleOutputLine(label, line))
  }
  child.once('error', (error) => {
    addActivity({ ip: label, name: '', method: '', route: error.message, status: 'error', at: Date.now() })
    stop(1)
  })
  child.once('exit', (code, signal) => {
    if (!stopping) {
      addActivity({ ip: label, name: '', method: '', route: `El servicio se detuvo${signal ? ` (${signal})` : ` (código ${code ?? 0})`}.`, status: 'error', at: Date.now() })
      stop(code ?? 1)
    }
    if (stopping && children.every((process) => process.exitCode !== null || process.signalCode !== null)) process.exit(exitCode)
  })
  return child
}

start('API', ['--import', tsxLoader, 'server/index.ts'])
start('Interfaz web', [viteCli, '--host', '0.0.0.0', '--logLevel', 'warn'])
if (process.stdout.isTTY) {
  process.stdout.write('\x1b[?25l')
  renderDashboard()
  renderTimer = setInterval(renderDashboard, 1000)
  process.stdout.on('resize', renderDashboard)
} else {
  console.log('Servicios disponibles: https://localhost:5173')
  for (const address of addresses) console.log(`Teléfonos: https://${address}:5173/?registro=1`)
  console.log('Ctrl+C detiene API e interfaz. Se mostrarán las solicitudes de los teléfonos.')
}
