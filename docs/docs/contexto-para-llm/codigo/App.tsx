import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'
import { api } from './lib/api'
import { signWalletProof, verifyCredential, type SignedCredential } from './lib/credentialCrypto'
import { listWalletCredentials, storeWalletCredential, updateWalletCredentialStatus, type WalletCredential } from './lib/walletStore'

type CredentialKind = 'Regularidad' | 'Materia aprobada' | 'Nota de materia' | 'Biblioteca' | 'Gimnasio'
type TabId = 'wallet' | 'issuer' | 'verify' | 'attendance'
type IssuedCredential = { id: string; kind: CredentialKind; title: string; detail: string; status: string; issuedAt: string; expiresAt: string | null; studentName?: string; enrollmentNumber?: string }
type DeliveryResponse = { credential: SignedCredential; delivery: { code: string; expiresAt: string } }
type VerifyRequest = { code: string; kind: CredentialKind; expiresAt: string }
type AttendanceSession = { id: string; subject: string; section: string; expiresAt: string; status: string }
type DemoStudent = { id: string; fullName: string; enrollmentNumber: string; identityLocked: boolean; walletLinked: boolean }
type DemoActor = { id: string; role: 'student' | 'teacher' | 'institutional'; name: string; scope?: 'academic' | 'library' | 'gym'; studentId?: string }
type AttendanceRoster = {
  teacherName: string
  courseName: string
  dates: { key: string; label: string }[]
  students: { id: string; fullName: string; attendance: Record<string, 'P' | 'A'> }[]
}

