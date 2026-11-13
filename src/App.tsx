import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'
import { api, downloadFile } from './lib/api'
import { signWalletProof, verifyCredential, type SignedCredential } from './lib/credentialCrypto'
import { clearWalletCredentials, listWalletCredentials, removeWalletCredential, storeWalletCredential, updateWalletCredentialStatus, type WalletCredential } from './lib/walletStore'

type CredentialKind = 'Alumno regular' | 'Regularidad' | 'Materia aprobada' | 'Nota de materia' | 'Biblioteca' | 'Gimnasio' | 'Souvenir'
type TabId = 'wallet' | 'issuer' | 'raffle' | 'verify' | 'attendance' | 'connection' | 'souvenir' | 'class-photo' | 'email-requests'
type IssuedCredential = { id: string; kind: CredentialKind; title: string; detail: string; status: string; issuedAt: string; expiresAt: string | null; studentName?: string; enrollmentNumber?: string }
type DeliveryResponse = { credential: SignedCredential; delivery: { code: string; expiresAt: string } }
type VerifyRequest = { code: string; kind: CredentialKind; subject?: string; minimumGrade?: number | null; requestNote?: string | null; requiredClaims?: string[]; includeExactGrade?: boolean; expiresAt: string }
type AttendanceSession = { id: string; subject: string; section: string; expiresAt: string; status: string }
type SouvenirSession = { code: string; title: string; detail: string; expiresAt: string }
type DemoStudent = { id: string; fullName: string; enrollmentNumber: string; identityLocked: boolean; walletLinked: boolean }
type DemoActor = { id: string; role: 'student' | 'teacher' | 'institutional' | 'photographer' | 'demo-tools'; name: string; scope?: 'academic' | 'library' | 'gym'; studentId?: string; canManageClassPhoto?: boolean }
type AttendanceRoster = {
  teacherName: string
  courseName: string
  dates: { key: string; label: string }[]
  students: { id: string; fullName: string; attendance: Record<string, 'P' | 'A'> }[]
}
type NetworkInfo = { ssid: string; addresses: string[] }
type PrizeRequest = { id: string; raffleId?: string | null; studentId?: string; studentName: string; place: number; source?: 'raffle' | 'manual'; email?: string | null; createdAt: string; answeredAt?: string | null; retiredAt?: string | null }

const excludedRaffleStudentIds = new Set(['mariano-arias-simone', 'peralta-herrar-nahuel'])

const kinds: CredentialKind[] = ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia', 'Biblioteca', 'Gimnasio']
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'wallet', label: 'Mi billetera', icon: '🪪' },
  { id: 'issuer', label: 'Emisión', icon: '🏛️' },
  { id: 'verify', label: 'Verificar', icon: '🔍' },
  { id: 'attendance', label: 'Asistencia', icon: '📋' },
  { id: 'connection', label: 'Conexión', icon: '📶' },
  { id: 'souvenir', label: 'Souvenir', icon: '✦' },
  { id: 'raffle', label: 'Sorteo', icon: '🎡' },
  { id: 'email-requests', label: 'Solicitar emails', icon: '✉️' },
  { id: 'class-photo', label: 'Foto grupal', icon: '📷' },
]
const demoAccounts = [
  { id: 'student-mariano', label: 'Estudiante · Mariano Arias Simone', role: 'student' },
  { id: 'student-nahuel', label: 'Estudiante · Nahuel Peralta Herrera', role: 'student' },
  { id: 'teacher-marcelo', label: 'Docente · Marcelo Roldán', role: 'teacher' },
  { id: 'admin-academic', label: 'Gestión Institucional · Área Académica', role: 'institutional' },
  { id: 'admin-library', label: 'Servicios Universitarios · Biblioteca', role: 'institutional' },
  { id: 'admin-gym', label: 'Servicios Universitarios · Gimnasio', role: 'institutional' },
  { id: 'demo-tools', label: 'Herramientas Demo', role: 'demo-tools' },
]
const iconFor = (kind: CredentialKind) => ({
  'Alumno regular': '🎓',
  'Regularidad': '◈',
  'Materia aprobada': '✓',
  'Nota de materia': '★',
  'Biblioteca': '📖',
  'Gimnasio': '⚡',
  'Souvenir': '✦',
}[kind] ?? '◇')

const credentialKindSlug = (kind: string) => {
  switch (kind) {
    case 'Alumno regular': return 'student-id'
    case 'Regularidad': return 'regularidad'
    case 'Materia aprobada': return 'aprobada'
    case 'Nota de materia': return 'nota'
    case 'Biblioteca': return 'biblioteca'
    case 'Gimnasio': return 'gimnasio'
    case 'Souvenir': return 'souvenir'
    default: return 'default'
  }
}

const credentialCategory = (kind: string): { label: string; group: 'all' | 'identity' | 'academic' | 'service' | 'commemorative' } => {
  switch (kind) {
    case 'Alumno regular':
      return { label: 'Identidad universitaria', group: 'identity' }
    case 'Regularidad':
    case 'Materia aprobada':
    case 'Nota de materia':
      return { label: 'Acreditación académica', group: 'academic' }
    case 'Biblioteca':
    case 'Gimnasio':
      return { label: 'Servicios de campus', group: 'service' }
    case 'Souvenir':
      return { label: 'Recuerdo conmemorativo', group: 'commemorative' }
    default:
      return { label: 'Credencial oficial', group: 'academic' }
  }
}

const cardThemeClass = (kind: string) => {
  switch (kind) {
    case 'Alumno regular':
      return 'card-theme-student-id'
    case 'Regularidad':
      return 'card-theme-regularidad'
    case 'Materia aprobada':
      return 'card-theme-aprobada'
    case 'Nota de materia':
      return 'card-theme-nota'
    case 'Biblioteca':
      return 'card-theme-biblioteca'
    case 'Gimnasio':
      return 'card-theme-gimnasio'
    case 'Souvenir':
      return 'card-theme-souvenir'
    default:
      return 'card-theme-default'
  }
}
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
  context.fillText('Billetera Digital Universitaria UNLaR', 232, 145)

  const displayName = name.trim().replace(/\s+/g, ' ')
  if (displayName) {
    context.textAlign = 'left'; context.fillStyle = '#ffe08a'; context.font = '700 20px system-ui, sans-serif'; context.letterSpacing = '3px'
    context.fillText('ESTE RECUERDO ES PARA', 145, 640)
    context.font = 'italic 104px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'; context.letterSpacing = '0px'
    while (context.measureText(displayName).width > 1080 && parseInt(context.font.match(/\d+/)?.[0] ?? '104', 10) > 68) {
      const size = parseInt(context.font.match(/\d+/)?.[0] ?? '104', 10) - 6
      context.font = `italic ${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`
    }
    context.save(); context.shadowColor = '#ffe08a'; context.shadowBlur = 20; context.lineWidth = 2; context.strokeStyle = 'rgba(42, 27, 8, .7)'; context.fillStyle = '#fff4ce'
    context.strokeText(displayName, 145, 760); context.fillText(displayName, 145, 760); context.restore()
  }

  context.textAlign = 'left'; context.fillStyle = '#fff'; context.font = '500 25px system-ui, sans-serif'; context.letterSpacing = '0px'
  const messageWords = message.trim().split(/\s+/); let messageLine = ''; let messageY = displayName ? 825 : 760
  messageWords.forEach((word) => {
    const next = messageLine ? `${messageLine} ${word}` : word
    if (context.measureText(next).width > 1050 && messageLine) { context.fillText(messageLine, 150, messageY); messageY += 38; messageLine = word } else messageLine = next
  })
  if (messageLine) context.fillText(messageLine, 150, messageY)

  context.save(); context.shadowColor = '#ffdc83'; context.shadowBlur = 25
  context.fillStyle = '#fff8df'; context.beginPath(); context.roundRect(1300, 680, 170, 170, 16); context.fill()
  context.drawImage(qrImage, 1310, 690, 150, 150); context.restore()
  context.textAlign = 'center'; context.fillStyle = '#fff0bf'; context.font = '700 15px system-ui, sans-serif'; context.letterSpacing = '1px'
  context.fillText(displayName ? 'MI BILLETERA · SOUVENIR' : 'RECUERDO DEL GRUPO', 1385, 875)
  context.fillStyle = '#fff'; context.font = '600 13px system-ui, sans-serif'; context.letterSpacing = '0px'
  context.fillText(title.toLocaleUpperCase('es-AR').slice(0, 24), 1385, 904)
  return canvas.toDataURL('image/png')
}

function QrDisplay({ value, label }: { value: string; label: string }) {
  const [image, setImage] = useState('')
  useEffect(() => {
    void QRCode.toDataURL(value, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1f3b', light: '#ffffff' },
    }).then(setImage)
  }, [value])
  return (
    <div className="qr-display">
      <div className="qr-frame">
        <div className="qr-corner tl" />
        <div className="qr-corner tr" />
        <div className="qr-corner bl" />
        <div className="qr-corner br" />
        {image ? <img src={image} alt={label} /> : <span className="qr-placeholder">▦</span>}
      </div>
      <small>{label}</small>
    </div>
  )
}

function SouvenirQrDisplay({ value }: { value: string }) {
  const [image, setImage] = useState('')
  useEffect(() => {
    void QRCode.toDataURL(value, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#422800', light: '#fff9e8' },
    }).then(setImage)
  }, [value])
  return (
    <div className="souvenir-main-qr">
      <div className="souvenir-qr-card-frame">
        <div className="souvenir-corner-star tl">✦</div>
        <div className="souvenir-corner-star tr">✦</div>
        <div className="souvenir-corner-star bl">✦</div>
        <div className="souvenir-corner-star br">✦</div>
        {image ? <img src={image} alt="Código QR conmemorativo para el grupo" /> : <span className="souvenir-placeholder-star">✦</span>}
      </div>
      <strong>Escaneá este código QR con tu billetera para recibir tu recuerdo</strong>
    </div>
  )
}

function LoadingMark({ label = 'Cargando…' }: { label?: string }) {
  return <span className="loading-mark" role="status" aria-label={label}><i />{label}</span>
}

function QrScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const browserError = !window.isSecureContext
    ? 'El acceso a la cámara requiere una conexión segura (HTTPS). Abrí el enlace seguro provisto para escanear.'
    : !navigator.mediaDevices?.getUserMedia
      ? 'Este navegador no tiene acceso a la cámara. Te sugerimos abrir la billetera en Google Chrome o Safari.'
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
      }).then((value) => { if (value) controls = value }).catch(() => setError('No se pudo acceder a la cámara. Verificá los permisos del navegador e intentá nuevamente.'))
    }
    return () => { cancelled = true; controls?.stop() }
  }, [browserError, onScan])
  return (
    <div className="scanner-backdrop">
      <section className="scanner-modal" role="dialog" aria-modal="true" aria-label="Escanear código QR">
        <div className="scanner-heading">
          <div>
            <p className="eyebrow">Lector de códigos</p>
            <h2>Escanear código QR</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar escáner">×</button>
        </div>
        <div className="scanner-video-wrapper">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scanner-viewfinder">
            <div className="viewfinder-corner top-left" />
            <div className="viewfinder-corner top-right" />
            <div className="viewfinder-corner bottom-left" />
            <div className="viewfinder-corner bottom-right" />
            <div className="scanner-laser" />
          </div>
        </div>
        {(error || browserError) && <p className="scanner-error">{error || browserError}</p>}
        <p className="muted" style={{ marginTop: 12 }}>Apuntá la cámara al código QR que se muestra en la otra pantalla.</p>
      </section>
    </div>
  )
}

function BrandLogo() {
  return (
    <>
      <img className="wallet-brand-mark" src="/wallet-mark.png" alt="Billetera Universitaria" width="40" height="40" />
      <span className="brand-divider" aria-hidden="true" />
      <img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja — UNLaR" />
    </>
  )
}

