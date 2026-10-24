import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'
import { api, downloadFile } from './lib/api'
import { signWalletProof, verifyCredential, type SignedCredential } from './lib/credentialCrypto'
import { clearWalletCredentials, listWalletCredentials, removeWalletCredential, storeWalletCredential, updateWalletCredentialStatus, type WalletCredential } from './lib/walletStore'

type CredentialKind = 'Alumno regular' | 'Regularidad' | 'Materia aprobada' | 'Nota de materia' | 'Biblioteca' | 'Gimnasio' | 'Souvenir'
type TabId = 'wallet' | 'issuer' | 'verify' | 'attendance' | 'connection' | 'souvenir' | 'class-photo'
type IssuedCredential = { id: string; kind: CredentialKind; title: string; detail: string; status: string; issuedAt: string; expiresAt: string | null; studentName?: string; enrollmentNumber?: string }
type DeliveryResponse = { credential: SignedCredential; delivery: { code: string; expiresAt: string } }
type VerifyRequest = { code: string; kind: CredentialKind; subject?: string; minimumGrade?: number | null; requestNote?: string | null; requiredClaims?: string[]; includeExactGrade?: boolean; expiresAt: string }
type AttendanceSession = { id: string; subject: string; section: string; expiresAt: string; status: string }
type SouvenirSession = { code: string; title: string; detail: string; expiresAt: string }
type DemoStudent = { id: string; fullName: string; enrollmentNumber: string; identityLocked: boolean; walletLinked: boolean }
type DemoActor = { id: string; role: 'student' | 'teacher' | 'institutional' | 'photographer'; name: string; scope?: 'academic' | 'library' | 'gym'; studentId?: string }
type AttendanceRoster = {
  teacherName: string
  courseName: string
  dates: { key: string; label: string }[]
  students: { id: string; fullName: string; attendance: Record<string, 'P' | 'A'> }[]
}
type NetworkInfo = { ssid: string; addresses: string[] }