const kinds: CredentialKind[] = ['Regularidad', 'Materia aprobada', 'Nota de materia', 'Biblioteca', 'Gimnasio']
const tabs: { id: TabId; label: string }[] = [
  { id: 'wallet', label: 'Mi billetera' }, { id: 'issuer', label: 'Emisor' }, { id: 'verify', label: 'Verificar' }, { id: 'attendance', label: 'Asistencia' },
]
const demoAccounts = [
  { id: 'student-mariano', label: 'Estudiante · Mariano Arias Simone', role: 'student' },
  { id: 'student-nahuel', label: 'Estudiante · Peralta Herrera Nahuel', role: 'student' },
  { id: 'teacher-marcelo', label: 'Profesor · Marcelo Roldan', role: 'teacher' },
  { id: 'admin-academic', label: 'Institución · Administración académica', role: 'institutional' },
  { id: 'admin-library', label: 'Institución · Biblioteca', role: 'institutional' },
  { id: 'admin-gym', label: 'Institución · Gimnasio', role: 'institutional' },
]
const iconFor = (kind: CredentialKind) => ({ 'Materia aprobada': '✓', 'Nota de materia': '▣', Regularidad: '◇', Biblioteca: '▤', Gimnasio: '◌' }[kind])
const qrPayload = (kind: string, code: string) => `unlar-wallet:${kind}:${code}`
const formatDate = (value: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function QrDisplay({ value, label }: { value: string; label: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { void QRCode.toDataURL(value, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#113d60', light: '#ffffff' } }).then(setImage) }, [value])
  return <div className="qr-display">{image ? <img src={image} alt={label} /> : <span className="qr-placeholder">▦</span>}<small>{label}</small></div>
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
  const [actor, setActor] = useState<DemoActor | null>(null)
  const [loginAccount, setLoginAccount] = useState(demoAccounts[0].id)
  const [loginPassword, setLoginPassword] = useState('demo2026')
  const [loginError, setLoginError] = useState('')
  const [loginWorking, setLoginWorking] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('wallet')
  const [credentials, setCredentials] = useState<WalletCredential[]>([])
  const [serverCredentials, setServerCredentials] = useState<IssuedCredential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [notice, setNotice] = useState('Tu billetera está lista. Escaneá un QR para recibir o presentar credenciales.')
  const [credentialKind, setCredentialKind] = useState<CredentialKind>('Materia aprobada')
  const [subject, setSubject] = useState('Bases de Datos')
  const [grade, setGrade] = useState('')
  const [attendanceSubject, setAttendanceSubject] = useState('Seminario de Actualización II')
  const [requestedKind, setRequestedKind] = useState<CredentialKind>('Materia aprobada')
  const [qr, setQr] = useState<{ value: string; label: string; expiresAt: string } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [pendingVerify, setPendingVerify] = useState<VerifyRequest | null>(null)
  const [pendingAttendance, setPendingAttendance] = useState<AttendanceSession | null>(null)
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<{ holder: string; studentId: string; studentName: string; recordedAt: string }[]>([])
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [recipientStudentId, setRecipientStudentId] = useState('mariano-arias-simone')
  const [demoStudents, setDemoStudents] = useState<DemoStudent[]>([])
  const [attendanceRoster, setAttendanceRoster] = useState<AttendanceRoster | null>(null)
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; title: string; kind: string; verifiedAt: string } | null>(null)
  const selectedCredential = useMemo(() => credentials.find((credential) => credential.id === selectedCredentialId) ?? credentials[0], [credentials, selectedCredentialId])
  const savedStudent = demoStudents.find((student) => student.id === studentId)
  const allowedTabs = tabs.filter((tab) => actor?.role === 'student' ? tab.id === 'wallet' : actor?.role === 'teacher' ? ['verify', 'attendance'].includes(tab.id) : tab.id === 'issuer')
  const allowedKinds: CredentialKind[] = actor?.scope === 'library' ? ['Biblioteca'] : actor?.scope === 'gym' ? ['Gimnasio'] : ['Regularidad', 'Materia aprobada', 'Nota de materia']

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
      await Promise.all(walletItems.map((credential) => {
        const status = statuses.get(credential.id)
        return status === 'Activa' || status === 'Revocada'
          ? updateWalletCredentialStatus(credential.id, status)
          : Promise.resolve()
      }))
      walletItems = await listWalletCredentials()
    } catch {
      // Si el emisor está desconectado, se conserva la última copia local.
    }
    setCredentials(walletItems)
    if (walletItems.length) setSelectedCredentialId((current) => walletItems.some((item) => item.id === current) ? current : walletItems[0].id)
  }, [])

  const refreshIssuer = useCallback(async () => {
    const rows = await api<IssuedCredential[]>('/api/credentials')
    setServerCredentials(rows)
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

  // La carga inicial sincroniza el estado de React con IndexedDB y la API.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    const token = localStorage.getItem('unlar-demo-token')
    const account = localStorage.getItem('unlar-demo-account')
    if (!token || !account) return
    void api<{ actor: DemoActor }>('/api/demo/me').then(({ actor: current }) => {
      setActor(current)
      setStudentId(current.studentId ?? '')
      setStudentName(current.role === 'student' ? current.name : '')
      setActiveTab(current.role === 'student' ? 'wallet' : current.role === 'teacher' ? 'attendance' : 'issuer')
    }).catch(() => logout())
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
    if (credentialKind === 'Nota de materia' && (!grade || !Number.isFinite(parsedGrade) || parsedGrade < 1 || parsedGrade > 10)) {
      setNotice('Ingresá una nota entre 1 y 10 para emitir esta credencial.')
      return
    }
    setWorking(true)
    try {
      const title = credentialKind === 'Regularidad' ? 'Alumno regular' : credentialKind === 'Biblioteca' ? 'Acceso a biblioteca' : credentialKind === 'Gimnasio' ? 'Acceso al gimnasio' : subject.trim() || 'Materia sin especificar'
      const detail = credentialKind === 'Materia aprobada' ? 'Condición: aprobada' : credentialKind === 'Nota de materia' ? `Nota: ${parsedGrade}` : credentialKind === 'Regularidad' ? 'Ingeniería en Sistemas de Información' : 'Membresía activa'
      const expiresAt = ['Materia aprobada', 'Nota de materia'].includes(credentialKind) ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
      const response = await api<DeliveryResponse>('/api/credentials', { method: 'POST', body: JSON.stringify({ kind: credentialKind, title, detail, ...(credentialKind === 'Nota de materia' ? { grade: parsedGrade } : {}), studentId: recipientStudentId, ...(expiresAt ? { expiresAt } : {}) }) })
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

  const createPresentationRequest = async () => {
    setWorking(true)
    try {
      const request = await api<VerifyRequest>('/api/presentation-requests', { method: 'POST', body: JSON.stringify({ kind: requestedKind, minutes: 5 }) })
      setQr({ value: qrPayload('verify', request.code), label: `Solicitud de ${request.kind} · un solo uso`, expiresAt: request.expiresAt })
      setVerifyResult(null)
      setNotice('Solicitud creada. En el otro celular abrí Mi billetera y escaneá el QR.')
      window.setTimeout(() => { if (qr?.value.includes(request.code)) setNotice('La solicitud venció; generá un QR nuevo.') }, 120_000)
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

  const handleScan = useCallback(async (value: string) => {
    setScannerOpen(false)
    const match = /^unlar-wallet:(delivery|verify|attendance):([A-Za-z0-9_-]+)$/.exec(value.trim())
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
      } else if (type === 'verify') {
        const request = await api<VerifyRequest>(`/api/presentation-requests/${code}`)
        setPendingVerify(request)
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
  }, [refreshWallet])

  const shareCredential = async (credential: WalletCredential) => {
    if (!pendingVerify) return
    setWorking(true)
    try {
      const proof = await signWalletProof(`${pendingVerify.code}.${credential.id}.${credential.holder}`)
      await api(`/api/presentation-requests/${pendingVerify.code}/respond`, { method: 'POST', body: JSON.stringify({ credential, ...proof }) })
      setPendingVerify(null)
      setNotice(`Presentación enviada al verificador: ${credential.claims.titulo}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo presentar la credencial.'
      if (/revocada/i.test(message)) {
        await refreshWallet()
        setPendingVerify(null)
        setNotice(`El emisor revocó “${credential.claims.titulo}”. Se actualizó su estado y no se compartió.`)
      } else setNotice(message)
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
    setWorking(true)
    try {
      const proof = await signWalletProof(`attendance.${pendingAttendance.id}.${studentId}`)
      await api(`/api/attendance/sessions/${pendingAttendance.id}/check-in`, { method: 'POST', body: JSON.stringify({ studentId, ...proof }) })
      setPendingAttendance(null)
      setNotice(`Asistencia registrada para ${pendingAttendance.subject}.`)
      await refreshAttendanceRoster()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo registrar la asistencia.') }
    finally { setWorking(false) }
  }

  const pollVerification = async () => {
    if (!qr || !qr.value.includes(':verify:')) return
    const code = qr.value.split(':').at(-1)
    try {
      const response = await api<{ status: string; result?: { valid: boolean; title: string; kind: string; verifiedAt: string } }>(`/api/presentation-requests/${code}/result`)
      if (response.result) { setVerifyResult(response.result); setNotice(`Credencial válida: ${response.result.title} · firma, vigencia y estado verificados.`) }
      else setNotice('Todavía no se recibió una presentación. El QR sigue activo.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo consultar el resultado.') }
  }

  const closeAttendance = async () => {
    if (!attendance) return
    try {
      await api(`/api/attendance/sessions/${attendance.id}/close`, { method: 'POST' })
      setAttendance({ ...attendance, status: 'Cerrada' })
      setQr(null)
      setNotice(`Asistencia cerrada. Registros recibidos: ${attendanceRecords.length}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo cerrar la asistencia.') }
  }

  if (!actor) return <main className="login-page"><header className="topbar"><div className="brand"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja — UNLaR" /></div></header><section className="login-card"><p className="eyebrow">Acceso institucional</p><h1>Ingresar</h1><p className="muted">Seleccioná el perfil con el que querés continuar. Cada perfil habilita las funciones correspondientes.</p><label>Perfil<select value={loginAccount} onChange={(event) => setLoginAccount(event.target.value)}>{demoAccounts.map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}</select></label><label>Contraseña<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /></label>{loginError && <p className="scanner-error">{loginError}</p>}<button type="button" className="primary-button" onClick={() => void login()} disabled={loginWorking}>{loginWorking ? 'Ingresando…' : 'Ingresar'}</button></section><footer>Universidad Nacional de La Rioja · Credenciales digitales</footer></main>

  return (
    <main>
      <header className="topbar"><div className="brand"><img className="brand-logo" src="/unlar-logo.png" alt="Universidad Nacional de La Rioja — UNLaR" /></div><div className="session-badge"><span><strong>{actor.name}</strong><small>{actor.role === 'student' ? 'Estudiante' : actor.role === 'teacher' ? 'Profesor · permisos de asistencia' : `Institución · ${actor.scope === 'academic' ? 'área académica' : actor.scope === 'library' ? 'Biblioteca' : 'Gimnasio'}`}</small></span><button type="button" className="secondary-button" onClick={logout}>Cambiar usuario</button></div></header>
      <section className="hero"><div><p className="eyebrow">Billetera universitaria verificable</p><h1>Credenciales que compartís con control.</h1><p className="lead">Antecedentes académicos, servicios institucionales y asistencia en una misma billetera.</p></div><div className="trust-card"><span className="trust-icon">⌁</span><div><strong>Privacidad por diseño</strong><p>Compartí solo el dato que te solicitan.</p></div></div></section>
      <nav className="tabs" aria-label="Módulos">{allowedTabs.map((tab) => <button className={activeTab === tab.id ? 'tab active' : 'tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
      <p className="notice" role="status">{working ? 'Procesando… ' : ''}{notice}</p>

      {activeTab === 'wallet' && <section className="layout wallet-layout">
        <div><div className="section-heading"><div><p className="eyebrow">Estudiante</p><h2>Mis credenciales</h2></div><span className="count">{credentials.length}</span></div>
          <div className="student-profile">
            <p className="eyebrow">Identidad del titular</p>
            <label>Nombre y apellido<input value={savedStudent?.fullName ?? actor.name} readOnly /></label>
            <label>Matrícula<input value={savedStudent?.enrollmentNumber ?? 'Cargando…'} readOnly /></label>
            <button type="button" className="secondary-button" onClick={() => void saveStudentProfile()} disabled={working || !savedStudent || savedStudent.walletLinked}>{!savedStudent ? 'Cargando perfil…' : savedStudent.walletLinked ? 'Billetera vinculada' : 'Vincular esta billetera'}</button>
            <p className="muted">El nombre y la matrícula se vinculan a esta cuenta. La firma protege estos datos y los asocia a la billetera.</p>
            <small className="muted">La identidad del titular se incluye en cada credencial emitida.</small>
          </div>
          <div className="wallet-actions"><button type="button" className="primary-button" onClick={() => setScannerOpen(true)}>Escanear QR con la cámara</button><span className="muted">Las credenciales se guardan en este teléfono.</span></div>
          {credentials.length ? <div className="credential-list">{credentials.map((credential) => <button type="button" className={selectedCredentialId === credential.id ? 'credential-card selected' : 'credential-card'} onClick={() => setSelectedCredentialId(credential.id)} key={credential.id}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><span className="credential-copy"><small>{credential.type}</small><strong>{credential.claims.titulo}</strong><span>{credential.claims.detalle}</span></span><span className={credential.localStatus === 'Activa' ? 'status good' : 'status bad'}>{credential.localStatus}</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h3>Tu billetera está vacía</h3><p>Desde el panel Emisor, creá una credencial y escaneá su QR para recibirla.</p></div>}
        </div>
        <aside className="detail-panel">{selectedCredential ? <><p className="eyebrow">{selectedCredential.type}</p><h2>{selectedCredential.claims.titulo}</h2><p className="detail-copy">{selectedCredential.claims.detalle}</p><dl><div><dt>Emisor</dt><dd>Universidad Nacional de La Rioja</dd></div><div><dt>Emitida</dt><dd>{formatDate(selectedCredential.issuedAt)}</dd></div><div><dt>Vigencia</dt><dd>{selectedCredential.expiresAt ? formatDate(selectedCredential.expiresAt) : 'Sin vencimiento'}</dd></div><div><dt>Titular firmado</dt><dd>{selectedCredential.claims.nombreEstudiante ?? 'Credencial anterior al perfil actual'}</dd></div>{selectedCredential.claims.matricula && <div><dt>Matrícula</dt><dd>{selectedCredential.claims.matricula}</dd></div>}<div><dt>Firma</dt><dd>{selectedCredential.proof.algorithm} válida</dd></div></dl></> : <><p className="eyebrow">Tu espacio personal</p><h2>Guardá credenciales emitidas por la universidad</h2><p className="detail-copy">Cada QR de entrega es de un solo uso y vence a los diez minutos.</p></>}</aside>
      </section>}

      {activeTab === 'issuer' && <section className="layout issuer-layout"><div className="panel form-panel"><p className="eyebrow">Panel institucional · {actor.scope === 'academic' ? 'Área académica' : actor.scope === 'library' ? 'Biblioteca' : 'Gimnasio'}</p><h2>Emitir una credencial</h2><p className="muted">El servidor firma con Ed25519. Este usuario solo puede emitir dentro de su área; la credencial incluye la identidad del estudiante.</p><div className="form-grid"><label>Estudiante destinatario<select value={recipientStudentId} onChange={(event) => setRecipientStudentId(event.target.value)}>{demoStudents.map((student) => <option value={student.id} key={student.id}>{student.fullName} · {student.enrollmentNumber}</option>)}</select></label><label>Tipo de credencial<select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>{allowedKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>{credentialKind === 'Biblioteca' || credentialKind === 'Gimnasio' ? 'Servicio' : 'Materia'}<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>{credentialKind === 'Nota de materia' && <label>Nota (escala de 1 a 10)<input type="number" inputMode="decimal" min="1" max="10" step="0.01" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="Ej.: 8.50" required /></label>}</div><button type="button" className="primary-button" onClick={() => void issueCredential()} disabled={working || (credentialKind === 'Nota de materia' && !grade)}>Emitir y generar QR</button></div>
        <aside className="panel request-panel">{qr?.value.includes(':delivery:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Entrega de credencial</h3><p>Vence: {formatDate(qr.expiresAt)}</p><button type="button" className="secondary-button" onClick={() => void refreshIssuer()}>Actualizar emisiones</button></> : <><span className="qr-placeholder">▦</span><h3>Entrega por QR</h3><p>El estudiante escanea el QR con su cámara y recibe la credencial firmada en su billetera local.</p></>}</aside>
        <div className="panel issuer-records"><div className="section-heading"><div><p className="eyebrow">Registro del emisor</p><h2>Credenciales emitidas</h2></div><button type="button" className="secondary-button" onClick={() => void refreshIssuer()}>Actualizar</button></div>{serverCredentials.length ? <div className="credential-list">{serverCredentials.map((credential) => <div className="credential-card record-card" key={credential.id}><span className="credential-icon">{iconFor(credential.kind)}</span><span className="credential-copy"><small>{credential.kind}</small><strong>{credential.title}</strong><span>{credential.detail}</span>{credential.studentName && <small>Titular: {credential.studentName} · Matrícula {credential.enrollmentNumber}</small>}</span><span className={credential.status === 'Activa' ? 'status good' : 'status bad'}>{credential.status}</span>{credential.status === 'Activa' && <button type="button" className="danger-link" onClick={() => void revokeCredential(credential)}>Revocar</button>}</div>)}</div> : <p className="muted">Todavía no se emitieron credenciales.</p>}</div>
      </section>}

      {activeTab === 'verify' && <section className="layout verify-layout"><div className="panel"><p className="eyebrow">Verificador</p><h2>Solicitar evidencia</h2><p className="muted">El QR vence en cinco minutos y se acepta una única respuesta.</p><label>Requisito<select value={requestedKind} onChange={(event) => setRequestedKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><button type="button" className="primary-button" onClick={() => void createPresentationRequest()} disabled={working}>Generar QR de solicitud</button>{verifyResult && <div className="verification-result"><span className="result-check">✓</span><div><strong>Credencial válida</strong><p>{verifyResult.title} · {verifyResult.kind}</p><small>Firma, vigencia, revocación y posesión verificadas</small></div></div>}</div><aside className="panel request-panel">{qr?.value.includes(':verify:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Solicitud temporal</h3><p>Vence: {formatDate(qr.expiresAt)}</p><button type="button" className="secondary-button" onClick={() => void pollVerification()}>Consultar resultado</button></> : <><span className="qr-placeholder">▦</span><h3>Presentación con consentimiento</h3><p>El estudiante ve qué se solicita y confirma antes de enviar su credencial.</p></>}</aside></section>}

      {activeTab === 'attendance' && <section className="attendance-page">
        <div className="layout verify-layout"><div className="panel"><p className="eyebrow">Profesor · {actor.name}</p><h2>Asistencia de clase</h2><p className="muted">El QR de asistencia vence en un minuto. Cada billetera vinculada puede registrar una sola presencia por sesión.</p><label>Materia<input value={attendanceSubject} onChange={(event) => setAttendanceSubject(event.target.value)} /></label>{attendance?.status === 'Abierta' ? <button type="button" className="secondary-button" onClick={() => void closeAttendance()}>Cerrar sesión de asistencia</button> : <button type="button" className="primary-button" onClick={() => void openAttendance()} disabled={working}>Abrir asistencia y mostrar QR</button>}<div className="attendance-list"><h3>Presentes en esta sesión ({attendanceRecords.length})</h3>{attendanceRecords.map((record) => <p key={`${record.holder}-${record.recordedAt}`}>✓ {record.studentName} · {formatDate(record.recordedAt)}</p>)}{attendance?.status === 'Abierta' && attendanceRecords.length === 0 && <p className="muted">Esperando registros desde las billeteras.</p>}</div></div><aside className="panel request-panel">{attendance?.status === 'Abierta' && qr?.value.includes(':attendance:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>{attendance.subject}</h3><p>{attendance.section} · vence: {formatDate(attendance.expiresAt)}</p></> : <><span className="qr-placeholder">▦</span><h3>Asistencia temporal</h3><p>Abrí una sesión para generar el QR que escanearán los estudiantes.</p></>}</aside></div>
        <div className="panel roster-panel"><div className="section-heading"><div><p className="eyebrow">Planilla local · {attendanceRoster?.teacherName ?? 'Marcelo Roldan'}</p><h2>{attendanceRoster?.courseName ?? 'Seminario de Actualización II'}</h2></div><div className="roster-actions"><span className="live-badge"><i />Actualización en vivo · 3 s</span><a className="secondary-button download-button" href="/api/attendance/export.csv" download="planilla-asistencia.csv">Descargar para Excel o Numbers</a></div></div><p className="muted">La asistencia se actualiza al registrar una presencia.</p><div className="roster-scroll"><table className="roster-table"><thead><tr><th>Estudiante</th>{attendanceRoster?.dates.map((date) => <th key={date.key}>{date.label}</th>)}{!attendanceRoster?.dates.length && <th>Sin clases registradas</th>}</tr></thead><tbody>{(attendanceRoster?.students ?? demoStudents.map((student): AttendanceRoster['students'][number] => ({ ...student, attendance: {} }))).map((student) => <tr key={student.id}><th scope="row">{student.fullName}</th>{attendanceRoster?.dates.map((date) => { const state = student.attendance[date.key] ?? 'A'; return <td key={date.key} className={state === 'P' ? 'present-cell' : 'absent-cell'}>{state}</td> })}{!attendanceRoster?.dates.length && <td className="absent-cell">A</td>}</tr>)}</tbody></table></div><div className="roster-legend"><span className="legend-chip legend-present">P · Presente</span><span className="legend-chip legend-absent">A · Ausente</span></div></div>
      </section>}

      {pendingVerify && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Solicitud del verificador</p><h2>¿Compartir esta credencial?</h2><p>El verificador solicita: <strong>{pendingVerify.kind}</strong></p>{credentials.filter((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa').map((credential) => <div className="consent-credential" key={credential.id}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><div><strong>{credential.claims.titulo}</strong><p>{credential.claims.detalle}</p><small>Se comparte solo esta credencial</small></div></div>)}{!credentials.some((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa') && <p className="scanner-error">No tenés una credencial activa de este tipo.</p>}<div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingVerify(null); setNotice('Rechazaste compartir la credencial.') }}>Rechazar</button>{credentials.filter((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa').map((credential) => <button type="button" className="primary-button" key={credential.id} disabled={working} onClick={() => void shareCredential(credential)}>Confirmar y compartir</button>)}</div></section></div>}
      {pendingAttendance && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Confirmar asistencia</p><h2>{pendingAttendance.subject}</h2><p>{pendingAttendance.section} · sesión temporal del profesor</p><p>Se registrará la presencia de <strong>{savedStudent?.fullName ?? 'un estudiante sin identificar'}</strong> usando una prueba criptográfica de esta billetera. No se comparten notas ni otras credenciales.</p><div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingAttendance(null); setNotice('Cancelaste el registro de asistencia.') }}>Cancelar</button><button type="button" className="primary-button" disabled={working} onClick={() => void confirmAttendance()}>Confirmar presencia</button></div></section></div>}
      {scannerOpen && <QrScanner onScan={handleScan} onClose={() => setScannerOpen(false)} />}
      <footer>Universidad Nacional de La Rioja · Credenciales digitales</footer>
    </main>
  )
}

export default App