function App() {
  const pageParams = new URLSearchParams(window.location.search)
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const institutionalMode = pageParams.get('acceso') === 'institucional'
  const registrationMode = !institutionalMode && (!isLocalhost || (pageParams.get('inicio') !== '1' && pageParams.get('registro') === '1'))
  const [actor, setActor] = useState<DemoActor | null>(null)
  const [loginAccount, setLoginAccount] = useState('teacher-marcelo')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestError, setGuestError] = useState('')
  const [guestRestoreError, setGuestRestoreError] = useState('')
  const [guestAlreadyRegistered, setGuestAlreadyRegistered] = useState(() => localStorage.getItem('unlar-guest-registration') === 'complete')
  const [loginWorking, setLoginWorking] = useState(false)
  const [sessionChecking, setSessionChecking] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('wallet')
  const [credentials, setCredentials] = useState<WalletCredential[]>([])
  const [walletCategoryFilter, setWalletCategoryFilter] = useState<'all' | 'identity' | 'academic' | 'service' | 'commemorative'>('all')

  const filteredCredentials = useMemo(() => {
    if (walletCategoryFilter === 'all') return credentials
    return credentials.filter((cred) => credentialCategory(cred.type).group === walletCategoryFilter)
  }, [credentials, walletCategoryFilter])

  const categoryCounts = useMemo(() => ({
    all: credentials.length,
    identity: credentials.filter((c) => credentialCategory(c.type).group === 'identity').length,
    academic: credentials.filter((c) => credentialCategory(c.type).group === 'academic').length,
    service: credentials.filter((c) => credentialCategory(c.type).group === 'service').length,
    commemorative: credentials.filter((c) => credentialCategory(c.type).group === 'commemorative').length,
  }), [credentials])
  const [serverCredentials, setServerCredentials] = useState<IssuedCredential[]>([])
  const [issuerRefreshStatus, setIssuerRefreshStatus] = useState<'idle' | 'loading' | 'updated'>('idle')
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [notice, setNotice] = useState('Tu billetera está lista. Escaneá un código QR para recibir credenciales o registrar tu presencia.')
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
  const [souvenirTitle, setSouvenirTitle] = useState('Seminario de Actualización II · Ciclo 2026')
  const [souvenirMessage, setSouvenirMessage] = useState('Gracias por ser parte de la demo de nuestro proyecto!')
  const [souvenirSession, setSouvenirSession] = useState<SouvenirSession | null>(null)
  const [souvenirQrOpen, setSouvenirQrOpen] = useState(false)
  const [souvenirPreview, setSouvenirPreview] = useState<{ image: string; name: string } | null>(null)
  const [classPhotoPreview, setClassPhotoPreview] = useState('')
  const [classPhotoSavedAt, setClassPhotoSavedAt] = useState('')
  const [classPhotoWorking, setClassPhotoWorking] = useState(false)
  const [classPhotoStatus, setClassPhotoStatus] = useState(false)
  const [demoStudents, setDemoStudents] = useState<DemoStudent[]>([])
  const [raffleWinners, setRaffleWinners] = useState<DemoStudent[]>([])
  const [raffleSpinning, setRaffleSpinning] = useState(false)
  const [raffleWinnerId, setRaffleWinnerId] = useState('')
  const [raffleRotation, setRaffleRotation] = useState(0)
  const [rafflePointerName, setRafflePointerName] = useState('')
  const [raffleCelebration, setRaffleCelebration] = useState(false)
  const [raffleWinnerTarget, setRaffleWinnerTarget] = useState(2)
  const [raffleId, setRaffleId] = useState(() => crypto.randomUUID())
  const [raffleReplaceIndex, setRaffleReplaceIndex] = useState<number | null>(null)
  const [raffleRedrawStudentId, setRaffleRedrawStudentId] = useState('')
  const [rafflePrizeRequests, setRafflePrizeRequests] = useState<PrizeRequest[]>([])
  const [refreshingPrizeRequests, setRefreshingPrizeRequests] = useState(false)
  const [emailStudentIds, setEmailStudentIds] = useState<string[]>([])
  const [emailStudentSearch, setEmailStudentSearch] = useState('')
  const [sendingEmailRequests, setSendingEmailRequests] = useState(false)
  const [emailRequestResult, setEmailRequestResult] = useState('')
  const [revealedPrizeEmails, setRevealedPrizeEmails] = useState<Record<string, boolean>>({})
  const [pendingPrizeRequests, setPendingPrizeRequests] = useState<PrizeRequest[]>([])
  const [prizeEmailDrafts, setPrizeEmailDrafts] = useState<Record<string, string>>({})
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
  const allowedTabs = tabs.filter((tab) => actor?.canManageClassPhoto ? ['wallet', 'class-photo'].includes(tab.id) : actor?.role === 'student' || actor?.role === 'photographer' ? tab.id === 'wallet' : actor?.role === 'teacher' ? ['verify', 'attendance'].includes(tab.id) : actor?.role === 'demo-tools' ? ['raffle', 'connection', 'souvenir', 'email-requests'].includes(tab.id) : actor?.role === 'institutional' ? tab.id === 'issuer' : false)
  const allowedKinds: CredentialKind[] = actor?.scope === 'library' ? ['Biblioteca'] : actor?.scope === 'gym' ? ['Gimnasio'] : ['Alumno regular', 'Regularidad', 'Materia aprobada', 'Nota de materia']

  const spinRaffle = (replaceIndex: number | null = null) => {
    const raffleParticipants = demoStudents.filter((student) => !excludedRaffleStudentIds.has(student.id))
    const eligible = raffleParticipants.filter((student) => !raffleWinners.some((winner) => winner.id === student.id))
    if (!eligible.length || raffleSpinning) {
      if (replaceIndex !== null && !raffleSpinning) {
        setRaffleReplaceIndex(null)
        setRaffleRedrawStudentId('')
        setNotice('No hay otro participante disponible para reemplazar este puesto. Agregá más participantes y volvé a sortear.')
      }
      return
    }
    const winner = eligible[Math.floor(Math.random() * eligible.length)]
    const winnerIndex = eligible.findIndex((student) => student.id === winner.id)
    const segmentAngle = 360 / eligible.length
    // Our gradient explicitly starts at -90deg (12 o'clock). Labels use the
    // same segment centers; rotate the chosen center back to the top pointer.
    const targetAngle = -(winnerIndex + 0.5) * segmentAngle
    const currentAngle = ((raffleRotation % 360) + 360) % 360
    const delta = ((targetAngle - currentAngle) % 360 + 360) % 360
    setRaffleSpinning(true)
    const duration = 11200
    const startRotation = raffleRotation
    const endRotation = raffleRotation + 360 * 8 + delta
    setRafflePointerName(eligible[Math.floor(((((360 - (startRotation % 360)) % 360) / segmentAngle)) % eligible.length)]?.fullName ?? '')
    const startedAt = performance.now()
    const trackPointer = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1)
      const easedProgress = 1 - Math.pow(1 - progress, 4.2)
      const angle = startRotation + (endRotation - startRotation) * easedProgress
      setRaffleRotation(angle)
      const normalizedPointerAngle = (((-angle % 360) + 360) % 360)
      const pointedIndex = Math.floor(normalizedPointerAngle / segmentAngle) % eligible.length
      setRafflePointerName(eligible[pointedIndex]?.fullName ?? '')
      if (progress < 1) window.requestAnimationFrame(trackPointer)
    }
    window.requestAnimationFrame(trackPointer)
    setRaffleWinnerId(winner.id)
    window.setTimeout(() => {
      setRaffleWinners((current) => replaceIndex === null ? [...current, winner] : current.map((entry, index) => index === replaceIndex ? winner : entry))
      setRaffleSpinning(false)
      setRaffleReplaceIndex(null)
      setRafflePointerName(winner.fullName)
      setRaffleCelebration(true)
      window.setTimeout(() => setRaffleCelebration(false), 4200)
      if ((replaceIndex === null && raffleWinners.length + 1 === raffleWinnerTarget) || (replaceIndex !== null && raffleWinners.length === raffleWinnerTarget)) {
        const winnerIds = replaceIndex === null ? [...raffleWinners, winner] : raffleWinners.map((entry, index) => index === replaceIndex ? winner : entry)
        const winnerParticipants = demoStudents
        void api<{ created: number; skipped: number }>('/api/raffle/prize-requests', {
          method: 'POST',
          body: JSON.stringify({ raffleId, winners: winnerIds.map((entry, index) => ({ studentId: winnerParticipants.find((student) => student.id === entry.id)?.id, place: index + 1 })) }),
        }).then(async (result) => {
          setNotice(`Se avisó a ${result.created} billetera(s) vinculada(s). ${result.skipped ? `${result.skipped} ganador(es) de prueba o sin billetera no recibieron aviso.` : ''}`)
          setRafflePrizeRequests(await api<PrizeRequest[]>('/api/raffle/prize-requests'))
        }).catch((error) => setNotice(error instanceof Error ? error.message : 'No se pudieron enviar las solicitudes de email.')).finally(() => setRaffleRedrawStudentId(''))
      } else setRaffleRedrawStudentId('')
    }, duration)
  }

  const sendManualEmailRequests = async () => {
    if (sendingEmailRequests || !emailStudentIds.length) return
    setSendingEmailRequests(true)
    setEmailRequestResult('')
    try {
      const result = await api<{ created: number; alreadyPending: number }>('/api/demo/email-requests', {
        method: 'POST', body: JSON.stringify({ studentIds: emailStudentIds }),
      })
      setEmailRequestResult(`${result.created} solicitud${result.created === 1 ? '' : 'es'} enviada${result.created === 1 ? '' : 's'}.${result.alreadyPending ? ` ${result.alreadyPending} ya tenían un aviso pendiente.` : ''}`)
      setEmailStudentIds([])
      setRafflePrizeRequests(await api<PrizeRequest[]>('/api/raffle/prize-requests'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudieron enviar las solicitudes de email.')
    } finally { setSendingEmailRequests(false) }
  }

  const submitPrizeEmail = async (requestId: string) => {
    try {
      await api(`/api/raffle/prize-requests/${requestId}/email`, { method: 'POST', body: JSON.stringify({ email: prizeEmailDrafts[requestId] ?? '' }) })
      setPendingPrizeRequests((current) => current.filter((request) => request.id !== requestId))
      setNotice('Guardamos tu email. ¡Gracias!')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar el email.') }
  }

  const refreshPrizeRequestList = async () => {
    setRefreshingPrizeRequests(true)
    try {
      setRafflePrizeRequests(await api<PrizeRequest[]>('/api/raffle/prize-requests'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo actualizar la lista de emails.')
    } finally { setRefreshingPrizeRequests(false) }
  }

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
      setActiveTab(result.actor.role === 'student' || result.actor.role === 'photographer' ? 'wallet' : result.actor.role === 'teacher' ? 'attendance' : result.actor.role === 'demo-tools' ? 'connection' : 'issuer')
      if (result.actor.scope === 'library') setCredentialKind('Biblioteca')
      else if (result.actor.scope === 'gym') setCredentialKind('Gimnasio')
      else setCredentialKind('Materia aprobada')
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Verificá tus credenciales e intentá nuevamente.') }
    finally { setLoginWorking(false) }
  }

  const registerGuest = async () => {
    const fullName = guestName.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2 || fullName.length > 100) { setGuestError('Por favor, ingresá tu nombre y apellido completo.'); return }
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
      setActiveTab('wallet')
      setNotice(result.actor.canManageClassPhoto ? 'Tu perfil de Mariano está listo. Podés tomar la foto desde «Foto grupal».' : `¡Billetera creada con éxito, ${result.actor.name}! Ya podés registrar asistencia y recibir credenciales.`)
      window.history.replaceState({}, '', window.location.pathname)
    } catch (error) { setGuestError(error instanceof Error ? error.message : 'No se pudo completar el registro de la billetera.') }
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
    setActiveTab('wallet')
    setNotice(`Bienvenido/a nuevamente, ${result.actor.name}. Tu billetera se recuperó exitosamente.`)
  }

  const logout = () => {
    void api('/api/demo/logout', { method: 'POST' }).catch(() => undefined)
    localStorage.removeItem('unlar-demo-token')
    localStorage.removeItem('unlar-demo-account')
    setActor(null)
    setCredentials([])
    setServerCredentials([])
    setQr(null)
    setPendingAttendance(null)
    setPendingVerify(null)
    setEmailStudentIds([])
    setEmailStudentSearch('')
    setEmailRequestResult('')
    setRevealedPrizeEmails({})
    setPendingPrizeRequests([])
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
      setAttendanceDownloadError(error instanceof Error ? error.message : 'No se pudo descargar la planilla de asistencia.')
    } finally {
      setAttendanceDownloadWorking(false)
    }
  }

  const resetDemo = async () => {
    if (!window.confirm('¿Deseás reiniciar la demostración? Se restablecerán las asistencias, los registros temporales y las credenciales emitidas al estado inicial de prueba.')) return
    setResetWorking(true)
    try {
      await api('/api/demo/reset', { method: 'POST' })
      setAttendance(null)
      setAttendanceRecords([])
      setQr(null)
      setServerCredentials([])
      setVerifyResult(null)
      await Promise.all([refreshAttendanceRoster(), refreshStudents()])
      setNotice('La demostración se reinició correctamente. El sistema volvió al estado inicial de prueba.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo reiniciar la demostración.') }
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
            setActiveTab(current.role === 'student' ? 'wallet' : current.role === 'photographer' ? 'class-photo' : current.role === 'teacher' ? 'attendance' : current.role === 'demo-tools' ? 'connection' : 'issuer')
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
    if (actor.role !== 'demo-tools') {
      void refreshWallet()
      void refreshIssuer().catch(() => undefined)
    }
    void refreshStudents().catch(() => undefined)
    if (actor.role === 'teacher') void refreshAttendanceRoster().catch(() => undefined)
    else setAttendanceRoster(null)
    if (actor.role === 'institutional' || actor.role === 'demo-tools') void api<PrizeRequest[]>('/api/raffle/prize-requests').then(setRafflePrizeRequests).catch(() => undefined)
  }, [actor, refreshAttendanceRoster, refreshIssuer, refreshStudents, refreshWallet])

  useEffect(() => {
    if (actor?.role !== 'student') return
    const refreshPrizeRequests = () => { void api<PrizeRequest[]>('/api/raffle/prize-requests/pending').then(setPendingPrizeRequests).catch(() => undefined) }
    refreshPrizeRequests()
    const timer = window.setInterval(refreshPrizeRequests, 5000)
    return () => window.clearInterval(timer)
  }, [actor?.role])

  useEffect(() => {
    if (actor?.role !== 'demo-tools' || activeTab !== 'email-requests') return
    const refresh = () => { void refreshStudents().catch(() => undefined) }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [actor?.role, activeTab, refreshStudents])

  useEffect(() => {
    if (!['institutional', 'demo-tools'].includes(actor?.role ?? '') || !['raffle', 'email-requests'].includes(activeTab)) return
    const refreshPrizeEmails = () => { void api<PrizeRequest[]>('/api/raffle/prize-requests').then(setRafflePrizeRequests).catch(() => undefined) }
    refreshPrizeEmails()
    const timer = window.setInterval(refreshPrizeEmails, 5000)
    return () => window.clearInterval(timer)
  }, [actor?.role, activeTab])

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
    if (!((activeTab === 'issuer' && actor?.role === 'institutional') || (activeTab === 'souvenir' && actor?.role === 'demo-tools'))) return
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
      setNotice(`Billetera vinculada exitosamente a ${registered.fullName} (Matrícula: ${registered.enrollmentNumber}).`)
      await refreshStudents()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudieron guardar los datos del perfil estudiantil.') }
    finally { setWorking(false) }
  }

  const issueCredential = async () => {
    const parsedGrade = Number(grade)
    if (credentialKind === 'Regularidad' && !subject.trim()) {
      setNotice('Por favor, indicá el nombre de la materia para emitir la regularidad.')
      return
    }
    if (credentialKind === 'Nota de materia' && (!grade || !Number.isFinite(parsedGrade) || parsedGrade < 1 || parsedGrade > 10)) {
      setNotice('Ingresá una calificación válida entre 1 y 10 para emitir esta credencial.')
      return
    }
    setWorking(true)
    try {
      const title = credentialKind === 'Alumno regular' ? 'Alumno regular' : credentialKind === 'Biblioteca' ? subject.trim() || 'Acceso a biblioteca' : credentialKind === 'Gimnasio' ? subject.trim() || 'Acceso al gimnasio' : subject.trim() || 'Materia sin especificar'
      const detail = credentialKind === 'Alumno regular' ? 'Condición: alumno regular' : credentialKind === 'Regularidad' ? 'Condición: regular' : credentialKind === 'Materia aprobada' ? 'Condición: materia aprobada' : credentialKind === 'Nota de materia' ? `Calificación final: ${parsedGrade}` : 'Membresía institucional activa'
      const selectedDays = validityPreset === 'custom' ? Number(validityDays) : validityPreset === 'never' ? undefined : Number(validityPreset)
      if (selectedDays !== undefined && (!Number.isInteger(selectedDays) || selectedDays < 1 || selectedDays > 36500)) { setNotice('Indicá una vigencia en días válida (entre 1 y 36.500 días).'); return }
      const response = await api<DeliveryResponse>('/api/credentials', { method: 'POST', body: JSON.stringify({ kind: credentialKind, title, detail, ...(credentialKind === 'Nota de materia' ? { grade: parsedGrade } : {}), studentId: recipientStudentId, ...(selectedDays !== undefined ? { validityDays: selectedDays } : {}) }) })
      const valid = await verifyCredential(response.credential, (await api<{ publicKeyPem: string }>('/api/issuer-key')).publicKeyPem)
      if (!valid) throw new Error('El servidor generó una firma digital inválida para la credencial.')
      setQr({ value: qrPayload('delivery', response.delivery.code), label: 'Escanear para guardar credencial', expiresAt: response.delivery.expiresAt })
      setNotice(`Credencial emitida y firmada oficialmente: «${title}». El código QR de entrega vencerá en 10 minutos.`)
      await refreshIssuer()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo emitir la credencial.') }
    finally { setWorking(false) }
  }

  const revokeCredential = async (credential: IssuedCredential) => {
    try {
      await api(`/api/credentials/${credential.id}/revoke`, { method: 'POST' })
      setNotice(`La credencial «${credential.title}» fue revocada exitosamente. Las futuras verificaciones serán rechazadas.`)
      await refreshIssuer()
      await refreshWallet()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo revocar la credencial.') }
  }

  const deleteIssuedCredential = async (credential: IssuedCredential) => {
    const confirmed = window.confirm(`¿Eliminar la credencial «${credential.title}» del registro oficial? El código QR de entrega dejará de funcionar. La copia que el estudiante tenga en su teléfono dejará de figurar como activa en el registro.`)
    if (!confirmed) return
    setCredentialDeletingId(credential.id)
    try {
      await api(`/api/credentials/${credential.id}`, { method: 'DELETE' })
      setQr(null)
      setNotice(`La credencial «${credential.title}» fue eliminada del registro oficial.`)
      await refreshIssuer()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo eliminar la credencial del registro.') }
    finally { setCredentialDeletingId('') }
  }

  const deleteWalletCredential = async (credential: WalletCredential) => {
    if (credential.localStatus === 'Activa') return
    const confirmed = window.confirm(`¿Eliminar «${credential.claims.titulo}» de esta billetera? Solo se borrará la copia almacenada en este dispositivo.`)
    if (!confirmed) return
    try {
      await removeWalletCredential(credential.id)
      const remaining = await listWalletCredentials()
      setCredentials(remaining)
      setSelectedCredentialId((current) => current === credential.id ? remaining[0]?.id ?? '' : current)
      setNotice(`Se eliminó «${credential.claims.titulo}» de tu billetera.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo eliminar la credencial de la billetera.') }
  }

  const createPresentationRequest = async () => {
    const courseCredential = ['Regularidad', 'Materia aprobada', 'Nota de materia'].includes(requestedKind)
    const parsedMinimumGrade = requestedMinimumGrade ? Number(requestedMinimumGrade) : undefined
    if (requestedSubject.trim().length > 120) { setNotice('El nombre de la materia no puede superar los 120 caracteres.'); return }
    if (requestedKind === 'Nota de materia' && parsedMinimumGrade !== undefined && (!Number.isFinite(parsedMinimumGrade) || parsedMinimumGrade < 1 || parsedMinimumGrade > 10)) { setNotice('La calificación mínima debe ser un número entre 1 y 10.'); return }
    if (requestNote.trim().length > 300) { setNotice('El detalle de la solicitud no puede superar los 300 caracteres.'); return }
    setWorking(true)
    try {
      const request = await api<VerifyRequest>('/api/presentation-requests', { method: 'POST', body: JSON.stringify({ kind: requestedKind, ...(courseCredential && requestedSubject.trim() ? { subject: requestedSubject.trim() } : {}), ...(requestedKind === 'Nota de materia' && parsedMinimumGrade !== undefined ? { minimumGrade: parsedMinimumGrade } : {}), ...(requestNote.trim() ? { requestNote: requestNote.trim() } : {}), requiredClaims: [...(requestName ? ['nombreEstudiante'] : []), ...(requestEnrollment ? ['matricula'] : []), ...(requestExactGrade ? ['nota'] : [])], includeExactGrade: requestExactGrade, minutes: 5 }) })
      setQr({ value: qrPayload('verify', request.code), label: `Solicitud de ${request.kind} · Un solo uso`, expiresAt: request.expiresAt })
      setVerifyResult(null)
      setNotice('Solicitud de verificación generada. El resultado se mostrará automáticamente cuando el titular autorice la presentación.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo generar la solicitud de verificación.') }
    finally { setWorking(false) }
  }

  const openAttendance = async () => {
    setWorking(true)
    try {
      const session = await api<AttendanceSession>('/api/attendance/sessions', { method: 'POST', body: JSON.stringify({ subject: attendanceSubject.trim() || 'Seminario de Actualización II', section: 'Comisión A', minutes: 1 }) })
      setAttendance(session)
      setAttendanceRecords([])
      setQr({ value: qrPayload('attendance', session.id), label: 'Asistencia presencial · Válido por 1 minuto', expiresAt: session.expiresAt })
      setNotice(`Toma de asistencia iniciada para ${session.subject}. El código QR vencerá a las ${formatDate(session.expiresAt)}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo iniciar la toma de asistencia.') }
    finally { setWorking(false) }
  }

  const createSouvenirSession = async () => {
    if (!souvenirTitle.trim() || !souvenirMessage.trim()) { setNotice('Por favor, completá el título y la dedicatoria del recuerdo conmemorativo.'); return }
    setWorking(true)
    try {
      const photoStatus = await api<{ available: boolean }>('/api/rewards/class-photo')
      if (!photoStatus.available) throw new Error('Primero debés cargar la fotografía de la clase desde la pestaña «Foto grupal».')
      const session = await api<SouvenirSession>('/api/rewards/sessions', { method: 'POST', body: JSON.stringify({ title: souvenirTitle.trim(), detail: souvenirMessage.trim() }) })
      setSouvenirSession(session)
      setSouvenirQrOpen(true)
      setNotice('Código QR conmemorativo generado. Los participantes recibirán su recuerdo personalizado al escanearlo.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo generar el código QR conmemorativo.') }
    finally { setWorking(false) }
  }

  const saveClassPhoto = async (file?: File) => {
    if (!file) return
    setClassPhotoWorking(true)
    setNotice('Optimizando la fotografía y guardándola en el sistema…')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1800 / bitmap.width, 1400 / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No se pudo procesar la fotografía en este dispositivo.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
      if (dataUrl.length > 4_100_000) throw new Error('La imagen seleccionada es demasiado pesada. Seleccioná una imagen más liviana o con menor resolución.')
      setClassPhotoPreview(dataUrl)
      const result = await api<{ saved: boolean; updatedAt: string }>('/api/rewards/class-photo', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      setClassPhotoStatus(true)
      setClassPhotoSavedAt(result.updatedAt)
      setNotice('Fotografía grupal guardada con éxito. Ya está disponible para los recuerdos conmemorativos.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar la fotografía en el sistema.') }
    finally { setClassPhotoWorking(false) }
  }

  const handleScan = useCallback(async (value: string) => {
    setScannerOpen(false)
    const match = /^unlar-wallet:(delivery|verify|attendance|souvenir):([A-Za-z0-9_-]+)$/.exec(value.trim())
    if (!match) { setNotice('El código QR escaneado no corresponde a una credencial o sesión válida de esta billetera.'); return }
    const [, type, code] = match
    setWorking(true)
    try {
      if (type === 'delivery') {
        if (!studentId || !savedStudent) throw new Error('Debés iniciar sesión con tu perfil de estudiante antes de recibir una credencial.')
        const holder = `did:unlar:student:${studentId}`
        const bindingProof = await signWalletProof(`claim.${code}.${holder}`)
        const response = await api<{ credential: SignedCredential }>(`/api/deliveries/${code}/claim`, { method: 'POST', body: JSON.stringify(bindingProof) })
        const key = await api<{ publicKeyPem: string }>('/api/issuer-key')
        if (!(await verifyCredential(response.credential, key.publicKeyPem))) throw new Error('La firma digital del emisor no es válida. La credencial no se guardó por seguridad.')
        await storeWalletCredential(response.credential)
        await refreshWallet()
        setActiveTab('wallet')
        setNotice(`¡Credencial validada y guardada con éxito!: «${response.credential.claims.titulo}».`)
      } else if (type === 'souvenir') {
        if (!studentId || !savedStudent) throw new Error('Debés registrarte o iniciar sesión en tu billetera antes de reclamar tu recuerdo.')
        const photo = await api<{ dataUrl: string }>('/api/rewards/class-photo/image')
        const holder = `did:unlar:student:${studentId}`
        const proof = await signWalletProof(`reward-claim.${code}.${holder}`)
        const response = await api<{ credential: SignedCredential; alreadyClaimed?: boolean }>(`/api/rewards/${code}/claim`, { method: 'POST', body: JSON.stringify(proof) })
        const key = await api<{ publicKeyPem: string }>('/api/issuer-key')
        if (!(await verifyCredential(response.credential, key.publicKeyPem))) throw new Error('La firma digital del recuerdo no es válida. No se guardó en la billetera.')
        await storeWalletCredential(response.credential)
        await refreshWallet()
        const name = studentId === 'mariano-arias-simone' ? '' : response.credential.claims.nombreEstudiante ?? savedStudent.fullName
        const image = await createSouvenirImage(name, response.credential.claims.titulo, response.credential.claims.detalle, code, photo.dataUrl)
        setSouvenirPreview({ image, name })
        setActiveTab('wallet')
        setNotice(response.alreadyClaimed ? 'Tu recuerdo conmemorativo ya estaba guardado en tu billetera. Acá podés volver a verlo y descargarlo.' : '¡Felicitaciones! Tu recuerdo personalizado ya se encuentra en tu billetera.')
      } else if (type === 'verify') {
        const request = await api<VerifyRequest>(`/api/presentation-requests/${code}`)
        setVerifyShareError('')
        setPendingVerify(request)
        setShareFields(Object.fromEntries([...(request.requiredClaims ?? []), ...(request.subject ? ['materia'] : []), ...(request.minimumGrade != null ? [`cumpleNotaMinima${request.minimumGrade}`] : [])].map((key) => [key, true])))
        setActiveTab('wallet')
        setNotice(`Solicitud de presentación recibida para «${request.kind}». Seleccioná qué datos querés compartir y confirmá.`)
      } else {
        const session = await api<AttendanceSession>(`/api/attendance/sessions/${code}`)
        setPendingAttendance(session)
        setActiveTab('wallet')
        setNotice(`El docente solicita registrar tu asistencia en «${session.subject}». Confirmá para acreditar tu presencia.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo procesar el código QR.') }
    finally { setWorking(false) }
  }, [refreshWallet, savedStudent, studentId])

  const openSavedSouvenir = async (credential: SignedCredential) => {
    setWorking(true)
    try {
      const [photo, reward] = await Promise.all([
        api<{ dataUrl: string }>('/api/rewards/class-photo/image'),
        api<{ code: string }>(`/api/rewards/credentials/${credential.id}/preview`),
      ])
      const name = studentId === 'mariano-arias-simone' ? '' : credential.claims.nombreEstudiante ?? savedStudent?.fullName ?? actor?.name ?? ''
      const image = await createSouvenirImage(name, credential.claims.titulo, credential.claims.detalle, reward.code, photo.dataUrl)
      setSouvenirPreview({ image, name })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo abrir el recuerdo.')
    } finally { setWorking(false) }
  }

  const downloadSouvenir = () => {
    if (!souvenirPreview) return
    const link = document.createElement('a')
    link.href = souvenirPreview.image
    link.download = `souvenir-unlar-${souvenirPreview.name.trim().replace(/\s+/g, '-').toLowerCase() || 'grupal'}.png`
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
        setNotice('La imagen se descargó en tu dispositivo. Ya podés adjuntarla en WhatsApp, Instagram u otra aplicación.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setNotice('No se pudo abrir el menú nativo para compartir. Descargá la imagen para enviarla manualmente.')
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
      setNotice(`Presentación compartida exitosamente con el verificador: «${credential.claims.titulo}».`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo presentar la credencial.'
      if (/revocada/i.test(message)) {
        await refreshWallet()
        setPendingVerify(null)
        setNotice(`El emisor oficial revocó la credencial «${credential.claims.titulo}». Se actualizó su estado y no fue compartida.`)
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
      setNotice('Completá y vinculá tus datos de estudiante en «Mi billetera» antes de confirmar asistencia.')
      setPendingAttendance(null)
      return
    }
    setAttendanceError('')
    setWorking(true)
    try {
      const proof = await signWalletProof(`attendance.${pendingAttendance.id}.${studentId}`)
      await api(`/api/attendance/sessions/${pendingAttendance.id}/check-in`, { method: 'POST', body: JSON.stringify({ studentId, ...proof }) })
      setPendingAttendance(null)
      setNotice(`¡Asistencia registrada con éxito en ${pendingAttendance.subject}!`)
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
      setNotice('La solicitud de verificación expiró. Generá un nuevo código QR para continuar.')
      return
    }
    const code = qr.value.split(':').at(-1)
    try {
      const response = await api<{ status: string; result?: { valid: boolean; title: string; kind: string; subject?: string; grade?: string; studentName?: string; minimumGrade?: number; minimumGradeMet?: boolean; verifiedAt: string } }>(`/api/presentation-requests/${code}/result`)
      if (response.result) {
        setVerifyResult(response.result)
        const holder = response.result.studentName ? ` · ${response.result.studentName}` : ''
        setNotice(`Credencial verificada con éxito: ${response.result.title}. Firma oficial, vigencia y titularidad acreditadas${holder}.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo consultar el resultado de la verificación.') }
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
      setNotice(`Sesión de asistencia finalizada. Total de presencias registradas: ${attendanceRecords.length}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo finalizar la sesión de asistencia.') }
  }

  if (!actor && sessionChecking) {
    return (
      <main className="login-page">
        <header className="topbar">
          <button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Ir a la página principal">
            <BrandLogo />
          </button>
        </header>
        <section className="login-card">
          <LoadingMark label="Accediendo a tu billetera digital…" />
        </section>
      </main>
    )
  }

  if (!actor && !registrationMode && (institutionalMode || !guestAlreadyRegistered)) {
    return (
      <main className="login-page">
        <header className="topbar">
          <button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Ir a la página principal">
            <BrandLogo />
          </button>
        </header>
        <section className="login-card">
          <p className="eyebrow">Acceso institucional y docente</p>
          <h1>Iniciar sesión</h1>
          <p className="muted">Seleccioná tu perfil docente o de área institucional para administrar la jornada y emitir credenciales oficiales.</p>
          <label>
            Perfil institucional
            <select value={loginAccount} onChange={(event) => setLoginAccount(event.target.value)}>
              {demoAccounts.filter((account) => account.role !== 'student').map((account) => (
                <option value={account.id} key={account.id}>{account.label}</option>
              ))}
            </select>
          </label>
          <label>
            Contraseña de acceso
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void login() }}
            />
          </label>
          {loginError && <p className="scanner-error">{loginError}</p>}
          <button type="button" className="primary-button" onClick={() => void login()} disabled={loginWorking}>
            {loginWorking && <span className="button-spinner" />}
            {loginWorking ? 'Ingresando…' : 'Ingresar al sistema'}
          </button>
        </section>
        <footer>Universidad Nacional de La Rioja · Billetera Universitaria Digital</footer>
      </main>
    )
  }

  if (!actor) {
    return (
      <main className="login-page">
        <header className="topbar">
          <button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Volver a la página principal">
            <BrandLogo />
          </button>
        </header>
        <section className="login-card guest-register-card">
          <p className="eyebrow">Participante · Registro inmediato</p>
          <h1>Tu Billetera Universitaria</h1>
          {guestAlreadyRegistered ? (
            <>
              <p className="muted">Este navegador ya cuenta con una billetera registrada a tu nombre con claves criptográficas seguras.</p>
              <p className="muted">Accedé a tu billetera para recibir credenciales, marcar asistencia y descargar tu recuerdo de la jornada.</p>
              {guestRestoreError && <p className="scanner-error" role="alert">No se pudo recuperar la billetera: {guestRestoreError}</p>}
              <button type="button" className="primary-button" onClick={goToMainPage}>Abrir mi billetera</button>
            </>
          ) : (
            <>
              <p className="muted">Ingresá tu nombre y apellido para crear tu billetera en este dispositivo. Te permitirá recibir credenciales oficiales, registrar asistencia presencial y guardar tu recuerdo.</p>
              <label>
                Nombre y apellido completo
                <input
                  autoComplete="name"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void registerGuest() }}
                  placeholder="Ej.: Ana Pérez"
                  maxLength={100}
                />
              </label>
              {guestError && <p className="scanner-error" role="alert">{guestError}</p>}
              <button type="button" className="primary-button" onClick={() => void registerGuest()} disabled={loginWorking}>
                {loginWorking && <span className="button-spinner" />}
                {loginWorking ? 'Creando claves seguras…' : 'Crear mi billetera digital'}
              </button>
              <p className="muted" style={{ fontSize: '0.8rem' }}>Tus credenciales y claves se resguardan de forma privada en la memoria de este navegador.</p>
            </>
          )}
        </section>
        <footer>Universidad Nacional de La Rioja · Identidad digital soberana</footer>
      </main>
    )
  }

  const noticeType = working
    ? 'working'
    : notice.toLowerCase().includes('error') || notice.toLowerCase().includes('rechaz') || notice.toLowerCase().includes('no se')
      ? 'error'
      : notice.toLowerCase().includes('guardad') || notice.toLowerCase().includes('verificad') || notice.toLowerCase().includes('registrad') || notice.toLowerCase().includes('emitid') || notice.toLowerCase().includes('lista')
        ? 'success'
        : 'info'

  return (
    <main>
      <header className="topbar">
        <button type="button" className="logo-home-button" onClick={goToMainPage} aria-label="Volver a la página principal">
          <BrandLogo />
        </button>
        <div className="session-badge">
          <div className="user-avatar" aria-hidden="true">
            {actor.name.charAt(0).toUpperCase()}
          </div>
          <div className="user-info">
            <strong className="user-name">{actor.name}</strong>
            <span className="user-role-badge">
              <i className="role-dot" />
              {actor.role === 'student' ? (actor.canManageClassPhoto ? 'Estudiante · Fotografía' : 'Estudiante') : actor.role === 'photographer' ? 'Estudiante' : actor.role === 'teacher' ? 'Docente' : actor.role === 'demo-tools' ? 'Herramientas Demo' : `Institución · ${actor.scope === 'academic' ? 'Gestión Académica' : actor.scope === 'library' ? 'Biblioteca' : 'Gimnasio'}`}
            </span>
          </div>
          {actor.role !== 'student' && (
            <button type="button" className="secondary-button switch-user-button" onClick={logout} title="Cambiar de usuario o cerrar sesión">
              Cambiar perfil
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow">Billetera Universitaria Digital</p>
          <h1>{actor.role === 'student' ? 'Tu vida universitaria, en un lugar.' : actor.role === 'teacher' ? 'Tu aula, conectada.' : actor.role === 'institutional' ? 'Gestión de credenciales' : 'Una jornada para compartir.'}</h1>
          <p className="lead">{actor.role === 'student' ? 'Recibí credenciales, acreditá tus estudios y confirmá tu presencia desde tu billetera.' : actor.role === 'teacher' ? 'Registrá la asistencia y verificá las credenciales que comparten tus estudiantes.' : 'Seleccioná un módulo para continuar con las actividades de la jornada.'}</p>
        </div>
        <div className="trust-card">
          <span className="trust-icon" aria-hidden="true">🛡️</span>
          <div>
            <strong>Privacidad y soberanía</strong>
            <p>Tus credenciales se guardan en este dispositivo. La institución conserva sus registros; vos elegís qué compartir al verificar.</p>
          </div>
        </div>
      </section>

      <nav className="tabs" aria-label="Módulos del sistema">
        {allowedTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? 'tab active' : 'tab'}
            key={tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className={`notice notice-${noticeType}`} role="status">
        <div className="notice-icon-bubble" aria-hidden="true">
          {working ? <span className="inline-spinner" /> : noticeType === 'success' ? '✓' : noticeType === 'error' ? '!' : 'ℹ'}
        </div>
        <div className="notice-content">
          <strong>{working ? 'Procesando…' : noticeType === 'success' ? 'Operación exitosa' : noticeType === 'error' ? 'Atención' : 'Información'}</strong>
          <p>{notice}</p>
        </div>
      </div>

      {activeTab === 'wallet' && (
        <section className="layout wallet-layout">
          <div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Espacio personal</p>
                <h2>Mis credenciales</h2>
              </div>
              <span className="count">{credentials.length}</span>
            </div>

            <div className="student-profile">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="eyebrow" style={{ margin: 0 }}>Identidad del titular</p>
                {savedStudent?.walletLinked && (
                  <span className="live-badge" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>
                    <i /> Vinculada al sistema
                  </span>
                )}
              </div>
              <div className="student-profile-grid">
                <label>Titular de la billetera<input value={savedStudent?.fullName ?? actor.name} readOnly /></label>
                <label>Número de matrícula<input value={savedStudent?.enrollmentNumber ?? 'Cargando matrícula…'} readOnly /></label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveStudentProfile()}
                  disabled={working || !savedStudent || savedStudent.walletLinked}
                >
                  {!savedStudent ? <><span className="button-spinner" /> Cargando perfil…</> : savedStudent.walletLinked ? '✓ Billetera vinculada' : 'Vincular esta billetera'}
                </button>
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                  La vinculación asocia criptográficamente tu billetera con tus registros académicos de forma segura y privada.
                </p>
              </div>
            </div>

            <div className="wallet-actions">
              <button type="button" className="primary-button wallet-scan-desktop" onClick={() => setScannerOpen(true)}>
                <span>📷</span> Escanear código QR
              </button>
              <span className="muted">Tus credenciales se resguardan de forma segura en este dispositivo.</span>
            </div>

            {credentials.length ? (
              <>
                {credentials.length > 1 && (
                  <div className="wallet-filter-bar">
                    <span className="wallet-filter-label">Agrupar por tipo:</span>
                    <div className="wallet-filter-pills" role="tablist" aria-label="Filtrar por categoría">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={walletCategoryFilter === 'all'}
                        className={`wallet-filter-pill ${walletCategoryFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setWalletCategoryFilter('all')}
                      >
                        Todas <span className="filter-count">{categoryCounts.all}</span>
                      </button>
                      {categoryCounts.identity > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={walletCategoryFilter === 'identity'}
                          className={`wallet-filter-pill filter-identity ${walletCategoryFilter === 'identity' ? 'active' : ''}`}
                          onClick={() => setWalletCategoryFilter('identity')}
                        >
                          🎓 Identidad <span className="filter-count">{categoryCounts.identity}</span>
                        </button>
                      )}
                      {categoryCounts.academic > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={walletCategoryFilter === 'academic'}
                          className={`wallet-filter-pill filter-academic ${walletCategoryFilter === 'academic' ? 'active' : ''}`}
                          onClick={() => setWalletCategoryFilter('academic')}
                        >
                          📚 Académicas <span className="filter-count">{categoryCounts.academic}</span>
                        </button>
                      )}
                      {categoryCounts.service > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={walletCategoryFilter === 'service'}
                          className={`wallet-filter-pill filter-service ${walletCategoryFilter === 'service' ? 'active' : ''}`}
                          onClick={() => setWalletCategoryFilter('service')}
                        >
                          ⚡ Servicios <span className="filter-count">{categoryCounts.service}</span>
                        </button>
                      )}
                      {categoryCounts.commemorative > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={walletCategoryFilter === 'commemorative'}
                          className={`wallet-filter-pill filter-commemorative ${walletCategoryFilter === 'commemorative' ? 'active' : ''}`}
                          onClick={() => setWalletCategoryFilter('commemorative')}
                        >
                          ✦ Conmemorativas <span className="filter-count">{categoryCounts.commemorative}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="credential-list">
                  {filteredCredentials.map((credential) => (
                    <div className="wallet-credential-row" key={credential.id}>
                      <button
                        type="button"
                        className={`credential-card ${cardThemeClass(credential.type)} kind-${credentialKindSlug(credential.type)} ${selectedCredentialId === credential.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedCredentialId(credential.id)
                          if (credential.type === 'Souvenir') void openSavedSouvenir(credential)
                        }}
                      >
                        <div className="card-chip-strip">
                          <div className={`card-chip chip-${credentialKindSlug(credential.type)}`}>
                            <div className="chip-line" />
                          </div>
                          <span className="card-institution">UNLaR · {credentialCategory(credential.type).label.toUpperCase()}</span>
                          <span className={`card-kind-badge badge-${credentialKindSlug(credential.type)}`}>
                            {iconFor(credential.type as CredentialKind)} {credential.type}
                          </span>
                        </div>
                        <div className="card-body">
                          <div className="card-title-group">
                            <span className="card-category-tag">{credentialCategory(credential.type).label}</span>
                            <strong className="card-title">{credential.claims.titulo}</strong>
                            <span className="card-detail">{credential.claims.detalle}</span>
                          </div>
                          {credential.claims.nota && (
                            <div className="card-grade-badge">
                              <small>CALIFICACIÓN</small>
                              <strong>{credential.claims.nota} <span className="grade-max">/ 10</span></strong>
                            </div>
                          )}
                        </div>
                        <div className="card-footer">
                          <div className="card-holder-info">
                            <small className="card-holder-label">TITULAR ACREDITADO</small>
                            <span className="card-holder-name">{credential.claims.nombreEstudiante ?? savedStudent?.fullName ?? actor.name}</span>
                            {credential.claims.matricula && (
                              <span className="card-holder-matricula">Mat. {credential.claims.matricula}</span>
                            )}
                          </div>
                          <div className="card-footer-right">
                            {credential.type === 'Biblioteca' && (
                              <span className="card-sub-tag">PRÉSTAMOS HABILITADOS</span>
                            )}
                            {credential.type === 'Gimnasio' && (
                              <span className="card-sub-tag">PASE LIBRE</span>
                            )}
                            {credential.type === 'Souvenir' && (
                              <span className="card-sub-tag">EDICIÓN 2026</span>
                            )}
                            {credential.type === 'Alumno regular' && (
                              <span className="card-sub-tag">IDENTIDAD</span>
                            )}
                            {credential.type === 'Materia aprobada' && (
                              <span className="card-sub-tag">ACREDITADA</span>
                            )}
                            {credential.type === 'Regularidad' && (
                              <span className="card-sub-tag">REGULAR</span>
                            )}
                            <span className={credential.localStatus === 'Activa' ? 'status good' : 'status bad'}>
                              <i className="status-dot" />
                              {credential.localStatus}
                            </span>
                          </div>
                        </div>
                      </button>
                      {credential.localStatus !== 'Activa' && (
                        <button
                          type="button"
                          className="trash-icon-button"
                          aria-label={`Eliminar «${credential.claims.titulo}» de esta billetera`}
                          title="Eliminar de esta billetera"
                          onClick={() => void deleteWalletCredential(credential)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M10 11v6m4-6v6M5.5 7l1 13h11l1-13M9 7V4h6v3" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">🪪</span>
                <h3>Todavía no tenés credenciales guardadas</h3>
                <p>Cuando la institución o un docente emita un certificado oficial, escaneá el código QR de entrega para guardarlo en este dispositivo.</p>
              </div>
            )}
          </div>

          <aside className="detail-panel">
            {selectedCredential ? (
              <>
                <div className="security-verified-badge">
                  <span>🛡️</span> Firma digital ML-DSA-65 verificada
                </div>
                <p className="eyebrow">{selectedCredential.type}</p>
                <h2>{selectedCredential.claims.titulo}</h2>
                <p className="detail-copy">{selectedCredential.claims.detalle}</p>
                <dl>
                  <div><dt>Entidad emisora</dt><dd>Universidad Nacional de La Rioja</dd></div>
                  <div><dt>Fecha de emisión</dt><dd>{formatDate(selectedCredential.issuedAt)}</dd></div>
                  <div><dt>Período de vigencia</dt><dd>{selectedCredential.expiresAt ? formatDate(selectedCredential.expiresAt) : 'Permanente (sin vencimiento)'}</dd></div>
                  <div><dt>Titular acreditado</dt><dd>{selectedCredential.claims.nombreEstudiante ?? 'Perfil vinculado'}</dd></div>
                  {selectedCredential.claims.matricula && <div><dt>Número de matrícula</dt><dd>{selectedCredential.claims.matricula}</dd></div>}
                  <div><dt>Seguridad criptográfica</dt><dd>{selectedCredential.proof.algorithm}</dd></div>
                  <div><dt>Estado en registro oficial</dt><dd>{selectedCredential.localStatus}</dd></div>
                </dl>
              </>
            ) : (
              <>
                <p className="eyebrow">Espacio personal</p>
                <h2>Credenciales verificables seguras</h2>
                <p className="detail-copy">Tus constancias académicas cuentan con firma digital institucional y podés presentarlas de forma privada y directa.</p>
              </>
            )}
          </aside>
        </section>
      )}

      {activeTab === 'issuer' && (
        <section className="layout issuer-layout">
          <div className="panel form-panel">
            <p className="eyebrow">Gestión institucional · {actor.scope === 'academic' ? 'Área Académica' : actor.scope === 'library' ? 'Biblioteca Universitaria' : 'Área de Deportes'}</p>
            <h2>Emitir credencial digital</h2>
            <p className="muted">Las credenciales se firman digitalmente con la clave oficial de la universidad y quedan asociadas al perfil del estudiante.</p>
            <div className="form-grid">
              <label>
                Estudiante destinatario
                <select value={recipientStudentId} onChange={(event) => setRecipientStudentId(event.target.value)}>
                  {demoStudents.map((student) => (
                    <option value={student.id} key={student.id}>{student.fullName} · Matrícula: {student.enrollmentNumber}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de credencial
                <select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>
                  {allowedKinds.map((kind) => <option key={kind}>{kind}</option>)}
                </select>
              </label>
              {credentialKind !== 'Alumno regular' && (
                <label>
                  {credentialKind === 'Biblioteca' || credentialKind === 'Gimnasio' ? 'Servicio o beneficio' : 'Materia académica'}
                  <input
                    value={credentialKind === 'Biblioteca' || credentialKind === 'Gimnasio' ? (subject === 'Bases de Datos' ? '' : subject) : subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder={credentialKind === 'Biblioteca' ? 'Ej.: Préstamo bibliográfico regular' : credentialKind === 'Gimnasio' ? 'Ej.: Acceso a sala de musculación' : 'Ej.: Bases de Datos'}
                  />
                </label>
              )}
              {credentialKind === 'Nota de materia' && (
                <label>
                  Calificación (escala de 1 a 10)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="10"
                    step="0.01"
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    placeholder="Ej.: 8.50"
                    required
                  />
                </label>
              )}
              <label>
                Período de vigencia
                <select value={validityPreset} onChange={(event) => setValidityPreset(event.target.value)}>
                  <option value="never">Sin vencimiento (permanente)</option>
                  <option value="7">1 semana (7 días)</option>
                  <option value="30">1 mes (30 días)</option>
                  <option value="90">3 meses (90 días)</option>
                  <option value="365">1 año (365 días)</option>
                  <option value="custom">Período personalizado…</option>
                </select>
              </label>
              {validityPreset === 'custom' && (
                <label>
                  Duración de la vigencia (en días)
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="36500"
                    step="1"
                    value={validityDays}
                    onChange={(event) => setValidityDays(event.target.value)}
                    placeholder="Ej.: 45"
                  />
                </label>
              )}
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => void issueCredential()}
              disabled={working || (credentialKind === 'Regularidad' && !subject.trim()) || (credentialKind === 'Nota de materia' && !grade) || (validityPreset === 'custom' && !validityDays)}
            >
              {working && <span className="button-spinner" />}
              {working ? 'Firmando y emitiendo…' : 'Emitir y generar código QR'}
            </button>
          </div>

          <aside className="panel request-panel">
            {qr?.value.includes(':delivery:') ? (
              <>
                <QrDisplay value={qr.value} label={qr.label} />
                <h3>Entrega de credencial</h3>
                <p>Disponible hasta: {formatDate(qr.expiresAt)}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshIssuer(true).catch((error) => setNotice(error instanceof Error ? error.message : 'No se pudieron actualizar las emisiones.'))}
                  disabled={issuerRefreshStatus === 'loading'}
                >
                  {issuerRefreshStatus === 'loading' ? <><span className="button-spinner" /> Actualizando…</> : issuerRefreshStatus === 'updated' ? 'Actualizado ✓' : 'Actualizar registro'}
                </button>
              </>
            ) : (
              <>
                <span className="qr-placeholder">▦</span>
                <h3>Entrega presencial por QR</h3>
                <p>Al emitir la credencial, el estudiante escanea el código QR con su cámara para guardarla en su billetera digital.</p>
              </>
            )}
          </aside>

          <div className="panel issuer-records">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Registro oficial</p>
                <h2>Credenciales emitidas</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshIssuer(true).catch((error) => setNotice(error instanceof Error ? error.message : 'No se pudieron actualizar las emisiones.'))}
                disabled={issuerRefreshStatus === 'loading'}
              >
                {issuerRefreshStatus === 'loading' ? <><span className="button-spinner" /> Actualizando…</> : issuerRefreshStatus === 'updated' ? 'Actualizado ✓' : 'Actualizar'}
              </button>
            </div>
            {serverCredentials.length ? (
                <div className="issued-credentials-list">
                {serverCredentials.map((credential) => (
                    <div className="issuer-issued-card-row" key={credential.id}>
                      <article className={`credential-card issuer-issued-card ${cardThemeClass(credential.kind)} kind-${credentialKindSlug(credential.kind)}`}>
                        <div className="card-chip-strip">
                          <div className={`card-chip chip-${credentialKindSlug(credential.kind)}`}><div className="chip-line" /></div>
                          <span className="card-institution">UNLaR · {credentialCategory(credential.kind).label.toUpperCase()}</span>
                          <span className={`card-kind-badge badge-${credentialKindSlug(credential.kind)}`}>
                            {iconFor(credential.kind)} {credential.kind}
                          </span>
                        </div>
                        <div className="card-body">
                          <div className="card-title-group">
                            <span className="card-category-tag">{credentialCategory(credential.kind).label}</span>
                            <strong className="card-title">{credential.title}</strong>
                            <span className="card-detail">{credential.detail}</span>
                          </div>
                          {credential.kind === 'Nota de materia' && credential.detail.match(/\d+(?:[.,]\d+)?/) && (
                            <div className="card-grade-badge">
                              <small>CALIFICACIÓN</small>
                              <strong>{credential.detail.match(/\d+(?:[.,]\d+)?/)?.[0]} <span className="grade-max">/ 10</span></strong>
                            </div>
                          )}
                        </div>
                        <div className="card-footer">
                          <div className="card-holder-info">
                            <small className="card-holder-label">TITULAR ACREDITADO</small>
                            <span className="card-holder-name">{credential.studentName ?? 'Titular no disponible'}</span>
                            {credential.enrollmentNumber && <span className="card-holder-matricula">Mat. {credential.enrollmentNumber}</span>}
                          </div>
                          <span className={credential.status === 'Activa' ? 'status good' : 'status bad'}>
                            <i className="status-dot" />{credential.status}
                          </span>
                        </div>
                      </article>
                      <div className="record-actions issuer-issued-actions">
                        {credential.status === 'Activa' && (
                          <button type="button" className="record-revoke-btn" onClick={() => void revokeCredential(credential)}>
                            Revocar
                          </button>
                        )}
                        <button
                          type="button"
                          className="trash-icon-button"
                          aria-label={`Eliminar la credencial «${credential.title}» del registro`}
                          title="Eliminar credencial"
                          disabled={credentialDeletingId === credential.id}
                          onClick={() => void deleteIssuedCredential(credential)}
                        >
                          {credentialDeletingId === credential.id ? (
                            <span className="button-spinner" />
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 7h16M10 11v6m4-6v6M5.5 7l1 13h11l1-13M9 7V4h6v3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                ))}
              </div>
            ) : (
              <p className="muted">Todavía no se han emitido credenciales en este panel.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'email-requests' && actor.role === 'demo-tools' && (
        <section className="manual-email-layout">
          <div className="panel manual-email-panel">
            <p className="eyebrow">Herramientas Demo</p>
            <h2>Solicitar emails</h2>
            <p>Elegí quiénes recibirán el aviso en su billetera. Podés seleccionar cualquier cantidad de estudiantes.</p>
            <label className="manual-email-search">Buscar estudiante
              <input type="search" value={emailStudentSearch} onChange={(event) => setEmailStudentSearch(event.target.value)} placeholder="Nombre o matrícula" />
            </label>
            <div className="manual-email-actions">
              <strong>{emailStudentIds.length} seleccionado{emailStudentIds.length === 1 ? '' : 's'}</strong>
              <button type="button" className="secondary-button" disabled={sendingEmailRequests} onClick={() => setEmailStudentIds((current) => [...new Set([...current, ...demoStudents.filter((student) => student.walletLinked && normalizeText(`${student.fullName} ${student.enrollmentNumber}`).includes(normalizeText(emailStudentSearch))).map((student) => student.id)])])}>Seleccionar los visibles</button>
              <button type="button" className="secondary-button" disabled={sendingEmailRequests || !emailStudentIds.length} onClick={() => setEmailStudentIds([])}>Limpiar selección</button>
            </div>
            <div className="manual-email-students">
              {demoStudents.filter((student) => normalizeText(`${student.fullName} ${student.enrollmentNumber}`).includes(normalizeText(emailStudentSearch))).map((student) => (
                <label key={student.id} className={!student.walletLinked ? 'is-unavailable' : ''}>
                  <input type="checkbox" checked={emailStudentIds.includes(student.id)} disabled={!student.walletLinked || sendingEmailRequests} onChange={(event) => setEmailStudentIds((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} />
                  <span><strong>{student.fullName}</strong><small>{student.enrollmentNumber || 'Sin matrícula'}{!student.walletLinked ? ' · Billetera sin vincular' : ''}</small></span>
                </label>
              ))}
              {!demoStudents.some((student) => normalizeText(`${student.fullName} ${student.enrollmentNumber}`).includes(normalizeText(emailStudentSearch))) && <p>No hay estudiantes que coincidan con la búsqueda.</p>}
            </div>
            <button type="button" className="primary-button" disabled={sendingEmailRequests || !emailStudentIds.length} onClick={() => void sendManualEmailRequests()}>{sendingEmailRequests ? 'Enviando avisos…' : `Solicitar email a ${emailStudentIds.length} estudiante${emailStudentIds.length === 1 ? '' : 's'}`}</button>
            <p className="manual-email-result" role="status">{emailRequestResult}</p>
            <small>El aviso aparece al abrir la billetera o en su siguiente actualización. No se duplica si ya tiene una solicitud pendiente.</small>
          </div>
          <aside className="panel manual-email-panel">
            <div className="raffle-prize-contacts-heading"><h2>Respuestas</h2><button type="button" className="secondary-button" onClick={() => void refreshPrizeRequestList()} disabled={refreshingPrizeRequests}>{refreshingPrizeRequests ? 'Actualizando…' : '↻ Actualizar'}</button></div>
            <div className="raffle-prize-contacts">
              {rafflePrizeRequests.some((request) => request.source === 'manual') ? <ul>{rafflePrizeRequests.filter((request) => request.source === 'manual').map((request) => <li key={request.id}><strong>{request.studentName}</strong><span>{request.email ? <>{revealedPrizeEmails[request.id] ? request.email : 'Email recibido'} <button className="reveal-email-button" type="button" aria-label={revealedPrizeEmails[request.id] ? 'Ocultar email' : 'Mostrar email'} onClick={() => setRevealedPrizeEmails((current) => ({ ...current, [request.id]: !current[request.id] }))}>{revealedPrizeEmails[request.id] ? '◉' : '⦸'}</button></> : 'Esperando respuesta'}</span></li>)}</ul> : <p>Todavía no enviaste solicitudes manuales.</p>}
            </div>
          </aside>
        </section>
      )}

      {activeTab === 'raffle' && (actor.role === 'institutional' || actor.role === 'demo-tools') && (
        <section className="raffle-layout">
          <div className="panel raffle-panel">
            <p className="eyebrow">Actividad institucional</p>
            <h2>Sorteo de participantes</h2>
            <p className="muted">La ruleta elige cinco personas al azar. Cada ganador se retira de los próximos giros.</p>
            <label className="raffle-target-select">Ganadores
              <select value={raffleWinnerTarget} onChange={(event) => { setRaffleWinnerTarget(Number(event.target.value)); setRaffleWinners([]); setRaffleWinnerId(''); setRaffleRotation(0); setRafflePrizeRequests([]); setRaffleId(crypto.randomUUID()); setRaffleReplaceIndex(null) }} disabled={raffleSpinning}>
                {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            {(() => {
              const participants = demoStudents.filter((student) => !excludedRaffleStudentIds.has(student.id))
              const eligible = participants.filter((student) => !raffleWinners.some((winner) => winner.id === student.id))
              return <button className="raffle-wheel-button" type="button" onClick={() => spinRaffle()} disabled={raffleSpinning || (raffleWinners.length >= raffleWinnerTarget && raffleReplaceIndex === null) || demoStudents.filter((student) => !excludedRaffleStudentIds.has(student.id) && !raffleWinners.some((winner) => winner.id === student.id)).length === 0} aria-label={raffleSpinning ? 'La ruleta está girando' : `Sortear ganador ${raffleWinners.length + 1}`}>
              <div className="raffle-wheel-wrap">
                <span className="raffle-pointer" aria-hidden="true">▼</span>
                <div className="raffle-wheel" style={{ transform: `rotate(${raffleRotation}deg)`, transition: 'none', background: `conic-gradient(from 0deg, ${eligible.map((_, index) => `${['#1d5b96','#e1ae16','#328b76','#e97b43','#7b63a8','#d86076'][index % 6]} ${(index / Math.max(eligible.length, 1)) * 360}deg ${((index + 1) / Math.max(eligible.length, 1)) * 360}deg`).join(',') || '#dce7f1 0deg 360deg'})` }} />
                <div className="raffle-label-layer" aria-hidden="true">
                  {eligible.map((student, index) => {
                    const angle = ((index + 0.5) * 360) / eligible.length + raffleRotation - 90
                    const radians = angle * Math.PI / 180
                    const x = 50 + Math.cos(radians) * 35
                    const y = 50 + Math.sin(radians) * 35
                    const distanceToPointer = Math.abs(((angle + 90 + 540) % 360) - 180)
                    const size = distanceToPointer < 6 ? 'large' : distanceToPointer < 19 ? 'medium' : 'small'
                    return <span className={`raffle-name-label raffle-name-${size}`} key={student.id} style={{ left: `${x}%`, top: `${y}%` }} title={student.fullName}>{student.fullName}</span>
                  })}
                </div>
                <div className="raffle-wheel-hub" aria-hidden="true" />
                <div className={`raffle-pointer-readout ${raffleSpinning ? 'is-live' : ''} ${raffleCelebration ? 'is-celebrating' : ''}`} aria-live="polite">
                  {raffleCelebration && <div className="raffle-confetti" key={raffleWinners.length} aria-hidden="true">{Array.from({ length: 72 }, (_, i) => {
                    const angle = (i * 137.5) * Math.PI / 180
                    const distance = 55 + (i % 9) * 15
                    return <i key={i} style={{ left: `${50 + Math.cos(angle) * distance / 4}%`, top: `${50 + Math.sin(angle) * distance / 2}%`, animationDelay: `${(i % 12) * 18}ms`, backgroundColor: `hsl(${(i * 47) % 360} 95% 55%)`, transform: `rotate(${i * 29}deg)` }} />
                  })}</div>}
                  <span>{raffleSpinning ? 'La ruleta señala' : raffleWinnerId ? 'Ganador' : 'En la punta'}</span>
                  <strong>{rafflePointerName || '—'}</strong>
                </div>
              </div>
              </button>
            })()}
            <div className="raffle-result" aria-live="polite">
              {raffleSpinning ? <><span className="raffle-sparkle">✦</span> La ruleta está girando…</> : raffleWinnerId ? 'El ganador se suma a la lista.' : raffleWinners.length >= raffleWinnerTarget ? '¡Sorteo completo!' : `${demoStudents.filter((student) => !excludedRaffleStudentIds.has(student.id) && !raffleWinners.some((winner) => winner.id === student.id)).length} participantes disponibles`}
            </div>
            <div className="raffle-prize-contacts">
              <div className="raffle-prize-contacts-heading"><h3>Emails para entrega del regalo</h3><button type="button" className="secondary-button" onClick={() => void refreshPrizeRequestList()} disabled={refreshingPrizeRequests}>{refreshingPrizeRequests ? 'Actualizando…' : '↻ Actualizar'}</button></div>
              <p>Guardados en el registro del sorteo; los emails permanecen ocultos hasta que los reveles.</p>
              {rafflePrizeRequests.filter((request) => request.source !== 'manual' && !request.retiredAt && request.studentId !== raffleRedrawStudentId).length ? <ul>{rafflePrizeRequests.filter((request) => request.source !== 'manual' && !request.retiredAt && request.studentId !== raffleRedrawStudentId).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.place - b.place).map((request) => <li key={request.id}><strong>{request.place}° · {request.studentName}</strong><span>{request.email ? <>{revealedPrizeEmails[request.id] ? request.email : 'Email recibido'} <button className="reveal-email-button" type="button" aria-label={revealedPrizeEmails[request.id] ? 'Ocultar email' : 'Mostrar email'} onClick={() => setRevealedPrizeEmails((current) => ({ ...current, [request.id]: !current[request.id] }))}>{revealedPrizeEmails[request.id] ? '◉' : '⦸'}</button></> : 'Esperando respuesta'}</span></li>)}</ul> : <p className="raffle-prize-empty">Todavía no hay emails registrados.</p>}
            </div>
          </div>
          <aside className="panel raffle-winners-panel">
            <p className="eyebrow">Resultados</p>
            <h2>Ganadores</h2>
            <p className="muted">Se muestran en el orden en que salieron.</p>
            {raffleWinners.length ? <ol className="raffle-winners-list">{raffleWinners.map((winner, index) => <li className={`raffle-winner-place-${index + 1}`} key={`${winner.id}-${index}`}><span className="raffle-place">{index + 1}</span><span><strong>{winner.fullName}</strong><small>Matrícula {winner.enrollmentNumber}</small></span><span className="raffle-trophy">{index < 3 ? '🏆' : '•'}</span><button className="raffle-redraw-button" type="button" title={`Volver a sortear el puesto ${index + 1}`} aria-label={`Volver a sortear el puesto ${index + 1}`} disabled={raffleSpinning} onClick={() => { setRaffleReplaceIndex(index); setRaffleRedrawStudentId(winner.id); spinRaffle(index) }}>↻</button></li>)}</ol> : <div className="raffle-empty"><span>🏅</span><p>Los ganadores aparecerán aquí, uno por uno.</p></div>}
            {raffleWinners.length > 0 && <button type="button" className="secondary-button" onClick={() => { setRaffleWinners([]); setRaffleWinnerId(''); setRafflePrizeRequests([]); setRaffleId(crypto.randomUUID()); setRaffleReplaceIndex(null) }} disabled={raffleSpinning}>Reiniciar sorteo</button>}
          </aside>
        </section>
      )}

      {activeTab === 'verify' && (
        <section className="layout verify-layout">
          <div className="panel">
            <p className="eyebrow">Verificador institucional</p>
            <h2>Solicitar presentación</h2>
            <p className="muted">El código QR es temporal (válido por 5 minutos). Cuando el estudiante responda desde su billetera, el resultado se mostrará en pantalla de forma automática.</p>
            <label>
              Tipo de credencial requerida
              <select value={requestedKind} onChange={(event) => setRequestedKind(event.target.value as CredentialKind)}>
                {kinds.map((kind) => <option key={kind}>{kind}</option>)}
              </select>
            </label>
            {['Regularidad', 'Materia aprobada', 'Nota de materia'].includes(requestedKind) && (
              <label>
                Materia específica (opcional)
                <input
                  value={requestedSubject}
                  onChange={(event) => setRequestedSubject(event.target.value)}
                  maxLength={120}
                  placeholder="Ej.: Bases de Datos"
                />
              </label>
            )}
            {requestedKind === 'Nota de materia' && (
              <label>
                Calificación mínima exigida (opcional)
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.01"
                  value={requestedMinimumGrade}
                  onChange={(event) => setRequestedMinimumGrade(event.target.value)}
                  placeholder="Ej.: 7"
                />
              </label>
            )}
            <fieldset className="disclosure-options">
              <legend>Datos específicos a solicitar al titular</legend>
              <label>
                <input type="checkbox" checked={requestName} onChange={(event) => setRequestName(event.target.checked)} />
                Nombre y apellido
              </label>
              <label>
                <input type="checkbox" checked={requestEnrollment} onChange={(event) => setRequestEnrollment(event.target.checked)} />
                Número de matrícula
              </label>
              {requestedKind === 'Nota de materia' && (
                <label>
                  <input type="checkbox" checked={requestExactGrade} onChange={(event) => setRequestExactGrade(event.target.checked)} />
                  Calificación exacta (si se desmarca, solo se comprueba si cumple la mínima)
                </label>
              )}
            </fieldset>
            <label>
              Motivo o contexto de la solicitud (opcional)
              <textarea
                rows={3}
                maxLength={300}
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                placeholder="Indicá para qué trámite o requisito se solicita esta información"
              />
            </label>
            <button type="button" className="primary-button" onClick={() => void createPresentationRequest()} disabled={working}>
              {working && <span className="button-spinner" />}
              {working ? 'Generando solicitud…' : 'Generar código QR de verificación'}
            </button>
          </div>

          <aside className={`panel request-panel${verifyResult ? ' verify-result-panel' : ''}`}>
            {qr?.value.includes(':verify:') ? (
              <>
                <QrDisplay value={qr.value} label={qr.label} />
                <h3>Solicitud de verificación activa</h3>
                <p>Disponible hasta: {formatDate(qr.expiresAt)}</p>
                {verifyResult ? (
                  <div className="verification-result">
                    <span className="result-check">✓</span>
                    <div>
                      <strong>Credencial verificada con éxito</strong>
                      <p>{verifyResult.studentName ? `${verifyResult.studentName} · ` : ''}{verifyResult.title} · {verifyResult.kind}</p>
                      {(verifyResult.subject || verifyResult.grade || verifyResult.minimumGradeMet !== undefined) && (
                        <small>
                          {verifyResult.subject ? `Materia: ${verifyResult.subject}` : ''}
                          {verifyResult.grade ? ` · Calificación: ${verifyResult.grade}` : verifyResult.minimumGradeMet !== undefined ? ` · Cumple nota mínima (${verifyResult.minimumGrade}): ${verifyResult.minimumGradeMet ? 'Sí' : 'No'}` : ''}
                        </small>
                      )}
                      <small>Firma digital, vigencia, titularidad y validez en registro confirmadas</small>
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    <LoadingMark label="Esperando la presentación del titular…" />
                    Esta sección se actualizará automáticamente.
                  </p>
                )}
              </>
            ) : (
              <>
                <span className="qr-placeholder">▦</span>
                <h3>Verificación con consentimiento</h3>
                <p>El titular de la billetera verá qué datos específicos solicitás y autorizará el envío de forma selectiva antes de presentar su credencial.</p>
              </>
            )}
          </aside>
        </section>
      )}

      {activeTab === 'connection' && (
        <section className="connection-section">
          <div className="connection-header">
            <p className="eyebrow">Conectividad · Aula presencial</p>
            <h2>Acceso a la red y a la billetera</h2>
            <p className="connection-lead">
              Facilitá la conexión de los asistentes en dos pasos simples: primero pueden conectarse a la red Wi-Fi del aula y luego abrir la billetera en sus teléfonos para participar activamente de la clase.
            </p>
          </div>

          <div className="connection-grid">
            <div className="panel connection-config-panel">
              <div className="connection-panel-title">
                <div className="panel-step-badge">
                  <span className="step-num">1</span>
                  <span>Configuración de red</span>
                </div>
                <h3>Parámetros del Wi-Fi</h3>
              </div>

              <div className="connection-form">
                <label>
                  <span>Nombre de la red Wi-Fi (SSID)</span>
                  <input
                    value={networkInfo.ssid || wifiSsidOverride}
                    onChange={(event) => { setWifiSsidOverride(event.target.value); setShowWifiQr(false) }}
                    readOnly={Boolean(networkInfo.ssid)}
                    placeholder="Ingresá el nombre exacto de la red Wi-Fi"
                  />
                  {networkInfo.ssid ? (
                    <span className="connection-badge-detected">✓ Detectada automáticamente</span>
                  ) : (
                    <p className="muted small-tip">El sistema no detectó automáticamente el nombre. Ingresalo tal como figura en los ajustes de red.</p>
                  )}
                </label>

                <label>
                  <span>Seguridad de la red</span>
                  <select
                    value={wifiSecurity}
                    onChange={(event) => { setWifiSecurity(event.target.value as 'WPA' | 'nopass'); setShowWifiQr(false) }}
                  >
                    <option value="WPA">Red protegida con contraseña (WPA / WPA2 / WPA3)</option>
                    <option value="nopass">Red abierta (sin contraseña)</option>
                  </select>
                </label>

                {wifiSecurity === 'WPA' && (
                  <label>
                    <span>Contraseña de la red Wi-Fi</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={wifiPassword}
                      onChange={(event) => { setWifiPassword(event.target.value); setShowWifiQr(false) }}
                      placeholder="Ingresá la clave de acceso"
                    />
                  </label>
                )}

                <div className="connection-security-note">
                  <span className="security-icon" aria-hidden="true">🔒</span>
                  <p>La contraseña solo se utiliza para generar el código QR en esta pantalla; no se almacena ni transmite al servidor.</p>
                </div>

                <button
                  type="button"
                  className="primary-button connection-generate-btn"
                  onClick={() => setShowWifiQr(true)}
                  disabled={!wifiSsid || (wifiSecurity === 'WPA' && !wifiPassword)}
                >
                  {showWifiQr && wifiQr ? '✓ Código QR de Wi-Fi generado' : 'Generar código QR de Wi-Fi'}
                </button>
              </div>
            </div>

            <div className="connection-qrs-column">
              <div className={`connection-qr-card ${showWifiQr && wifiQr ? 'active' : 'waiting'}`}>
                <div className="connection-card-header">
                  <div className="connection-qr-badge step-1">
                    <span className="step-indicator">Paso 1</span>
                    <strong>📶 Conexión Wi-Fi</strong>
                  </div>
                  {wifiSsid && (
                    <span className="connection-ssid-tag">
                      Red: <strong>{wifiSsid}</strong> {wifiSecurity === 'nopass' ? '(abierta)' : ''}
                    </span>
                  )}
                </div>

                <div className="connection-qr-body">
                  {showWifiQr && wifiQr ? (
                    <div className="connection-qr-frame-wrapper">
                      <QrDisplay value={wifiQr} label={`Wi-Fi · ${wifiSsid}${wifiSecurity === 'nopass' ? ' (red abierta)' : ''}`} />
                      <p className="connection-qr-instruction">
                        Los asistentes escanean este código con la cámara de su teléfono para conectarse a la red sin ingresar la clave manualmente.
                      </p>
                    </div>
                  ) : (
                    <div className="connection-qr-waiting">
                      <span className="qr-placeholder">📶</span>
                      <div className="waiting-text">
                        <h4>Esperando configuración de red</h4>
                        <p>Completá los datos del Wi-Fi en el panel izquierdo y hacé clic en "Generar código QR" para proyectarlo.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="connection-qr-card connection-app-card active">
                <div className="connection-card-header">
                  <div className="connection-qr-badge step-2">
                    <span className="step-indicator">Paso 2</span>
                    <strong>📲 Billetera Universitaria</strong>
                  </div>
                  <span className="connection-live-tag">En vivo en red local</span>
                </div>

                <div className="connection-qr-body">
                  <div className="connection-qr-frame-wrapper">
                    <QrDisplay value={localAppUrl} label="Escanear para abrir la billetera" />
                    <div className="connection-url-box">
                      <span className="connection-url-label">Dirección local en el aula:</span>
                      <code className="connection-url-code">{localAppUrl}</code>
                    </div>
                    <p className="connection-qr-instruction">
                      Una vez conectados al Wi-Fi del aula, los asistentes escanean este código con su teléfono para abrir la billetera digital.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'class-photo' && actor.canManageClassPhoto && (
        <section className="layout verify-layout">
          <div className="panel">
            <p className="eyebrow">Registro fotográfico · Responsable de medios</p>
            <h2>Fotografía grupal de la clase</h2>
            <p className="muted">Tomá la fotografía grupal con la cámara o seleccioná una imagen de tu dispositivo. La imagen se optimizará y quedará guardada en el servidor para estampar los recuerdos conmemorativos.</p>
            <label>
              Fotografía grupal
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => { void saveClassPhoto(event.target.files?.[0]); event.currentTarget.value = '' }}
                disabled={classPhotoWorking}
              />
            </label>
            <p className="muted">
              {classPhotoWorking
                ? 'Subiendo y procesando la imagen en el servidor…'
                : classPhotoStatus
                  ? `✓ Fotografía guardada${classPhotoSavedAt ? ` · ${formatDate(classPhotoSavedAt)}` : ''}. Ya se encuentra disponible para los recuerdos.`
                  : 'Todavía no se ha cargado una fotografía para esta jornada.'}
            </p>
          </div>
          <aside className="panel request-panel">
            {classPhotoPreview ? (
              <img className="class-photo-preview" src={classPhotoPreview} alt="Vista previa de la fotografía grupal guardada en el servidor" />
            ) : (
              <div className="class-photo-placeholder">📷</div>
            )}
            <h3>{classPhotoStatus ? 'Fotografía grupal lista' : 'Foto de la clase'}</h3>
            <p>
              {classPhotoStatus
                ? 'El docente ya puede generar el código QR conmemorativo con esta imagen.'
                : 'Al guardar la imagen, se integrará automáticamente a cada recuerdo conmemorativo personalizado.'}
            </p>
          </aside>
        </section>
      )}

      {activeTab === 'souvenir' && (
        <section className="layout verify-layout">
          <div className="panel">
            <p className="eyebrow">Recuerdo conmemorativo · Docente</p>
            <h2>Souvenir digital para la clase</h2>
            <p className="muted">Generá un código QR conmemorativo para proyectar en el aula. Cada asistente lo escaneará desde su billetera y obtendrá su recuerdo personalizado con su nombre y la foto del grupo.</p>
            <p className="muted">
              {classPhotoStatus
                ? `✓ Fotografía grupal disponible${classPhotoSavedAt ? ` · ${formatDate(classPhotoSavedAt)}` : ''}.`
                : '⚠️ Primero debés tomar y guardar la foto grupal desde la pestaña «Foto grupal».'}
            </p>
            <label>
              Título del recuerdo
              <input
                value={souvenirTitle}
                onChange={(event) => { setSouvenirTitle(event.target.value); setSouvenirSession(null) }}
                maxLength={120}
                placeholder="Ej.: Seminario de Actualización II"
              />
            </label>
            <label>
              Dedicatoria o mensaje grupal
              <textarea
                rows={3}
                value={souvenirMessage}
                onChange={(event) => { setSouvenirMessage(event.target.value); setSouvenirSession(null) }}
                maxLength={160}
                placeholder="Gracias por participar de nuestro proyecto."
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => void createSouvenirSession()}
              disabled={working || !classPhotoStatus || !souvenirTitle.trim() || !souvenirMessage.trim()}
            >
              {working && <span className="button-spinner" />}
              {working ? 'Generando código QR…' : souvenirSession ? 'Generar un nuevo código QR' : 'Generar código QR para todos'}
            </button>
            <p className="muted">
              Cada billetera registrada puede reclamar su recuerdo una sola vez. El código QR permanecerá activo por {souvenirSession ? formatDate(souvenirSession.expiresAt) : '24 horas'}.
            </p>
          </div>
          <aside className="panel request-panel">
            {souvenirSession ? (
              <>
                <button type="button" className="primary-button" onClick={() => setSouvenirQrOpen(true)}>
                  Ver código QR en pantalla completa
                </button>
                <h3>Un código QR para todo el grupo</h3>
                <p>Al escanearlo, el sistema incorpora el nombre de cada titular a su propia credencial de recuerdo.</p>
              </>
            ) : (
              <>
                <span className="qr-placeholder">✦</span>
                <h3>El código QR conmemorativo aparecerá acá</h3>
                <p>Configurá el título y la dedicatoria para habilitar la descarga del recuerdo para todos los asistentes.</p>
              </>
            )}
          </aside>
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="attendance-page">
          <div className="layout verify-layout">
            <div className="panel">
              <p className="eyebrow">Gestión docente · {actor.name}</p>
              <h2>Control de asistencia</h2>
              <p className="muted">El código QR tiene una vigencia de 1 minuto para garantizar la presencia en el aula. Cada billetera registra una única asistencia mediante firma criptográfica.</p>
              <label>
                Materia o seminario
                <input value={attendanceSubject} onChange={(event) => setAttendanceSubject(event.target.value)} />
              </label>
              {attendance?.status === 'Abierta' ? (
                <button type="button" className="secondary-button" onClick={() => void closeAttendance()}>
                  Finalizar sesión de asistencia
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={() => void openAttendance()} disabled={working}>
                  {working && <span className="button-spinner" />}
                  {working ? 'Abriendo sesión…' : 'Abrir asistencia y mostrar código QR'}
                </button>
              )}
              <button type="button" className="reset-demo-button" onClick={() => void resetDemo()} disabled={resetWorking}>
                {resetWorking ? 'Reiniciando demostración…' : 'Reiniciar demostración (estado inicial)'}
              </button>
              <div className="attendance-list">
                <h3>Asistencias registradas en esta sesión ({attendanceRecords.length})</h3>
                {attendanceRecords.map((record) => (
                  <p key={`${record.holder}-${record.recordedAt}`}>✓ {record.studentName} · {formatDate(record.recordedAt)}</p>
                ))}
                {attendance?.status === 'Abierta' && attendanceRecords.length === 0 && (
                  <p className="muted"><LoadingMark label="Esperando registros de los estudiantes…" /></p>
                )}
              </div>
            </div>

            <aside className="panel request-panel">
              {attendance?.status === 'Abierta' && qr?.value.includes(':attendance:') ? (
                <>
                  <QrDisplay value={qr.value} label={qr.label} />
                  <h3>{attendance.subject}</h3>
                  <p>{attendance.section} · Vence a las: {formatDate(attendance.expiresAt)}</p>
                </>
              ) : (
                <>
                  <span className="qr-placeholder">▦</span>
                  <h3>Sesión de asistencia</h3>
                  <p>Iniciá la sesión para proyectar el código QR dinámico que escanearán los estudiantes con su teléfono.</p>
                </>
              )}
            </aside>
          </div>

          <div className="panel roster-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Planilla institucional · {attendanceRoster?.teacherName ?? 'Marcelo Roldan'}</p>
                <h2>{attendanceRoster?.courseName ?? 'Seminario de Actualización II'}</h2>
              </div>
              <div className="roster-actions">
                <span className="live-badge"><i />Actualización en vivo · 3 s</span>
                <button
                  type="button"
                  className="secondary-button download-button"
                  onClick={() => void downloadAttendance()}
                  disabled={attendanceDownloadWorking}
                >
                  {attendanceDownloadWorking ? 'Generando archivo…' : 'Descargar planilla (CSV / Excel)'}
                </button>
              </div>
            </div>
            <p className="muted">La planilla registra automáticamente las asistencias al recibir cada comprobante.</p>
            {attendanceDownloadError && <p className="consent-error" role="alert">No se pudo descargar la planilla: {attendanceDownloadError}</p>}
            <div className="roster-scroll">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Estudiante</th>
                    {attendanceRoster?.dates.map((date) => <th key={date.key}>{date.label}</th>)}
                    {!attendanceRoster?.dates.length && <th>Sin clases registradas</th>}
                  </tr>
                </thead>
                <tbody>
                  {(attendanceRoster?.students ?? demoStudents.map((student): AttendanceRoster['students'][number] => ({ ...student, attendance: {} }))).map((student) => (
                    <tr key={student.id}>
                      <th scope="row">{student.fullName}</th>
                      {attendanceRoster?.dates.map((date) => {
                        const state = student.attendance[date.key] ?? 'A'
                        return <td key={date.key} className={state === 'P' ? 'present-cell' : 'absent-cell'}>{state}</td>
                      })}
                      {!attendanceRoster?.dates.length && <td className="absent-cell">A</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="roster-legend">
              <span className="legend-chip legend-present">P · Presente</span>
              <span className="legend-chip legend-absent">A · Ausente</span>
            </div>
          </div>
        </section>
      )}

      {pendingVerify && (
        <div className="consent-backdrop">
          <section className="consent-card" role="dialog" aria-modal="true" aria-label="Solicitud de presentación de credencial">
            <p className="eyebrow">Solicitud de presentación</p>
            <h2>Elegí qué datos deseás compartir</h2>
            <p>
              Una entidad verificadora solicita tu credencial de: <strong>{pendingVerify.kind}</strong>
              {pendingVerify.subject && <> en la materia <strong>{pendingVerify.subject}</strong></>}
              {pendingVerify.minimumGrade != null && <> con calificación mínima de <strong>{pendingVerify.minimumGrade}</strong></>}
            </p>
            {pendingVerify.requestNote && <p className="muted">Motivo informado: «{pendingVerify.requestNote}»</p>}
            {matchingVerificationCredentials.map((credential) => {
              const choices: [string, string][] = [
                ['nombreEstudiante', 'Nombre y apellido'],
                ['matricula', 'Número de matrícula'],
                ['titulo', 'Título de la credencial'],
                ['detalle', 'Detalle académico'],
                ['materia', 'Materia'],
                ['nota', 'Calificación numérica exacta'],
              ]
              if (pendingVerify.minimumGrade != null) {
                choices.push([`cumpleNotaMinima${pendingVerify.minimumGrade}`, `¿Cumple con la calificación mínima exigida (${pendingVerify.minimumGrade})?`])
              }
              return (
                <div className="consent-credential" key={credential.id}>
                  <span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span>
                  <div>
                    <strong>{credential.claims.titulo}</strong>
                    <p>
                      {choices
                        .filter(([key]) => key in credential.claims || key.startsWith('cumpleNotaMinima'))
                        .map(([key, label]) => (
                          <label className="disclosure-choice" key={key}>
                            <input
                              type="checkbox"
                              checked={Boolean(shareFields[key])}
                              disabled={Boolean(pendingVerify.subject && key === 'materia') || (pendingVerify.minimumGrade != null && key.startsWith('cumpleNotaMinima'))}
                              onChange={(event) => setShareFields((current) => ({ ...current, [key]: event.target.checked }))}
                            />
                            {label}
                            {(pendingVerify.requiredClaims ?? []).includes(key) && <small> · Solicitado por el verificador</small>}
                            {key.startsWith('cumpleNotaMinima') && <small> · {Number(credential.claims.nota) >= pendingVerify.minimumGrade! ? 'Sí cumple' : 'No cumple'}</small>}
                          </label>
                        ))}
                    </p>
                  </div>
                </div>
              )
            })}
            {!matchingVerificationCredentials.length && (
              <p className="scanner-error" role="alert">No disponés de una credencial activa en esta billetera que cumpla con los requisitos solicitados.</p>
            )}
            {verifyShareError && <p className="consent-error" role="alert">No se pudo presentar la credencial: {verifyShareError}</p>}
            <div className="consent-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => { setPendingVerify(null); setNotice('Cancelaste la presentación de tu credencial.') }}
              >
                Rechazar solicitud
              </button>
              {matchingVerificationCredentials.map((credential) => (
                <button
                  type="button"
                  className="primary-button"
                  key={credential.id}
                  disabled={working}
                  onClick={() => void shareCredential(credential)}
                >
                  {working ? <><span className="button-spinner" /> Enviando…</> : 'Autorizar y compartir'}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}


      {pendingAttendance && (
        <div className="consent-backdrop">
          <section className="consent-card" role="dialog" aria-modal="true" aria-label="Confirmar asistencia presencial">
            <p className="eyebrow">Confirmar asistencia presencial</p>
            <h2>{pendingAttendance.subject}</h2>
            <p>{pendingAttendance.section} · Sesión presencial activa del docente</p>
            <p>
              Se acreditará la presencia de <strong>{savedStudent?.fullName ?? 'un estudiante sin identificar'}</strong> mediante una prueba criptográfica segura de esta billetera. Por privacidad, no se comparten notas ni otras credenciales académicas.
            </p>
            {attendanceError && <p className="consent-error" role="alert">No se pudo registrar la presencia: {attendanceError}</p>}
            <div className="consent-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => { setPendingAttendance(null); setAttendanceError(''); setNotice('Cancelaste el registro de asistencia.') }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={working}
                onClick={() => void confirmAttendance()}
              >
                {working ? <><span className="button-spinner" /> Registrando…</> : 'Confirmar mi presencia'}
              </button>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'souvenir' && souvenirQrOpen && souvenirSession && (
        <div className="souvenir-qr-backdrop">
          <section className="souvenir-qr-screen" role="dialog" aria-modal="true" aria-label="Código QR conmemorativo para el grupo">
            <button type="button" className="souvenir-qr-close" onClick={() => setSouvenirQrOpen(false)}>
              Cerrar ventana ×
            </button>

            {/* Glowing nebulas */}
            <div className="souvenir-qr-glow souvenir-qr-glow-one" />
            <div className="souvenir-qr-glow souvenir-qr-glow-two" />
            <div className="souvenir-qr-glow souvenir-qr-glow-three" />

            {/* Celebratory Fireworks */}
            <div className="qr-firework fw-top-left" />
            <div className="qr-firework fw-top-right" />
            <div className="qr-firework fw-bottom-left" />
            <div className="qr-firework fw-bottom-right" />
            <div className="qr-firework fw-center-left" />
            <div className="qr-firework fw-center-right" />

            {/* Floating Sparkles */}
            <span className="qr-sparkle sp-1" aria-hidden="true">✦</span>
            <span className="qr-sparkle sp-2" aria-hidden="true">✨</span>
            <span className="qr-sparkle sp-3" aria-hidden="true">★</span>
            <span className="qr-sparkle sp-4" aria-hidden="true">✧</span>
            <span className="qr-sparkle sp-5" aria-hidden="true">✦</span>
            <span className="qr-sparkle sp-6" aria-hidden="true">✨</span>
            <span className="qr-sparkle sp-7" aria-hidden="true">★</span>
            <span className="qr-sparkle sp-8" aria-hidden="true">✧</span>

            {/* Centered Floating Content */}
            <div className="souvenir-qr-content">
              <div className="souvenir-qr-mark">✦</div>
              <p className="eyebrow" style={{ color: '#ffe49e', letterSpacing: '0.15em' }}>UNLaR · SEMINARIO DE ACTUALIZACIÓN II</p>
              <h2>Un recuerdo de nuestra jornada</h2>
              <p className="souvenir-subtitle">Un mismo código QR, un recuerdo único y personalizado para cada participante.</p>

              <div className="souvenir-floating-card">
                <SouvenirQrDisplay value={qrPayload('souvenir', souvenirSession.code)} />
              </div>

              <small className="souvenir-expiry-badge">
                <span>⏱️</span> Válido hasta el {formatDate(souvenirSession.expiresAt)}
              </small>
            </div>
          </section>
        </div>
      )}
      {souvenirPreview && (
        <div className="souvenir-backdrop">
          <section className="souvenir-card" role="dialog" aria-modal="true" aria-label={souvenirPreview.name ? 'Tu recuerdo personalizado' : 'Recuerdo para compartir con el grupo'}>
            <button type="button" className="souvenir-close" onClick={() => setSouvenirPreview(null)} aria-label="Cerrar">×</button>
            <div className="souvenir-fireworks fireworks-one" />
            <div className="souvenir-fireworks fireworks-two" />
            <div className="souvenir-heading">
              <span>✦</span>
              <h2>¡Tu recuerdo conmemorativo está listo!</h2>
              <p>{souvenirPreview.name ? `Personalizado para ${souvenirPreview.name}` : 'Sin nombre, listo para compartir con todo el grupo'}</p>
            </div>
            <img className="souvenir-image" src={souvenirPreview.image} alt={souvenirPreview.name ? `Recuerdo conmemorativo personalizado para ${souvenirPreview.name}` : 'Recuerdo conmemorativo del grupo'} />
            <div className="souvenir-actions">
              <button type="button" className="primary-button" onClick={downloadSouvenir}>
                Descargar imagen
              </button>
              <button type="button" className="secondary-button" onClick={() => void shareSouvenir()}>
                Compartir
              </button>
            </div>
            <small>Guardalo en tu galería o compartilo directamente en tus redes y apps de mensajería.</small>
          </section>
        </div>
      )}
      {scannerOpen && <QrScanner onScan={handleScan} onClose={() => setScannerOpen(false)} />}
      {(actor?.role === 'student' || actor?.role === 'photographer') && <button type="button" className="wallet-scan-fab" onClick={() => setScannerOpen(true)} aria-label="Escanear código QR" title="Escanear código QR">
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M4 11V5h6M22 5h6v6M28 21v6h-6M10 27H4v-6" />
          <path d="M12 12h3v3h-3zM19 12h3v3h-3zM12 19h3v3h-3zM19 19h2v2h-2zM23 23h4v4h-4zM5 5h5v5H5zM22 5h5v5h-5zM5 22h5v5H5z" />
        </svg>
        <span>Escanear</span>
      </button>}
      {actor?.role === 'student' && pendingPrizeRequests[0] && (() => {
        const request = pendingPrizeRequests[0]
        return <div className="raffle-prize-modal-backdrop">
          <section className="raffle-prize-modal" role="dialog" aria-modal="true" aria-labelledby="raffle-prize-title">
            <div className="raffle-prize-modal-icon" aria-hidden="true">🎁</div>
            <p className="eyebrow">{request.source === 'manual' ? '¡Felicitaciones!' : `¡Felicitaciones! · ${request.place}° puesto`}</p>
            <h2 id="raffle-prize-title">Ganaste un regalo digital</h2>
            <p>Ingresá tu email para que podamos enviártelo. Guardaremos esta dirección para coordinar la entrega del premio.</p>
            <label>Email para recibir el regalo<input type="email" autoComplete="email" autoFocus value={prizeEmailDrafts[request.id] ?? ''} onChange={(event) => setPrizeEmailDrafts((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="tu@email.com" /></label>
            <button className="primary-button" type="button" onClick={() => void submitPrizeEmail(request.id)} disabled={!(prizeEmailDrafts[request.id] ?? '').trim()}>Guardar email y continuar</button>
            <small>El aviso permanecerá aquí hasta que envíes el email.</small>
          </section>
        </div>
      })()}
      <footer>Universidad Nacional de La Rioja · Billetera Universitaria Digital</footer>
    </main>
  )
}

export default App