const kinds: CredentialKind[] = ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia', 'Biblioteca', 'Gimnasio']
const tabs: { id: TabId; label: string }[] = [
  { id: 'wallet', label: 'Mi billetera' }, { id: 'issuer', label: 'Emisor' }, { id: 'verify', label: 'Verificar' }, { id: 'attendance', label: 'Asistencia' }, { id: 'connection', label: 'Conexión' }, { id: 'souvenir', label: 'Souvenir' }, { id: 'class-photo', label: 'Foto de la clase' },
]
const demoAccounts = [
  { id: 'student-mariano', label: 'Estudiante · Mariano Arias Simone', role: 'student' },
  { id: 'student-nahuel', label: 'Estudiante · Peralta Herrera Nahuel', role: 'student' },
  { id: 'teacher-marcelo', label: 'Profesor · Marcelo Roldan', role: 'teacher' },
  { id: 'admin-academic', label: 'Institución · Administración académica', role: 'institutional' },
  { id: 'admin-library', label: 'Institución · Biblioteca', role: 'institutional' },
  { id: 'admin-gym', label: 'Institución · Gimnasio', role: 'institutional' },
]
const iconFor = (kind: CredentialKind) => ({ 'Alumno regular': '◇', 'Materia aprobada': '✓', 'Nota de materia': '▣', Regularidad: '◈', Biblioteca: '▤', Gimnasio: '◌', Souvenir: '✦' }[kind])
const qrPayload = (kind: string, code: string) => `unlar-wallet:${kind}:${code}`
const formatDate = (value: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const normalizeText = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')

async function loadCanvasImage(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

async function createSouvenirImage(name: string, title: string, message: string, code: string, classPhotoDataUrl: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1000
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar la imagen del souvenir.')
  const qrImageData = await QRCode.toDataURL(qrPayload('souvenir', code), { width: 300, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#75510b', light: '#fff8df' } })
  const [logo, qrImage, classPhoto] = await Promise.all([loadCanvasImage('/logo-billetera-universitaria.png'), loadCanvasImage(qrImageData), loadCanvasImage(classPhotoDataUrl)])

  // La foto apaisada queda centrada dentro de un margen visible.
  const photoBox = { x: 48, y: 42, width: 1504, height: 916, radius: 34 }
  const photoScale = Math.max(photoBox.width / classPhoto.width, photoBox.height / classPhoto.height)
  const photoWidth = classPhoto.width * photoScale
  const photoHeight = classPhoto.height * photoScale
  context.save()
  context.beginPath(); context.roundRect(photoBox.x, photoBox.y, photoBox.width, photoBox.height, photoBox.radius); context.clip()
  context.drawImage(classPhoto, photoBox.x + (photoBox.width - photoWidth) / 2, photoBox.y + (photoBox.height - photoHeight) / 2, photoWidth, photoHeight)
  const shade = context.createLinearGradient(photoBox.x, 0, photoBox.x + photoBox.width, 0)
  shade.addColorStop(0, 'rgba(4, 17, 39, .58)'); shade.addColorStop(.5, 'rgba(8, 24, 47, .38)'); shade.addColorStop(1, 'rgba(8, 20, 40, .42)')
  context.fillStyle = shade; context.fillRect(photoBox.x, photoBox.y, photoBox.width, photoBox.height)
  const bottomShade = context.createLinearGradient(0, 600, 0, 950)
  bottomShade.addColorStop(0, 'rgba(8, 20, 40, 0)'); bottomShade.addColorStop(1, 'rgba(8, 20, 40, .62)')
  context.fillStyle = bottomShade; context.fillRect(photoBox.x, 600, photoBox.width, 360)
  context.restore()

  const frame = context.createLinearGradient(48, 0, 1552, 0)
  frame.addColorStop(0, '#ffdc83'); frame.addColorStop(.5, '#fff4ce'); frame.addColorStop(1, '#ffbd72')
  context.strokeStyle = frame; context.lineWidth = 4
  context.beginPath(); context.roundRect(photoBox.x, photoBox.y, photoBox.width, photoBox.height, photoBox.radius); context.stroke()

  const bursts = [[1320, 190, '#ffda76'], [1390, 630, '#ff72c6'], [940, 850, '#6de6ff'], [330, 820, '#ffd06a']]
  bursts.forEach(([x, y, color], burstIndex) => {
    const cx = Number(x); const cy = Number(y); const burstColor = String(color)
    for (let ray = 0; ray < 18; ray += 1) {
      const angle = (Math.PI * 2 * ray) / 18 + burstIndex * .12
      const inner = 17 + (ray % 3) * 4; const outer = 40 + (ray % 4) * 10
      context.beginPath(); context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
      context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
      context.strokeStyle = burstColor; context.globalAlpha = .44; context.lineWidth = ray % 3 === 0 ? 3 : 2; context.stroke()
      context.beginPath(); context.arc(cx + Math.cos(angle) * (outer + 8), cy + Math.sin(angle) * (outer + 8), 2 + (ray % 3), 0, Math.PI * 2)
      context.fillStyle = burstColor; context.fill()
    }
  })
  context.globalAlpha = 1
  for (let i = 0; i < 65; i += 1) {
    const x = (i * 197 + 61) % 1600; const y = (i * 283 + 47) % 1000
    context.beginPath(); context.arc(x, y, 2 + (i % 3), 0, Math.PI * 2)
    context.fillStyle = ['#fff0b8', '#a7edff', '#ffc8e8'][i % 3]; context.globalAlpha = .18 + (i % 4) * .08; context.fill()
  }
  context.globalAlpha = 1

  context.save(); context.shadowColor = '#ffd66e'; context.shadowBlur = 24; context.drawImage(logo, 112, 88, 92, 92); context.restore()
  context.textAlign = 'left'; context.fillStyle = '#fff'; context.font = '700 34px system-ui, sans-serif'; context.letterSpacing = '0px'
  context.fillText('Gracias por participar de nuestro proyecto', 232, 145)

  context.textAlign = 'left'; context.fillStyle = '#ffe08a'; context.font = '700 20px system-ui, sans-serif'; context.letterSpacing = '3px'
  context.fillText('ESTE RECUERDO ES PARA', 145, 640)
  const displayName = name.trim().replace(/\s+/g, ' ')
  context.font = 'italic 104px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'; context.letterSpacing = '0px'
  while (context.measureText(displayName).width > 1080 && parseInt(context.font.match(/\d+/)?.[0] ?? '104', 10) > 68) {
    const size = parseInt(context.font.match(/\d+/)?.[0] ?? '104', 10) - 6
    context.font = `italic ${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`
  }
  context.save(); context.shadowColor = '#ffe08a'; context.shadowBlur = 20; context.lineWidth = 2; context.strokeStyle = 'rgba(42, 27, 8, .7)'; context.fillStyle = '#fff4ce'
  context.strokeText(displayName, 145, 760); context.fillText(displayName, 145, 760); context.restore()

  context.textAlign = 'left'; context.fillStyle = '#fff'; context.font = '500 25px system-ui, sans-serif'; context.letterSpacing = '0px'
  const messageWords = message.trim().split(/\s+/); let messageLine = ''; let messageY = 825
  messageWords.forEach((word) => {
    const next = messageLine ? `${messageLine} ${word}` : word
    if (context.measureText(next).width > 1050 && messageLine) { context.fillText(messageLine, 150, messageY); messageY += 38; messageLine = word } else messageLine = next
  })
  if (messageLine) context.fillText(messageLine, 150, messageY)

  context.save(); context.shadowColor = '#ffdc83'; context.shadowBlur = 25
  context.fillStyle = '#fff8df'; context.beginPath(); context.roundRect(1300, 680, 170, 170, 16); context.fill()
  context.drawImage(qrImage, 1310, 690, 150, 150); context.restore()
  context.textAlign = 'center'; context.fillStyle = '#fff0bf'; context.font = '700 15px system-ui, sans-serif'; context.letterSpacing = '1px'
  context.fillText('MI BILLETERA · SOUVENIR', 1385, 875)
  context.fillStyle = '#fff'; context.font = '600 13px system-ui, sans-serif'; context.letterSpacing = '0px'
  context.fillText(title.toLocaleUpperCase('es-AR').slice(0, 24), 1385, 904)
  return canvas.toDataURL('image/png')
}

function QrDisplay({ value, label }: { value: string; label: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { void QRCode.toDataURL(value, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#113d60', light: '#ffffff' } }).then(setImage) }, [value])
  return <div className="qr-display">{image ? <img src={image} alt={label} /> : <span className="qr-placeholder">▦</span>}<small>{label}</small></div>
}

function SouvenirQrDisplay({ value }: { value: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { void QRCode.toDataURL(value, { width: 520, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#76510d', light: '#fff5cf' } }).then(setImage) }, [value])
  return <div className="souvenir-main-qr">{image ? <img src={image} alt="Código QR del souvenir personalizado" /> : <span>✦</span>}<strong>Escanea el QR para llevarte tu souvenir</strong></div>
}

function LoadingMark({ label = 'Cargando' }: { label?: string }) {
  return <span className="loading-mark" role="status" aria-label={label}><i />{label}</span>
}

function QrScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const browserError = !window.isSecureContext
    ? 'La cámara requiere HTTPS. Abrí el sistema por el enlace seguro para escanear desde Android.'
    : !navigator.mediaDevices?.getUserMedia
      ? 'Este navegador no permite acceder a la cámara. Probá con Chrome actualizado.'
      : ''
  useEffect(() => {
    let controls: { stop: () => void } | undefined
    let cancelled = false
    if (!browserError && videoRef.current) {
      const video = videoRef.current
      void import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
        if (cancelled) return undefined
        return new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video, (result, _error, nextControls) => {
          controls = nextControls
          if (result && !cancelled) { cancelled = true; nextControls.stop(); onScan(result.getText()) }
        })
      }).then((value) => { if (value) controls = value }).catch(() => setError('No se pudo abrir la cámara. Revisá el permiso del navegador e intentá nuevamente.'))
    }
    return () => { cancelled = true; controls?.stop() }
  }, [browserError, onScan])
  return <div className="scanner-backdrop"><section className="scanner-modal" role="dialog" aria-modal="true" aria-label="Escanear código QR"><div className="scanner-heading"><div><p className="eyebrow">Billetera UNLaR</p><h2>Escanear QR</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button></div><video ref={videoRef} className="scanner-video" muted playsInline />{(error || browserError) && <p className="scanner-error">{error || browserError}</p>}<p className="muted">Apuntá la cámara al código que muestra el otro celular.</p></section></div>
}

function App() {
  const pageParams = new URLSearchParams(window.location.search)
  const registrationMode = pageParams.get('inicio') !== '1' && (pageParams.get('registro') === '1'
    || !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname))
  const [actor, setActor] = useState<DemoActor | null>(null)
  const [loginAccount, setLoginAccount] = useState('teacher-marcelo')
  const [loginPassword, setLoginPassword] = useState('demo2026')
  const [loginError, setLoginError] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestError, setGuestError] = useState('')
  const [guestRestoreError, setGuestRestoreError] = useState('')
  const [guestAlreadyRegistered, setGuestAlreadyRegistered] = useState(() => localStorage.getItem('unlar-guest-registration') === 'complete')
  const [loginWorking, setLoginWorking] = useState(false)
  const [sessionChecking, setSessionChecking] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('wallet')
  const [credentials, setCredentials] = useState<WalletCredential[]>([])
  const [serverCredentials, setServerCredentials] = useState<IssuedCredential[]>([])
  const [issuerRefreshStatus, setIssuerRefreshStatus] = useState<'idle' | 'loading' | 'updated'>('idle')
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [notice, setNotice] = useState('Tu billetera está lista. Escaneá un QR para recibir o presentar credenciales.')
  const [credentialKind, setCredentialKind] = useState<CredentialKind>('Materia aprobada')
  const [subject, setSubject] = useState('Bases de Datos')
  const [grade, setGrade] = useState('')
  const [validityPreset, setValidityPreset] = useState('never')
  const [validityDays, setValidityDays] = useState('')
  const [attendanceSubject, setAttendanceSubject] = useState('Seminario de Actualización II')
  const [requestedKind, setRequestedKind] = useState<CredentialKind>('Materia aprobada')
  const [requestedSubject, setRequestedSubject] = useState('')
  const [requestedMinimumGrade, setRequestedMinimumGrade] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [shareFields, setShareFields] = useState<Record<string, boolean>>({})
  const [requestName, setRequestName] = useState(false)
  const [requestEnrollment, setRequestEnrollment] = useState(false)
  const [requestExactGrade, setRequestExactGrade] = useState(false)
  const [qr, setQr] = useState<{ value: string; label: string; expiresAt: string } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [pendingVerify, setPendingVerify] = useState<VerifyRequest | null>(null)
  const [verifyShareError, setVerifyShareError] = useState('')
  const [pendingAttendance, setPendingAttendance] = useState<AttendanceSession | null>(null)
  const [attendanceError, setAttendanceError] = useState('')
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<{ holder: string; studentId: string; studentName: string; recordedAt: string }[]>([])
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [recipientStudentId, setRecipientStudentId] = useState('mariano-arias-simone')
  const [souvenirTitle, setSouvenirTitle] = useState('Souvenir · Seminario de Actualización II')
  const [souvenirMessage, setSouvenirMessage] = useState('Gracias por participar de nuestro proyecto.')
  const [souvenirSession, setSouvenirSession] = useState<SouvenirSession | null>(null)
  const [souvenirQrOpen, setSouvenirQrOpen] = useState(false)
  const [souvenirPreview, setSouvenirPreview] = useState<{ image: string; name: string } | null>(null)
  const [classPhotoPreview, setClassPhotoPreview] = useState('')
  const [classPhotoSavedAt, setClassPhotoSavedAt] = useState('')
  const [classPhotoWorking, setClassPhotoWorking] = useState(false)
  const [classPhotoStatus, setClassPhotoStatus] = useState(false)
  const [demoStudents, setDemoStudents] = useState<DemoStudent[]>([])
  const [attendanceRoster, setAttendanceRoster] = useState<AttendanceRoster | null>(null)
  const [attendanceDownloadError, setAttendanceDownloadError] = useState('')
  const [attendanceDownloadWorking, setAttendanceDownloadWorking] = useState(false)
  const [resetWorking, setResetWorking] = useState(false)
  const [credentialDeletingId, setCredentialDeletingId] = useState('')
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>({ ssid: '', addresses: [] })
  const [wifiPassword, setWifiPassword] = useState('')
  const [wifiSsidOverride, setWifiSsidOverride] = useState('')
  const [wifiSecurity, setWifiSecurity] = useState<'WPA' | 'nopass'>('WPA')
  const [showWifiQr, setShowWifiQr] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; title: string; kind: string; subject?: string; grade?: string; studentName?: string; minimumGrade?: number; minimumGradeMet?: boolean; verifiedAt: string } | null>(null)
  const selectedCredential = useMemo(() => credentials.find((credential) => credential.id === selectedCredentialId) ?? credentials[0], [credentials, selectedCredentialId])
  const matchingVerificationCredentials = pendingVerify ? credentials.filter((credential) => {
    if (credential.type !== pendingVerify.kind || credential.localStatus !== 'Activa') return false
    const subject = credential.claims.materia ?? credential.claims.titulo ?? ''
    if (pendingVerify.subject && normalizeText(subject) !== normalizeText(pendingVerify.subject)) return false
    if (pendingVerify.minimumGrade != null && !Number.isFinite(Number(credential.claims.nota))) return false
    return true
  }) : []
  const savedStudent = demoStudents.find((student) => student.id === studentId)
  const goToMainPage = () => window.location.assign(`${window.location.pathname}?inicio=1`)
  const allowedTabs = tabs.filter((tab) => actor?.role === 'student' ? tab.id === 'wallet' : actor?.role === 'photographer' ? ['wallet', 'class-photo'].includes(tab.id) : actor?.role === 'teacher' ? ['verify', 'attendance', 'connection', 'souvenir'].includes(tab.id) : tab.id === 'issuer')
  const allowedKinds: CredentialKind[] = actor?.scope === 'library' ? ['Biblioteca'] : actor?.scope === 'gym' ? ['Gimnasio'] : ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia']

  useEffect(() => {
    if (activeTab !== 'connection') return
    const refreshNetworkInfo = () => { void api<NetworkInfo>('/api/network-info').then(setNetworkInfo).catch(() => undefined) }
    refreshNetworkInfo()
    const timer = window.setInterval(refreshNetworkInfo, 5000)
    return () => window.clearInterval(timer)
  }, [activeTab])
  useEffect(() => {
    if (!['class-photo', 'souvenir'].includes(activeTab)) return
    let cancelled = false
    void api<{ available: boolean; updatedAt?: string }>('/api/rewards/class-photo').then((status) => {
      if (!cancelled) { setClassPhotoStatus(status.available); setClassPhotoSavedAt(status.updatedAt ?? '') }
    }).catch(() => { if (!cancelled) setClassPhotoStatus(false) })
    return () => { cancelled = true }
  }, [activeTab])
  const localAppUrl = useMemo(() => {
    const host = networkInfo.addresses[0]
    return `${host ? `${window.location.protocol}//${host}:${window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}` : window.location.origin}/?registro=1`
  }, [networkInfo.addresses])
  const wifiSsid = networkInfo.ssid || wifiSsidOverride.trim()
  const wifiQr = wifiSsid && (wifiSecurity === 'nopass' || wifiPassword) ? `WIFI:T:${wifiSecurity};S:${wifiSsid.replace(/[\\;,":]/g, '\\$&')};${wifiSecurity === 'WPA' ? `P:${wifiPassword.replace(/[\\;,":]/g, '\\$&')};` : ''};` : ''

  const login = async () => {
    setLoginWorking(true)
    setLoginError('')
    try {
      const result = await api<{ token: string; actor: DemoActor }>('/api/demo/login', { method: 'POST', body: JSON.stringify({ account: loginAccount, password: loginPassword }) })
      localStorage.setItem('unlar-demo-token', result.token)
      localStorage.setItem('unlar-demo-account', result.actor.id)
      setActor(result.actor)
      setStudentId(result.actor.studentId ?? '')
      setStudentName(result.actor.role === 'student' ? result.actor.name : '')
      setActiveTab(result.actor.role === 'student' ? 'wallet' : result.actor.role === 'teacher' ? 'attendance' : 'issuer')
      if (result.actor.scope === 'library') setCredentialKind('Biblioteca')
      else if (result.actor.scope === 'gym') setCredentialKind('Gimnasio')
      else setCredentialKind('Materia aprobada')
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'No se pudo iniciar sesión.') }
    finally { setLoginWorking(false) }
  }

  const registerGuest = async () => {
    const fullName = guestName.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2 || fullName.length > 100) { setGuestError('Escribí tu nombre y apellido.'); return }
    setLoginWorking(true)
    setGuestError('')
    try {
      const proof = await signWalletProof(`guest-register.${fullName}`)
      const result = await api<{ token: string; actor: DemoActor; enrollmentNumber: string }>('/api/guests/register', { method: 'POST', body: JSON.stringify({ fullName, ...proof }) })
      localStorage.setItem('unlar-demo-token', result.token)
      localStorage.setItem('unlar-demo-account', 'guest')
      localStorage.setItem('unlar-guest-registration', 'complete')
      setActor(result.actor)
      setStudentId(result.actor.studentId ?? '')
      setStudentName(result.actor.name)
      setActiveTab(result.actor.role === 'photographer' ? 'class-photo' : 'wallet')
      setNotice(result.actor.role === 'photographer' ? 'Acceso de fotografía listo. Sacá la foto y guardala en la Mac.' : `Registro listo, ${result.actor.name}. Esta billetera quedó vinculada y ya podés marcar asistencia.`)
      window.history.replaceState({}, '', window.location.pathname)
    } catch (error) { setGuestError(error instanceof Error ? error.message : 'No se pudo completar el registro.') }
    finally { setLoginWorking(false) }
  }

  const restoreGuestSession = async () => {
    const proof = await signWalletProof('guest-restore')
    const result = await api<{ token: string; actor: DemoActor }>('/api/guests/restore', { method: 'POST', body: JSON.stringify(proof) })
    localStorage.setItem('unlar-demo-token', result.token)
    localStorage.setItem('unlar-demo-account', 'guest')
    localStorage.setItem('unlar-guest-registration', 'complete')
    setActor(result.actor)
    setStudentId(result.actor.studentId ?? '')
    setStudentName(result.actor.name)
    setActiveTab(result.actor.role === 'photographer' ? 'class-photo' : 'wallet')
    setNotice(`Bienvenido/a nuevamente, ${result.actor.name}. Se recuperó la sesión de tu billetera.`)
  }

  const logout = () => {
    localStorage.removeItem('unlar-demo-token')
    localStorage.removeItem('unlar-demo-account')
    setActor(null)
    setCredentials([])
    setServerCredentials([])
    setQr(null)
    setPendingAttendance(null)
    setPendingVerify(null)
  }

  const refreshWallet = useCallback(async () => {
    let walletItems = await listWalletCredentials()
    try {
      const registry = await api<{ id: string; status: string }[]>('/api/credentials')
      const statuses = new Map(registry.map((credential) => [credential.id, credential.status]))
      await Promise.all(walletItems.map((credential) => updateWalletCredentialStatus(credential.id, statuses.get(credential.id) === 'Activa' ? 'Activa' : statuses.get(credential.id) === 'Revocada' ? 'Revocada' : 'No registrada')))
      walletItems = await listWalletCredentials()
    } catch {
      // Si el emisor está desconectado, se conserva la última copia local.
    }
    setCredentials(walletItems)
    if (walletItems.length) setSelectedCredentialId((current) => walletItems.some((item) => item.id === current) ? current : walletItems[0].id)
  }, [])

  const refreshIssuer = useCallback(async (showFeedback = false) => {
    if (showFeedback) setIssuerRefreshStatus('loading')
    try {
      const rows = await api<IssuedCredential[]>('/api/credentials')
      setServerCredentials(rows)
      if (showFeedback) setIssuerRefreshStatus('updated')
    } catch (error) {
      if (showFeedback) setIssuerRefreshStatus('idle')
      throw error
    }
  }, [])

  const refreshStudents = useCallback(async () => {
    const rows = await api<DemoStudent[]>('/api/students')
    setDemoStudents(rows)
    const savedProfile = rows.find((student) => student.id === actor?.studentId)
    if (savedProfile) {
      setStudentId(savedProfile.id)
      setStudentName(savedProfile.fullName)
    }
  }, [actor?.studentId])

  const refreshAttendanceRoster = useCallback(async () => {
    setAttendanceRoster(await api<AttendanceRoster>('/api/attendance/roster'))
  }, [])

  const downloadAttendance = async () => {
    setAttendanceDownloadError('')
    setAttendanceDownloadWorking(true)
    try {
      await downloadFile('/api/attendance/export.csv', 'planilla-asistencia.csv')
    } catch (error) {
      setAttendanceDownloadError(error instanceof Error ? error.message : 'No se pudo descargar la planilla.')
    } finally {
      setAttendanceDownloadWorking(false)
    }
  }

  const resetDemo = async () => {
    if (!window.confirm('¿Reiniciar la demo? Se borrarán invitados, foto de la clase, asistencias y credenciales. Solo quedarán Mariano y Nahuel.')) return
    setResetWorking(true)
    try {
      await api('/api/demo/reset', { method: 'POST' })
      setAttendance(null)
      setAttendanceRecords([])
      setQr(null)
      await Promise.all([refreshAttendanceRoster(), refreshStudents()])
      setNotice('Demo reiniciada. Solo quedan Mariano y Nahuel; ya podés empezar otra prueba.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo reiniciar la demo.') }
    finally { setResetWorking(false) }
  }

  // La carga inicial sincroniza el estado de React con IndexedDB y la API.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    const token = localStorage.getItem('unlar-demo-token')
    const account = localStorage.getItem('unlar-demo-account')
    const isRegisteredGuest = account === 'guest' || localStorage.getItem('unlar-guest-registration') === 'complete'
    const restore = async () => {
      try {
        if (token && account) {
          try {
            const { actor: current } = await api<{ actor: DemoActor }>('/api/demo/me')
            setActor(current)
            setStudentId(current.studentId ?? '')
            setStudentName(current.role === 'student' ? current.name : '')
            setActiveTab(current.role === 'student' ? 'wallet' : current.role === 'photographer' ? 'class-photo' : current.role === 'teacher' ? 'attendance' : 'issuer')
            return
          } catch (error) {
            if (!isRegisteredGuest) throw error
          }
        }
        if (!isRegisteredGuest) return
        await restoreGuestSession()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo recuperar esta billetera en el servidor.'
        if (isRegisteredGuest && message.includes('No encontramos un registro vinculado a esta billetera.')) {
          localStorage.removeItem('unlar-demo-token')
          localStorage.removeItem('unlar-demo-account')
          localStorage.removeItem('unlar-guest-registration')
          setGuestAlreadyRegistered(false)
          setGuestRestoreError('')
          void clearWalletCredentials()
          window.location.replace(`${window.location.pathname}?registro=1`)
        } else if (isRegisteredGuest) setGuestRestoreError(message)
        else logout()
      } finally { setSessionChecking(false) }
    }
    void restore()
  // Restore the short-lived in-memory demo session on page reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!actor) return
    void refreshWallet()
    void refreshIssuer().catch(() => undefined)
    void refreshStudents().catch(() => undefined)
    if (actor.role === 'teacher') void refreshAttendanceRoster().catch(() => undefined)
    else setAttendanceRoster(null)
  }, [actor, refreshAttendanceRoster, refreshIssuer, refreshStudents, refreshWallet])

  useEffect(() => {
    let clientId = localStorage.getItem('unlar-client-id')
    if (!clientId) {
      clientId = crypto.randomUUID()
      localStorage.setItem('unlar-client-id', clientId)
    }
    const announcePresence = () => { void api('/api/presence', { method: 'POST', body: JSON.stringify({ clientId }) }).catch(() => undefined) }
    announcePresence()
    const timer = window.setInterval(announcePresence, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!((activeTab === 'issuer' && actor?.role === 'institutional') || (activeTab === 'souvenir' && actor?.role === 'teacher'))) return
    const refresh = () => { void refreshStudents().catch(() => undefined) }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => window.clearInterval(timer)
  }, [activeTab, actor?.role, refreshStudents])

  useEffect(() => {
    if (activeTab !== 'attendance' || actor?.role !== 'teacher') return
    const refresh = () => {
      void refreshAttendanceRoster().catch(() => undefined)
      if (attendance) void api<typeof attendanceRecords>(`/api/attendance/sessions/${attendance.id}/records`).then(setAttendanceRecords).catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => window.clearInterval(timer)
  }, [activeTab, actor?.role, attendance, refreshAttendanceRoster])

  useEffect(() => {
    if (activeTab !== 'wallet' || actor?.role !== 'student') return
    const timer = window.setInterval(() => { void refreshWallet().catch(() => undefined) }, 5000)
    return () => window.clearInterval(timer)
  }, [activeTab, actor?.role, refreshWallet])

  const saveStudentProfile = async () => {
    if (!savedStudent || !studentId) {
      setNotice('No se encontró el perfil de estudiante asociado a esta cuenta.')
      return
    }
    setWorking(true)
    try {
      const proof = await signWalletProof(`student.${studentId}.${savedStudent.enrollmentNumber}`)
      const registered = await api<DemoStudent>('/api/students/register', {
        method: 'POST', body: JSON.stringify({ fullName: savedStudent.fullName, ...proof }),
      })
      setStudentId(registered.id)
      setStudentName(registered.fullName)
      setNotice(`Billetera vinculada a ${registered.fullName} · matrícula ${registered.enrollmentNumber}.`)
      await refreshStudents()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudieron guardar los datos del estudiante.') }
    finally { setWorking(false) }
  }

  const issueCredential = async () => {
    const parsedGrade = Number(grade)
    if (credentialKind === 'Regularidad' && !subject.trim()) {
      setNotice('Ingresá la materia para emitir la regularidad.')
      return
    }
    if (credentialKind === 'Nota de materia' && (!grade || !Number.isFinite(parsedGrade) || parsedGrade < 1 || parsedGrade > 10)) {
      setNotice('Ingresá una nota entre 1 y 10 para emitir esta credencial.')
      return
    }
    setWorking(true)
    try {
      const title = credentialKind === 'Alumno regular' ? 'Alumno regular' : credentialKind === 'Biblioteca' ? subject.trim() || 'Acceso a biblioteca' : credentialKind === 'Gimnasio' ? subject.trim() || 'Acceso al gimnasio' : subject.trim() || 'Materia sin especificar'
      const detail = credentialKind === 'Alumno regular' ? 'Condición: alumno regular' : credentialKind === 'Regularidad' ? 'Condición: regular' : credentialKind === 'Materia aprobada' ? 'Condición: aprobada' : credentialKind === 'Nota de materia' ? `Nota: ${parsedGrade}` : 'Membresía activa'
      const selectedDays = validityPreset === 'custom' ? Number(validityDays) : validityPreset === 'never' ? undefined : Number(validityPreset)
      if (selectedDays !== undefined && (!Number.isInteger(selectedDays) || selectedDays < 1 || selectedDays > 36500)) { setNotice('Indicá una vigencia en días entre 1 y 36500.'); return }
      const response = await api<DeliveryResponse>('/api/credentials', { method: 'POST', body: JSON.stringify({ kind: credentialKind, title, detail, ...(credentialKind === 'Nota de materia' ? { grade: parsedGrade } : {}), studentId: recipientStudentId, ...(selectedDays !== undefined ? { validityDays: selectedDays } : {}) }) })
      const valid = await verifyCredential(response.credential, (await api<{ publicKeyPem: string }>('/api/issuer-key')).publicKeyPem)
      if (!valid) throw new Error('El servidor emitió una credencial con firma inválida.')
      setQr({ value: qrPayload('delivery', response.delivery.code), label: 'Escaneá para guardar esta credencial', expiresAt: response.delivery.expiresAt })
      setNotice(`Credencial emitida y firmada por el servidor: ${title}. El QR vence en 10 minutos.`)
      await refreshIssuer()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo emitir la credencial.') }
    finally { setWorking(false) }
  }

  const revokeCredential = async (credential: IssuedCredential) => {
    try {
      await api(`/api/credentials/${credential.id}/revoke`, { method: 'POST' })
      setNotice(`Credencial revocada: ${credential.title}. Los próximos intentos de verificación serán rechazados.`)
      await refreshIssuer()
      await refreshWallet()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo revocar la credencial.') }
  }

  const deleteIssuedCredential = async (credential: IssuedCredential) => {
    const confirmed = window.confirm(`¿Eliminar del registro del emisor “${credential.title}”? Se borrará también su QR de entrega. La copia que ya esté guardada en la billetera del estudiante no se borra desde acá y dejará de validarse en el registro.`)
    if (!confirmed) return
    setCredentialDeletingId(credential.id)
    try {
      await api(`/api/credentials/${credential.id}`, { method: 'DELETE' })
      setQr(null)
      setNotice(`Credencial eliminada del registro: ${credential.title}.`)
      await refreshIssuer()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo eliminar la credencial.') }
    finally { setCredentialDeletingId('') }
  }

  const deleteWalletCredential = async (credential: WalletCredential) => {
    if (credential.localStatus === 'Activa') return
    const confirmed = window.confirm(`¿Borrar “${credential.claims.titulo}” de esta billetera? Solo se elimina la copia guardada en este dispositivo.`)
    if (!confirmed) return
    try {
      await removeWalletCredential(credential.id)
      const remaining = await listWalletCredentials()
      setCredentials(remaining)
      setSelectedCredentialId((current) => current === credential.id ? remaining[0]?.id ?? '' : current)
      setNotice(`Se borró “${credential.claims.titulo}” de esta billetera.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo borrar la credencial de esta billetera.') }
  }

  const createPresentationRequest = async () => {
    const courseCredential = ['Regularidad', 'Materia aprobada', 'Nota de materia'].includes(requestedKind)
    const parsedMinimumGrade = requestedMinimumGrade ? Number(requestedMinimumGrade) : undefined
    if (requestedSubject.trim().length > 120) { setNotice('La materia debe tener como máximo 120 caracteres.'); return }
    if (requestedKind === 'Nota de materia' && parsedMinimumGrade !== undefined && (!Number.isFinite(parsedMinimumGrade) || parsedMinimumGrade < 1 || parsedMinimumGrade > 10)) { setNotice('La nota mínima debe estar entre 1 y 10.'); return }
    if (requestNote.trim().length > 300) { setNotice('El detalle debe tener como máximo 300 caracteres.'); return }
    setWorking(true)
    try {
      const request = await api<VerifyRequest>('/api/presentation-requests', { method: 'POST', body: JSON.stringify({ kind: requestedKind, ...(courseCredential && requestedSubject.trim() ? { subject: requestedSubject.trim() } : {}), ...(requestedKind === 'Nota de materia' && parsedMinimumGrade !== undefined ? { minimumGrade: parsedMinimumGrade } : {}), ...(requestNote.trim() ? { requestNote: requestNote.trim() } : {}), requiredClaims: [...(requestName ? ['nombreEstudiante'] : []), ...(requestEnrollment ? ['matricula'] : []), ...(requestExactGrade ? ['nota'] : [])], includeExactGrade: requestExactGrade, minutes: 5 }) })
      setQr({ value: qrPayload('verify', request.code), label: `Solicitud de ${request.kind} · un solo uso`, expiresAt: request.expiresAt })
      setVerifyResult(null)
      setNotice('Solicitud creada. El resultado aparecerá automáticamente cuando el titular responda desde su billetera.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo crear la solicitud.') }
    finally { setWorking(false) }
  }

  const openAttendance = async () => {
    setWorking(true)
    try {
      const session = await api<AttendanceSession>('/api/attendance/sessions', { method: 'POST', body: JSON.stringify({ subject: attendanceSubject.trim() || 'Seminario de Actualización II', section: 'Comisión A', minutes: 1 }) })
      setAttendance(session)
      setAttendanceRecords([])
      setQr({ value: qrPayload('attendance', session.id), label: 'QR de asistencia · vence en 1 minuto', expiresAt: session.expiresAt })
      setNotice(`Asistencia abierta para ${session.subject}. El QR expira a los ${formatDate(session.expiresAt)}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo abrir la asistencia.') }
    finally { setWorking(false) }
  }

  const createSouvenirSession = async () => {
    if (!souvenirTitle.trim() || !souvenirMessage.trim()) { setNotice('Completá el título y el mensaje del souvenir.'); return }
    setWorking(true)
    try {
      const photoStatus = await api<{ available: boolean }>('/api/rewards/class-photo')
      if (!photoStatus.available) throw new Error('Primero guardá la foto de la clase desde el celular fotografo.')
      const session = await api<SouvenirSession>('/api/rewards/sessions', { method: 'POST', body: JSON.stringify({ title: souvenirTitle.trim(), detail: souvenirMessage.trim() }) })
      setSouvenirSession(session)
      setSouvenirQrOpen(true)
      setNotice('QR general creado. Cada participante recibirá una imagen personalizada al escanearlo desde su billetera.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo generar el QR general.') }
    finally { setWorking(false) }
  }

  const saveClassPhoto = async (file?: File) => {
    if (!file) return
    setClassPhotoWorking(true)
    setNotice('Preparando la foto para guardarla en la Mac…')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1800 / bitmap.width, 1400 / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No se pudo preparar la foto en este teléfono.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
      if (dataUrl.length > 4_100_000) throw new Error('La foto quedó muy pesada. Elegí otra o tomala con menor resolución.')
      setClassPhotoPreview(dataUrl)
      const result = await api<{ saved: boolean; updatedAt: string }>('/api/rewards/class-photo', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      setClassPhotoStatus(true)
      setClassPhotoSavedAt(result.updatedAt)
      setNotice('Foto guardada en la Mac. Ya aparecerá en los souvenirs personalizados.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar la foto en la Mac.') }
    finally { setClassPhotoWorking(false) }
  }

  const handleScan = useCallback(async (value: string) => {
    setScannerOpen(false)
    const match = /^unlar-wallet:(delivery|verify|attendance|souvenir):([A-Za-z0-9_-]+)$/.exec(value.trim())
    if (!match) { setNotice('El QR no pertenece a esta billetera.'); return }
    const [, type, code] = match
    setWorking(true)
    try {
      if (type === 'delivery') {
        if (!studentId || !savedStudent) throw new Error('Iniciá sesión con el perfil de estudiante destinatario antes de recibir la credencial.')
        const holder = `did:unlar:student:${studentId}`
        const bindingProof = await signWalletProof(`claim.${code}.${holder}`)
        const response = await api<{ credential: SignedCredential }>(`/api/deliveries/${code}/claim`, { method: 'POST', body: JSON.stringify(bindingProof) })
        const key = await api<{ publicKeyPem: string }>('/api/issuer-key')
        if (!(await verifyCredential(response.credential, key.publicKeyPem))) throw new Error('La firma del emisor no es válida. La credencial no se guardó.')
        await storeWalletCredential(response.credential)
        await refreshWallet()
        setActiveTab('wallet')
        setNotice(`Credencial verificada y guardada en este celular: ${response.credential.claims.titulo}.`)
      } else if (type === 'souvenir') {
        if (!studentId || !savedStudent) throw new Error('Registrate o iniciá sesión en tu billetera antes de reclamar el souvenir.')
        const photo = await api<{ dataUrl: string }>('/api/rewards/class-photo/image')
        const holder = `did:unlar:student:${studentId}`
        const proof = await signWalletProof(`reward-claim.${code}.${holder}`)
        const response = await api<{ credential: SignedCredential; alreadyClaimed?: boolean }>(`/api/rewards/${code}/claim`, { method: 'POST', body: JSON.stringify(proof) })
        const key = await api<{ publicKeyPem: string }>('/api/issuer-key')
        if (!(await verifyCredential(response.credential, key.publicKeyPem))) throw new Error('La firma del souvenir no es válida; no se guardó en la billetera.')
        await storeWalletCredential(response.credential)
        await refreshWallet()
        const image = await createSouvenirImage(response.credential.claims.nombreEstudiante ?? savedStudent.fullName, response.credential.claims.titulo, response.credential.claims.detalle, code, photo.dataUrl)
        setSouvenirPreview({ image, name: response.credential.claims.nombreEstudiante ?? savedStudent.fullName })
        setActiveTab('wallet')
        setNotice(response.alreadyClaimed ? 'Ya tenías este souvenir. Acá está tu recuerdo personalizado.' : '¡Tu souvenir personalizado ya está en tu billetera!')
      } else if (type === 'verify') {
        const request = await api<VerifyRequest>(`/api/presentation-requests/${code}`)
        setVerifyShareError('')
        setPendingVerify(request)
        setShareFields(Object.fromEntries([...(request.requiredClaims ?? []), ...(request.subject ? ['materia'] : []), ...(request.minimumGrade != null ? [`cumpleNotaMinima${request.minimumGrade}`] : [])].map((key) => [key, true])))
        setActiveTab('wallet')
        setNotice(`El verificador solicita ${request.kind}. Revisá los datos y confirmá si querés compartirlos.`)
      } else {
        const session = await api<AttendanceSession>(`/api/attendance/sessions/${code}`)
        setPendingAttendance(session)
        setActiveTab('wallet')
        setNotice(`El profesor solicita registrar asistencia en ${session.subject}. Confirmá para enviar la prueba de tu billetera.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo procesar el QR.') }
    finally { setWorking(false) }
  }, [refreshWallet, savedStudent, studentId])

  const downloadSouvenir = () => {
    if (!souvenirPreview) return
    const link = document.createElement('a')
    link.href = souvenirPreview.image
    link.download = `souvenir-unlar-${souvenirPreview.name.trim().replace(/\s+/g, '-').toLowerCase()}.png`
    link.click()
  }

  const shareSouvenir = async () => {
    if (!souvenirPreview) return
    try {
      const blob = await (await fetch(souvenirPreview.image)).blob()
      const file = new File([blob], 'souvenir-unlar.png', { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi recuerdo UNLaR', text: '¡Gracias por participar de nuestro proyecto!' })
      } else {
        downloadSouvenir()
        setNotice('La imagen se descargó. Ya podés adjuntarla en WhatsApp, Instagram u otra app.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setNotice('No se pudo abrir el menú para compartir. Descargá la imagen para enviarla desde tu app favorita.')
    }
  }

  const shareCredential = async (credential: WalletCredential) => {
    if (!pendingVerify) return
    setVerifyShareError('')
    setWorking(true)
    try {
      const proof = await signWalletProof(`${pendingVerify.code}.${credential.id}.${credential.holder}`)
      const claims = Object.fromEntries(Object.entries(credential.claims).filter(([key]) => shareFields[key]))
      if (shareFields.materia) claims.materia = credential.claims.materia ?? credential.claims.titulo
      if (pendingVerify.minimumGrade != null) claims[`cumpleNotaMinima${pendingVerify.minimumGrade}`] = String(Number(credential.claims.nota) >= pendingVerify.minimumGrade)
      await api(`/api/presentation-requests/${pendingVerify.code}/respond`, { method: 'POST', body: JSON.stringify({ credential: { ...credential, claims }, ...proof }) })
      setPendingVerify(null)
      setVerifyShareError('')
      setNotice(`Presentación enviada al verificador: ${credential.claims.titulo}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo presentar la credencial.'
      if (/revocada/i.test(message)) {
        await refreshWallet()
        setPendingVerify(null)
        setNotice(`El emisor revocó “${credential.claims.titulo}”. Se actualizó su estado y no se compartió.`)
      } else {
        setVerifyShareError(message)
        setNotice(message)
      }
    }
    finally { setWorking(false) }
  }

  const confirmAttendance = async () => {
    if (!pendingAttendance) return
    if (!studentId || savedStudent?.fullName !== studentName.trim()) {
      setNotice('Primero completá y guardá tus datos de estudiante en Mi billetera.')
      setPendingAttendance(null)
      return
    }
    setAttendanceError('')
    setWorking(true)
    try {
      const proof = await signWalletProof(`attendance.${pendingAttendance.id}.${studentId}`)
      await api(`/api/attendance/sessions/${pendingAttendance.id}/check-in`, { method: 'POST', body: JSON.stringify({ studentId, ...proof }) })
      setPendingAttendance(null)
      setNotice(`Asistencia registrada para ${pendingAttendance.subject}.`)
      await refreshAttendanceRoster()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar la asistencia.'
      setAttendanceError(message)
      setNotice(message)
    }
    finally { setWorking(false) }
  }

  const pollVerification = useCallback(async () => {
    if (!qr || !qr.value.includes(':verify:')) return
    if (Date.parse(qr.expiresAt) <= Date.now()) {
      setQr(null)
      setNotice('La solicitud venció. Generá un QR nuevo para verificar otra credencial.')
      return
    }
    const code = qr.value.split(':').at(-1)
    try {
      const response = await api<{ status: string; result?: { valid: boolean; title: string; kind: string; subject?: string; grade?: string; studentName?: string; minimumGrade?: number; minimumGradeMet?: boolean; verifiedAt: string } }>(`/api/presentation-requests/${code}/result`)
      if (response.result) {
        setVerifyResult(response.result)
        const holder = response.result.studentName ? ` · ${response.result.studentName}` : ''
        setNotice(`Credencial válida: ${response.result.title} · firma, vigencia, titular y estado verificados${holder}.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo consultar el resultado.') }
  }, [qr])

  useEffect(() => {
    if (activeTab !== 'verify' || actor?.role !== 'teacher' || !qr?.value.includes(':verify:') || verifyResult) return
    void pollVerification()
    const timer = window.setInterval(() => { void pollVerification() }, 1500)
    return () => window.clearInterval(timer)
  }, [activeTab, actor?.role, pollVerification, qr, verifyResult])

  const closeAttendance = async () => {
    if (!attendance) return
    try {
      await api(`/api/attendance/sessions/${attendance.id}/close`, { method: 'POST' })
      setAttendance({ ...attendance, status: 'Cerrada' })
      setQr(null)
      setNotice(`Asistencia cerrada. Registros recibidos: ${attendanceRecords.length}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo cerrar la asistencia.') }
  }

  if (!actor && sessionChecking) return <main className="login-page"><header className="topbar"><button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Ir a la página principal"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja" /></button></header><section className="login-card"><LoadingMark label="Recuperando tu billetera…" /></section></main>
  if (!actor && !registrationMode && !guestAlreadyRegistered) return <main className="login-page"><header className="topbar"><button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Ir a la página principal"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja" /></button></header><section className="login-card"><p className="eyebrow">Acceso del responsable de la demo</p><h1>Ingresar</h1><p className="muted">Elegí el perfil del docente o de la institución para administrar la jornada.</p><label>Perfil<select value={loginAccount} onChange={(event) => setLoginAccount(event.target.value)}>{demoAccounts.filter((account) => account.role !== 'student').map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}</select></label><label>Contraseña<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /></label>{loginError && <p className="scanner-error">{loginError}</p>}<button type="button" className="primary-button" onClick={() => void login()} disabled={loginWorking}>{loginWorking && <span className="button-spinner" />}{loginWorking ? 'Ingresando…' : 'Ingresar'}</button></section><footer>Universidad Nacional de La Rioja · Credenciales digitales</footer></main>
  if (!actor) return <main className="login-page"><header className="topbar"><button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Volver a la página principal"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja — volver al inicio" /></button></header><section className="login-card guest-register-card"><p className="eyebrow">Asistente · registro gratuito</p><h1>Registrate para la jornada</h1>{guestAlreadyRegistered ? <><p className="muted">Este navegador ya se registró para la demo. Tu billetera y tu nombre quedaron guardados en este dispositivo.</p><p className="muted">Volvé a la pantalla principal de la billetera para continuar. No es posible crear otro registro desde este navegador.</p>{guestRestoreError && <p className="scanner-error" role="alert">No se pudo recuperar la billetera: {guestRestoreError}</p>}<button type="button" className="primary-button" onClick={goToMainPage}>Ir a la página principal</button></> : <><p className="muted">Escribí tu nombre y apellido. Se creará una billetera en este teléfono y quedará vinculada a tu registro para asistencia y certificados.</p><label>Nombre y apellido<input autoComplete="name" value={guestName} onChange={(event) => setGuestName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void registerGuest() }} placeholder="Ej.: Ana Pérez" maxLength={100} /></label>{guestError && <p className="scanner-error" role="alert">{guestError}</p>}<button type="button" className="primary-button" onClick={() => void registerGuest()} disabled={loginWorking}>{loginWorking && <span className="button-spinner" />}{loginWorking ? 'Creando tu billetera…' : 'Registrarme y crear billetera'}</button><p className="muted">La billetera queda guardada en este navegador. Usá el mismo teléfono para recibir tu certificado.</p></>}</section><footer>Universidad Nacional de La Rioja · Credenciales digitales</footer></main>

  return (
    <main>
      <header className="topbar"><button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Volver a la página principal"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja — UNLaR" /></button><div className="session-badge"><span><strong>{actor.name}</strong><small>{actor.role === 'student' ? 'Estudiante' : actor.role === 'photographer' ? 'Fotografía de la clase' : actor.role === 'teacher' ? 'Profesor · permisos de asistencia' : `Institución · ${actor.scope === 'academic' ? 'área académica' : actor.scope === 'library' ? 'Biblioteca' : 'Gimnasio'}`}</small></span>{actor.role !== 'student' && <button type="button" className="secondary-button" onClick={logout}>Cambiar usuario</button>}</div></header>
      <section className="hero"><div><p className="eyebrow">Billetera universitaria verificable</p><h1>Credenciales que compartís con control.</h1><p className="lead">Antecedentes académicos, servicios institucionales y asistencia en una misma billetera.</p></div><div className="trust-card"><span className="trust-icon">⌁</span><div><strong>Privacidad por diseño</strong><p>Compartí solo el dato que te solicitan.</p></div></div></section>
      <nav className="tabs" aria-label="Módulos">{allowedTabs.map((tab) => <button className={activeTab === tab.id ? 'tab active' : 'tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
      <p className="notice" role="status">{working && <span className="inline-spinner" aria-hidden="true" />}{working ? 'Procesando… ' : ''}{notice}</p>

      {activeTab === 'wallet' && <section className="layout wallet-layout">
        <div><div className="section-heading"><div><p className="eyebrow">Estudiante</p><h2>Mis credenciales</h2></div><span className="count">{credentials.length}</span></div>
          <div className="student-profile">
            <p className="eyebrow">Identidad del titular</p>
            <label>Nombre y apellido<input value={savedStudent?.fullName ?? actor.name} readOnly /></label>
            <label>Matrícula<input value={savedStudent?.enrollmentNumber ?? 'Cargando…'} readOnly /></label>
            <button type="button" className="secondary-button" onClick={() => void saveStudentProfile()} disabled={working || !savedStudent || savedStudent.walletLinked}>{!savedStudent ? <><span className="button-spinner" /> Cargando perfil…</> : savedStudent.walletLinked ? 'Billetera vinculada' : 'Vincular esta billetera'}</button>
            <p className="muted">El nombre y la matrícula se vinculan a esta cuenta. La firma protege estos datos y los asocia a la billetera.</p>
            <small className="muted">La identidad del titular se incluye en cada credencial emitida.</small>
          </div>
          <div className="wallet-actions"><button type="button" className="primary-button" onClick={() => setScannerOpen(true)}>Escanear QR con la cámara</button><span className="muted">Las credenciales se guardan en este teléfono.</span></div>
          {credentials.length ? <div className="credential-list">{credentials.map((credential) => <div className="wallet-credential-row" key={credential.id}><button type="button" className={selectedCredentialId === credential.id ? 'credential-card selected' : 'credential-card'} onClick={() => setSelectedCredentialId(credential.id)}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><span className="credential-copy"><small>{credential.type}</small><strong>{credential.claims.titulo}</strong><span>{credential.claims.detalle}</span></span><span className={credential.localStatus === 'Activa' ? 'status good' : 'status bad'}>{credential.localStatus}</span></button>{credential.localStatus !== 'Activa' && <button type="button" className="trash-icon-button" aria-label={`Borrar ${credential.claims.titulo} de la billetera`} title="Borrar de la billetera" onClick={() => void deleteWalletCredential(credential)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5.5 7l1 13h11l1-13M9 7V4h6v3" /></svg></button>}</div>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h3>Tu billetera está vacía</h3><p>Para agregar una credencial, escaneá con tu cámara el QR de entrega que te comparta el emisor.</p></div>}
        </div>
        <aside className="detail-panel">{selectedCredential ? <><p className="eyebrow">{selectedCredential.type}</p><h2>{selectedCredential.claims.titulo}</h2><p className="detail-copy">{selectedCredential.claims.detalle}</p><dl><div><dt>Emisor</dt><dd>Universidad Nacional de La Rioja</dd></div><div><dt>Emitida</dt><dd>{formatDate(selectedCredential.issuedAt)}</dd></div><div><dt>Vigencia</dt><dd>{selectedCredential.expiresAt ? formatDate(selectedCredential.expiresAt) : 'Sin vencimiento'}</dd></div><div><dt>Titular firmado</dt><dd>{selectedCredential.claims.nombreEstudiante ?? 'Credencial anterior al perfil actual'}</dd></div>{selectedCredential.claims.matricula && <div><dt>Matrícula</dt><dd>{selectedCredential.claims.matricula}</dd></div>}<div><dt>Firma</dt><dd>{selectedCredential.proof.algorithm} válida</dd></div></dl></> : <><p className="eyebrow">Tu espacio personal</p><h2>Guardá credenciales emitidas por la universidad</h2><p className="detail-copy">Cada QR de entrega es de un solo uso y vence a los diez minutos.</p></>}</aside>
      </section>}

      {activeTab === 'issuer' && <section className="layout issuer-layout"><div className="panel form-panel"><p className="eyebrow">Panel institucional · {actor.scope === 'academic' ? 'Área académica' : actor.scope === 'library' ? 'Biblioteca' : 'Gimnasio'}</p><h2>Emitir una credencial</h2><p className="muted">El servidor firma con Ed25519. Este usuario solo puede emitir dentro de su área; la credencial incluye la identidad del estudiante.</p><div className="form-grid"><label>Estudiante destinatario<select value={recipientStudentId} onChange={(event) => setRecipientStudentId(event.target.value)}>{demoStudents.map((student) => <option value={student.id} key={student.id}>{student.fullName} · {student.enrollmentNumber}</option>)}</select></label><label>Tipo de credencial<select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>{allowedKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>{credentialKind !== 'Alumno regular' && <label>{credentialKind === 'Biblioteca' || credentialKind === 'Gimnasio' ? 'Servicio' : 'Materia'}<input value={credentialKind === 'Biblioteca' || credentialKind === 'Gimnasio' ? (subject === 'Bases de Datos' ? '' : subject) : subject} onChange={(event) => setSubject(event.target.value)} placeholder={credentialKind === 'Biblioteca' ? 'Servicio de biblioteca' : credentialKind === 'Gimnasio' ? 'Servicio de gimnasio' : 'Ej.: Bases de Datos'} /></label>}{credentialKind === 'Nota de materia' && <label>Nota (escala de 1 a 10)<input type="number" inputMode="decimal" min="1" max="10" step="0.01" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="Ej.: 8.50" required /></label>}<label>Vigencia<select value={validityPreset} onChange={(event) => setValidityPreset(event.target.value)}><option value="never">Sin vencimiento</option><option value="7">1 semana</option><option value="30">1 mes (30 días)</option><option value="90">3 meses (90 días)</option><option value="365">1 año (365 días)</option><option value="custom">Personalizada</option></select></label>{validityPreset === 'custom' && <label>Vigencia en días<input type="number" inputMode="numeric" min="1" max="36500" step="1" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} placeholder="Ej.: 45" /></label>}</div><button type="button" className="primary-button" onClick={() => void issueCredential()} disabled={working || (credentialKind === 'Regularidad' && !subject.trim()) || (credentialKind === 'Nota de materia' && !grade) || (validityPreset === 'custom' && !validityDays)}>{working && <span className="button-spinner" />}{working ? 'Emitiendo…' : 'Emitir y generar QR'}</button></div>
        <aside className="panel request-panel">{qr?.value.includes(':delivery:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Entrega de credencial</h3><p>Vence: {formatDate(qr.expiresAt)}</p><button type="button" className="secondary-button" onClick={() => void refreshIssuer(true).catch((error) => setNotice(error instanceof Error ? error.message : 'No se pudieron actualizar las emisiones.'))} disabled={issuerRefreshStatus === 'loading'}>{issuerRefreshStatus === 'loading' ? <><span className="button-spinner" /> Actualizando…</> : issuerRefreshStatus === 'updated' ? 'Actualizado ✓' : 'Actualizar emisiones'}</button></> : <><span className="qr-placeholder">▦</span><h3>Entrega por QR</h3><p>El estudiante escanea el QR con su cámara y recibe la credencial firmada en su billetera local.</p></>}</aside>
        <div className="panel issuer-records"><div className="section-heading"><div><p className="eyebrow">Registro del emisor</p><h2>Credenciales emitidas</h2></div><button type="button" className="secondary-button" onClick={() => void refreshIssuer(true).catch((error) => setNotice(error instanceof Error ? error.message : 'No se pudieron actualizar las emisiones.'))} disabled={issuerRefreshStatus === 'loading'}>{issuerRefreshStatus === 'loading' ? <><span className="button-spinner" /> Actualizando…</> : issuerRefreshStatus === 'updated' ? 'Actualizado ✓' : 'Actualizar'}</button></div>{serverCredentials.length ? <div className="credential-list">{serverCredentials.map((credential) => <div className="credential-card record-card" key={credential.id}><span className="credential-icon">{iconFor(credential.kind)}</span><span className="credential-copy"><small>{credential.kind}</small><strong>{credential.title}</strong><span>{credential.detail}</span>{credential.studentName && <small>Titular: {credential.studentName} · Matrícula {credential.enrollmentNumber}</small>}</span><span className={credential.status === 'Activa' ? 'status good' : 'status bad'}>{credential.status}</span>{credential.status === 'Activa' && <button type="button" className="danger-link" onClick={() => void revokeCredential(credential)}>Revocar</button>}<button type="button" className="trash-icon-button" aria-label={`Eliminar ${credential.title} del registro`} title="Eliminar credencial" disabled={credentialDeletingId === credential.id} onClick={() => void deleteIssuedCredential(credential)}>{credentialDeletingId === credential.id ? <span className="button-spinner" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5.5 7l1 13h11l1-13M9 7V4h6v3" /></svg>}</button></div>)}</div> : <p className="muted">Todavía no se emitieron credenciales.</p>}</div>
      </section>}

      {activeTab === 'verify' && <section className="layout verify-layout">
        <div className="panel"><p className="eyebrow">Verificador</p><h2>Solicitar evidencia</h2><p className="muted">El QR vence en cinco minutos. El resultado se actualiza automáticamente cuando el titular responde.</p>
          <label>Tipo de credencial<select value={requestedKind} onChange={(event) => setRequestedKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          {['Regularidad', 'Materia aprobada', 'Nota de materia'].includes(requestedKind) && <label>Materia específica (opcional)<input value={requestedSubject} onChange={(event) => setRequestedSubject(event.target.value)} maxLength={120} placeholder="Ej.: Bases de Datos" /></label>}
          {requestedKind === 'Nota de materia' && <label>Nota mínima (opcional)<input type="number" inputMode="decimal" min="1" max="10" step="0.01" value={requestedMinimumGrade} onChange={(event) => setRequestedMinimumGrade(event.target.value)} placeholder="Ej.: 7" /></label>}
          <fieldset className="disclosure-options"><legend>Datos que querés solicitar</legend><label><input type="checkbox" checked={requestName} onChange={(event) => setRequestName(event.target.checked)} /> Nombre</label><label><input type="checkbox" checked={requestEnrollment} onChange={(event) => setRequestEnrollment(event.target.checked)} /> Matrícula</label>{requestedKind === 'Nota de materia' && <label><input type="checkbox" checked={requestExactGrade} onChange={(event) => setRequestExactGrade(event.target.checked)} /> Nota exacta (si no, solo se informa si cumple la mínima)</label>}</fieldset>
          <label>Detalle para el titular (opcional)<textarea rows={3} maxLength={300} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Indicá el motivo o contexto de la solicitud" /></label>
          <button type="button" className="primary-button" onClick={() => void createPresentationRequest()} disabled={working}>Generar QR de solicitud</button>

        </div>
        <aside className={`panel request-panel${verifyResult ? ' verify-result-panel' : ''}`}>{qr?.value.includes(':verify:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Solicitud temporal</h3><p>Vence: {formatDate(qr.expiresAt)}</p>{verifyResult ? <div className="verification-result"><span className="result-check">✓</span><div><strong>Credencial válida</strong><p>{verifyResult.studentName ? `${verifyResult.studentName} · ` : ''}{verifyResult.title} · {verifyResult.kind}</p>{(verifyResult.subject || verifyResult.grade || verifyResult.minimumGradeMet !== undefined) && <small>{verifyResult.subject ? `Materia: ${verifyResult.subject}` : ''}{verifyResult.grade ? ` · Nota: ${verifyResult.grade}` : verifyResult.minimumGradeMet !== undefined ? ` · Cumple nota mínima ${verifyResult.minimumGrade}: ${verifyResult.minimumGradeMet ? 'Sí' : 'No'}` : ''}</small>}<small>Firma, vigencia, titular y estado verificados</small></div></div> : <p className="muted"><LoadingMark label="Esperando la respuesta del titular…" /> Esta pantalla se actualizará sola.</p>}</> : <><span className="qr-placeholder">▦</span><h3>Presentación con consentimiento</h3><p>El estudiante ve qué se solicita y confirma antes de enviar su credencial.</p></>}</aside>
      </section>}

      {activeTab === 'connection' && <section className="attendance-page">
        <div className="panel roster-panel"><div className="section-heading"><div><p className="eyebrow">Complemento · acceso al aula</p><h2>Conexión de los presentes</h2></div></div><p className="muted">Estos QR son independientes de la asistencia. Primero pueden conectarse al Wi-Fi y luego abrir la app local en su teléfono.</p><div className="layout verify-layout"><div className="form-panel"><label>Nombre de la red Wi-Fi<input value={networkInfo.ssid || wifiSsidOverride} onChange={(event) => { setWifiSsidOverride(event.target.value); setShowWifiQr(false) }} readOnly={Boolean(networkInfo.ssid)} placeholder="Ingresá el nombre de la red Wi‑Fi" /></label>{!networkInfo.ssid && <p className="muted">macOS está ocultando el nombre de la red a las herramientas locales. Ingresalo manualmente como aparece en el menú Wi‑Fi; se usará para generar el QR.</p>}<label>Seguridad de la red<select value={wifiSecurity} onChange={(event) => { setWifiSecurity(event.target.value as 'WPA' | 'nopass'); setShowWifiQr(false) }}><option value="WPA">Protegida con contraseña</option><option value="nopass">Abierta, sin contraseña</option></select></label>{wifiSecurity === 'WPA' && <label>Contraseña Wi-Fi<input type="password" autoComplete="new-password" value={wifiPassword} onChange={(event) => { setWifiPassword(event.target.value); setShowWifiQr(false) }} placeholder="Ingresá la contraseña" /></label>}<p className="muted">La contraseña solo se usa para generar el QR en esta pantalla; no se guarda en el servidor.</p><button type="button" className="primary-button" onClick={() => setShowWifiQr(true)} disabled={!wifiSsid || (wifiSecurity === 'WPA' && !wifiPassword)}>Generar QR del Wi-Fi</button></div><div className="request-panel companion-qrs">{showWifiQr && wifiQr ? <QrDisplay value={wifiQr} label={`Wi-Fi · ${wifiSsid}${wifiSecurity === 'nopass' ? ' · abierta' : ''}`} /> : <div><span className="qr-placeholder">▦</span><small>Elegí el tipo de red y generá el QR Wi-Fi</small></div>}<QrDisplay value={localAppUrl} label="Abrir billetera en esta red" /><small>Enlace local: {localAppUrl}</small></div></div></div>
      </section>}

      {activeTab === 'class-photo' && actor.role === 'photographer' && <section className="layout verify-layout"><div className="panel"><p className="eyebrow">Foto de la clase · acceso del responsable</p><h2>Guardá el recuerdo en la Mac</h2><p className="muted">Usá la cámara trasera del celular para tomar una foto grupal, o elegí una imagen. Se reduce de tamaño y se guarda directamente en la computadora que ejecuta la demo.</p><label>Foto grupal<input type="file" accept="image/*" capture="environment" onChange={(event) => { void saveClassPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} disabled={classPhotoWorking} /></label><p className="muted">{classPhotoWorking ? 'Subiendo la foto a la Mac…' : classPhotoStatus ? `Foto guardada${classPhotoSavedAt ? ` · ${formatDate(classPhotoSavedAt)}` : ''}. Se incluirá en los próximos souvenirs.` : 'Todavía no hay una foto guardada.'}</p></div><aside className="panel request-panel">{classPhotoPreview ? <img className="class-photo-preview" src={classPhotoPreview} alt="Vista previa de la foto de la clase guardada en la Mac" /> : <div className="class-photo-placeholder">📷</div>}<h3>{classPhotoStatus ? 'Recuerdo listo' : 'Foto de toda la clase'}</h3><p>{classPhotoStatus ? 'El docente ya puede generar el QR del souvenir con esta imagen.' : 'Después de guardarla, la imagen se integrará a cada souvenir personalizado.'}</p></aside></section>}

      {activeTab === 'souvenir' && <section className="layout verify-layout"><div className="panel"><p className="eyebrow">Profesor · recuerdo digital</p><h2>Souvenir para todos</h2><p className="muted">Generá un único QR para compartir con el grupo. Cada persona lo escanea desde su billetera y recibe una imagen conmemorativa con su propio nombre.</p><p className="muted">{classPhotoStatus ? `Foto grupal lista${classPhotoSavedAt ? ` · ${formatDate(classPhotoSavedAt)}` : ''}.` : 'Primero registrate en el celular fotografo y guardá la foto de la clase.'}</p><label>Título del recuerdo<input value={souvenirTitle} onChange={(event) => { setSouvenirTitle(event.target.value); setSouvenirSession(null) }} maxLength={120} placeholder="Ej.: Seminario de Actualización II" /></label><label>Mensaje para todos<textarea rows={3} value={souvenirMessage} onChange={(event) => { setSouvenirMessage(event.target.value); setSouvenirSession(null) }} maxLength={160} placeholder="Gracias por participar de nuestro proyecto." /></label><button type="button" className="primary-button" onClick={() => void createSouvenirSession()} disabled={working || !classPhotoStatus || !souvenirTitle.trim() || !souvenirMessage.trim()}>{working && <span className="button-spinner" />}{working ? 'Generando QR…' : souvenirSession ? 'Generar un nuevo QR' : 'Generar QR para todos'}</button><p className="muted">Cada billetera registrada puede reclamarlo una vez. El QR es válido hasta {souvenirSession ? formatDate(souvenirSession.expiresAt) : '24 horas después de generarlo'}.</p></div><aside className="panel request-panel">{souvenirSession ? <><button type="button" className="primary-button" onClick={() => setSouvenirQrOpen(true)}>Mostrar QR de nuevo</button><h3>Un QR, un recuerdo para cada uno</h3><p>Al escanearlo, el nombre de cada participante se incorpora a su propia imagen.</p></> : <><span className="qr-placeholder">✦</span><h3>El QR para todos aparecerá acá</h3><p>Se personaliza al escanear desde cada billetera registrada.</p></>}</aside></section>}

      {activeTab === 'attendance' && <section className="attendance-page">
        <div className="layout verify-layout"><div className="panel"><p className="eyebrow">Profesor · {actor.name}</p><h2>Asistencia de clase</h2><p className="muted">El QR vence en un minuto. Para leerlo y confirmar, cada estudiante debe estar conectado a la misma red Wi-Fi que el profesor. Cada billetera puede registrar una sola presencia por sesión.</p><label>Materia<input value={attendanceSubject} onChange={(event) => setAttendanceSubject(event.target.value)} /></label>{attendance?.status === 'Abierta' ? <button type="button" className="secondary-button" onClick={() => void closeAttendance()}>Cerrar sesión de asistencia</button> : <button type="button" className="primary-button" onClick={() => void openAttendance()} disabled={working}>Abrir asistencia y mostrar QR</button>}<button type="button" className="reset-demo-button" onClick={() => void resetDemo()} disabled={resetWorking}>{resetWorking ? 'Reiniciando…' : 'Reiniciar demo para una nueva prueba'}</button><div className="attendance-list"><h3>Presentes en esta sesión ({attendanceRecords.length})</h3>{attendanceRecords.map((record) => <p key={`${record.holder}-${record.recordedAt}`}>✓ {record.studentName} · {formatDate(record.recordedAt)}</p>)}{attendance?.status === 'Abierta' && attendanceRecords.length === 0 && <p className="muted"><LoadingMark label="Esperando registros…" /></p>}</div></div><aside className="panel request-panel">{attendance?.status === 'Abierta' && qr?.value.includes(':attendance:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>{attendance.subject}</h3><p>{attendance.section} · vence: {formatDate(attendance.expiresAt)}</p></> : <><span className="qr-placeholder">▦</span><h3>Asistencia temporal</h3><p>Abrí una sesión para generar el QR que escanearán los estudiantes.</p></>}</aside></div>
        <div className="panel roster-panel"><div className="section-heading"><div><p className="eyebrow">Planilla local · {attendanceRoster?.teacherName ?? 'Marcelo Roldan'}</p><h2>{attendanceRoster?.courseName ?? 'Seminario de Actualización II'}</h2></div><div className="roster-actions"><span className="live-badge"><i />Actualización en vivo · 3 s</span><button type="button" className="secondary-button download-button" onClick={() => void downloadAttendance()} disabled={attendanceDownloadWorking}>{attendanceDownloadWorking ? 'Preparando…' : 'Descargar para Excel o Numbers'}</button></div></div><p className="muted">La asistencia se actualiza al registrar una presencia.</p>{attendanceDownloadError && <p className="consent-error" role="alert">No se pudo descargar: {attendanceDownloadError}</p>}<div className="roster-scroll"><table className="roster-table"><thead><tr><th>Estudiante</th>{attendanceRoster?.dates.map((date) => <th key={date.key}>{date.label}</th>)}{!attendanceRoster?.dates.length && <th>Sin clases registradas</th>}</tr></thead><tbody>{(attendanceRoster?.students ?? demoStudents.map((student): AttendanceRoster['students'][number] => ({ ...student, attendance: {} }))).map((student) => <tr key={student.id}><th scope="row">{student.fullName}</th>{attendanceRoster?.dates.map((date) => { const state = student.attendance[date.key] ?? 'A'; return <td key={date.key} className={state === 'P' ? 'present-cell' : 'absent-cell'}>{state}</td> })}{!attendanceRoster?.dates.length && <td className="absent-cell">A</td>}</tr>)}</tbody></table></div><div className="roster-legend"><span className="legend-chip legend-present">P · Presente</span><span className="legend-chip legend-absent">A · Ausente</span></div></div>
      </section>}

      {pendingVerify && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Solicitud del verificador</p><h2>Elegí qué datos compartir</h2><p>Se solicita: <strong>{pendingVerify.kind}</strong>{pendingVerify.subject && <> de <strong>{pendingVerify.subject}</strong></>}{pendingVerify.minimumGrade != null && <> · nota mínima <strong>{pendingVerify.minimumGrade}</strong></>}</p>{pendingVerify.requestNote && <p>Detalle: {pendingVerify.requestNote}</p>}{matchingVerificationCredentials.map((credential) => { const choices: [string, string][] = [['nombreEstudiante', 'Nombre'], ['matricula', 'Matrícula'], ['titulo', 'Título'], ['detalle', 'Detalle'], ['materia', 'Materia'], ['nota', 'Nota exacta']]; if (pendingVerify.minimumGrade != null) choices.push([`cumpleNotaMinima${pendingVerify.minimumGrade}`, `¿Cumple la nota mínima ${pendingVerify.minimumGrade}?`]); return <div className="consent-credential" key={credential.id}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><div><strong>{credential.claims.titulo}</strong><p>{choices.filter(([key]) => key in credential.claims || key.startsWith('cumpleNotaMinima')).map(([key, label]) => <label className="disclosure-choice" key={key}><input type="checkbox" checked={Boolean(shareFields[key])} disabled={Boolean(pendingVerify.subject && key === 'materia') || (pendingVerify.minimumGrade != null && key.startsWith('cumpleNotaMinima'))} onChange={(event) => setShareFields((current) => ({ ...current, [key]: event.target.checked }))} />{label}{(pendingVerify.requiredClaims ?? []).includes(key) && <small> · solicitado, podés desactivarlo</small>}{key.startsWith('cumpleNotaMinima') && <small> · {Number(credential.claims.nota) >= pendingVerify.minimumGrade! ? 'Sí' : 'No'}</small>}</label>)}</p></div></div>})}{!matchingVerificationCredentials.length && <p className="scanner-error">No tenés una credencial activa que cumpla estos requisitos.</p>}{verifyShareError && <p className="consent-error" role="alert">No se pudo compartir: {verifyShareError}</p>}<div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingVerify(null); setNotice('Rechazaste compartir la credencial.') }}>Rechazar</button>{matchingVerificationCredentials.map((credential) => <button type="button" className="primary-button" key={credential.id} disabled={working} onClick={() => void shareCredential(credential)}>{working ? <><span className="button-spinner" /> Enviando…</> : 'Confirmar y compartir'}</button>)}</div></section></div>}
      {pendingAttendance && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Confirmar asistencia</p><h2>{pendingAttendance.subject}</h2><p>{pendingAttendance.section} · sesión temporal del profesor</p><p>Se registrará la presencia de <strong>{savedStudent?.fullName ?? 'un estudiante sin identificar'}</strong> usando una prueba criptográfica de esta billetera. No se comparten notas ni otras credenciales.</p>{attendanceError && <p className="consent-error" role="alert">No se pudo registrar: {attendanceError}</p>}<div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingAttendance(null); setAttendanceError(''); setNotice('Cancelaste el registro de asistencia.') }}>Cancelar</button><button type="button" className="primary-button" disabled={working} onClick={() => void confirmAttendance()}>{working ? 'Registrando…' : 'Confirmar presencia'}</button></div></section></div>}
      {activeTab === 'souvenir' && souvenirQrOpen && souvenirSession && <div className="souvenir-qr-backdrop"><section className="souvenir-qr-screen" role="dialog" aria-modal="true" aria-label="QR de souvenir para todos"><button type="button" className="souvenir-qr-close" onClick={() => setSouvenirQrOpen(false)}>Cerrar</button><div className="souvenir-qr-glow souvenir-qr-glow-one" /><div className="souvenir-qr-glow souvenir-qr-glow-two" /><div className="souvenir-qr-content"><div className="souvenir-qr-mark">✦</div><p className="eyebrow">UNLaR · Seminario de Actualización II</p><h2>Un recuerdo para llevarte</h2><p>Un mismo QR, un souvenir único para cada participante.</p><SouvenirQrDisplay value={qrPayload('souvenir', souvenirSession.code)} /><small>Vigente hasta {formatDate(souvenirSession.expiresAt)}</small></div></section></div>}
      {souvenirPreview && <div className="souvenir-backdrop"><section className="souvenir-card" role="dialog" aria-modal="true" aria-label="Tu souvenir personalizado"><button type="button" className="souvenir-close" onClick={() => setSouvenirPreview(null)} aria-label="Cerrar">×</button><div className="souvenir-fireworks fireworks-one" /><div className="souvenir-fireworks fireworks-two" /><div className="souvenir-heading"><span>✦</span><h2>¡Un recuerdo para vos!</h2><p>Personalizado para {souvenirPreview.name}</p></div><img className="souvenir-image" src={souvenirPreview.image} alt={`Souvenir conmemorativo para ${souvenirPreview.name}`} /><div className="souvenir-actions"><button type="button" className="primary-button" onClick={downloadSouvenir}>Descargar imagen</button><button type="button" className="secondary-button" onClick={() => void shareSouvenir()}>Compartir</button></div><small>Guardalo o compartilo en WhatsApp, Instagram y tus apps favoritas.</small></section></div>}
      {scannerOpen && <QrScanner onScan={handleScan} onClose={() => setScannerOpen(false)} />}
      <footer>Universidad Nacional de La Rioja · Credenciales digitales</footer>
    </main>
  )
}

export default App
