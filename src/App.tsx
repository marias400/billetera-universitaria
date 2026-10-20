import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'
import { api } from './lib/api'
import { signWalletProof, verifyCredential, type SignedCredential } from './lib/credentialCrypto'
import { listWalletCredentials, storeWalletCredential, type WalletCredential } from './lib/walletStore'

type CredentialKind = 'Regularidad' | 'Materia aprobada' | 'Nota de materia' | 'Biblioteca' | 'Gimnasio'
type TabId = 'wallet' | 'issuer' | 'verify' | 'attendance'
type IssuedCredential = { id: string; kind: CredentialKind; title: string; detail: string; status: string; issuedAt: string; expiresAt: string | null }
type DeliveryResponse = { credential: SignedCredential; delivery: { code: string; expiresAt: string } }
type VerifyRequest = { code: string; kind: CredentialKind; expiresAt: string }
type AttendanceSession = { id: string; subject: string; section: string; expiresAt: string; status: string }

const kinds: CredentialKind[] = ['Regularidad', 'Materia aprobada', 'Nota de materia', 'Biblioteca', 'Gimnasio']
const tabs: { id: TabId; label: string }[] = [
  { id: 'wallet', label: 'Mi billetera' }, { id: 'issuer', label: 'Emisor' }, { id: 'verify', label: 'Verificar' }, { id: 'attendance', label: 'Asistencia' },
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
    ? 'La cámara requiere HTTPS. Abrí la demo por el enlace seguro para escanear desde Android.'
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
  const [activeTab, setActiveTab] = useState<TabId>('wallet')
  const [credentials, setCredentials] = useState<WalletCredential[]>([])
  const [serverCredentials, setServerCredentials] = useState<IssuedCredential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [notice, setNotice] = useState('Billetera de prueba lista. Escaneá un QR para recibir o presentar credenciales.')
  const [credentialKind, setCredentialKind] = useState<CredentialKind>('Materia aprobada')
  const [subject, setSubject] = useState('Bases de Datos')
  const [requestedKind, setRequestedKind] = useState<CredentialKind>('Materia aprobada')
  const [qr, setQr] = useState<{ value: string; label: string; expiresAt: string } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [pendingVerify, setPendingVerify] = useState<VerifyRequest | null>(null)
  const [pendingAttendance, setPendingAttendance] = useState<AttendanceSession | null>(null)
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<{ holder: string; recordedAt: string }[]>([])
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; title: string; kind: string; verifiedAt: string } | null>(null)
  const selectedCredential = useMemo(() => credentials.find((credential) => credential.id === selectedCredentialId) ?? credentials[0], [credentials, selectedCredentialId])

  const refreshWallet = useCallback(async () => {
    const walletItems = await listWalletCredentials()
    setCredentials(walletItems)
    if (walletItems.length) setSelectedCredentialId((current) => walletItems.some((item) => item.id === current) ? current : walletItems[0].id)
  }, [])

  const refreshIssuer = useCallback(async () => {
    const rows = await api<IssuedCredential[]>('/api/credentials')
    setServerCredentials(rows)
  }, [])

  // La carga inicial sincroniza el estado de React con IndexedDB y la API.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshWallet(); void refreshIssuer().catch(() => undefined) }, [refreshIssuer, refreshWallet])

  useEffect(() => {
    if (!attendance || activeTab !== 'attendance') return
    const refresh = () => { void api<typeof attendanceRecords>(`/api/attendance/sessions/${attendance.id}/records`).then(setAttendanceRecords).catch(() => undefined) }
    refresh()
    const timer = window.setInterval(refresh, 2500)
    return () => window.clearInterval(timer)
  }, [activeTab, attendance])

  const issueCredential = async () => {
    setWorking(true)
    try {
      const title = credentialKind === 'Regularidad' ? 'Alumno regular' : credentialKind === 'Biblioteca' ? 'Acceso a biblioteca' : credentialKind === 'Gimnasio' ? 'Acceso al gimnasio' : subject.trim() || 'Materia sin especificar'
      const detail = credentialKind === 'Materia aprobada' ? 'Condición: aprobada' : credentialKind === 'Nota de materia' ? 'Nota: 8' : credentialKind === 'Regularidad' ? 'Ingeniería en Sistemas de Información' : 'Membresía activa'
      const expiresAt = ['Materia aprobada', 'Nota de materia'].includes(credentialKind) ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
      const response = await api<DeliveryResponse>('/api/credentials', { method: 'POST', body: JSON.stringify({ kind: credentialKind, title, detail, ...(expiresAt ? { expiresAt } : {}) }) })
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
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo revocar la credencial.') }
  }

  const createPresentationRequest = async () => {
    setWorking(true)
    try {
      const request = await api<VerifyRequest>('/api/presentation-requests', { method: 'POST', body: JSON.stringify({ kind: requestedKind, minutes: 2 }) })
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
      const session = await api<AttendanceSession>('/api/attendance/sessions', { method: 'POST', body: JSON.stringify({ subject: subject.trim() || 'Ingeniería de Software', section: 'Comisión A', minutes: 1 }) })
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
        const holder = 'did:demo:estudiante'
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
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo presentar la credencial.') }
    finally { setWorking(false) }
  }

  const confirmAttendance = async () => {
    if (!pendingAttendance) return
    setWorking(true)
    try {
      const holder = 'did:demo:estudiante'
      const proof = await signWalletProof(`attendance.${pendingAttendance.id}.${holder}`)
      await api(`/api/attendance/sessions/${pendingAttendance.id}/check-in`, { method: 'POST', body: JSON.stringify({ holder, ...proof }) })
      setPendingAttendance(null)
      setNotice(`Asistencia registrada para ${pendingAttendance.subject}.`)
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

  return (
    <main>
      <header className="topbar"><div className="brand" aria-label="Universidad Nacional de La Rioja"><span className="brand-mark">UNLaR</span><span className="brand-copy"><strong>Universidad Nacional de La Rioja</strong><small>Billetera universitaria</small></span></div><span className="mode">PROTOTIPO ACADÉMICO</span></header>
      <section className="hero"><div><p className="eyebrow">Billetera universitaria verificable</p><h1>Credenciales que compartís con control.</h1><p className="lead">Antecedentes académicos, servicios institucionales y asistencia en una misma billetera.</p></div><div className="trust-card"><span className="trust-icon">⌁</span><div><strong>Privacidad por diseño</strong><p>Compartí solo el dato que te solicitan.</p></div></div></section>
      <nav className="tabs" aria-label="Módulos del prototipo">{tabs.map((tab) => <button className={activeTab === tab.id ? 'tab active' : 'tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
      <p className="notice" role="status">{working ? 'Procesando… ' : ''}{notice}</p>

      {activeTab === 'wallet' && <section className="layout wallet-layout">
        <div><div className="section-heading"><div><p className="eyebrow">Estudiante</p><h2>Mis credenciales</h2></div><span className="count">{credentials.length}</span></div>
          <div className="wallet-actions"><button type="button" className="primary-button" onClick={() => setScannerOpen(true)}>Escanear QR con la cámara</button><span className="muted">Las credenciales se guardan en este teléfono.</span></div>
          {credentials.length ? <div className="credential-list">{credentials.map((credential) => <button type="button" className={selectedCredentialId === credential.id ? 'credential-card selected' : 'credential-card'} onClick={() => setSelectedCredentialId(credential.id)} key={credential.id}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><span className="credential-copy"><small>{credential.type}</small><strong>{credential.claims.titulo}</strong><span>{credential.claims.detalle}</span></span><span className={credential.localStatus === 'Activa' ? 'status good' : 'status bad'}>{credential.localStatus}</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h3>Tu billetera está vacía</h3><p>Desde el panel Emisor, creá una credencial y escaneá su QR para recibirla.</p></div>}
        </div>
        <aside className="detail-panel">{selectedCredential ? <><p className="eyebrow">{selectedCredential.type}</p><h2>{selectedCredential.claims.titulo}</h2><p className="detail-copy">{selectedCredential.claims.detalle}</p><dl><div><dt>Emisor</dt><dd>Universidad Nacional de La Rioja</dd></div><div><dt>Emitida</dt><dd>{formatDate(selectedCredential.issuedAt)}</dd></div><div><dt>Vigencia</dt><dd>{selectedCredential.expiresAt ? formatDate(selectedCredential.expiresAt) : 'Sin vencimiento'}</dd></div><div><dt>Firma</dt><dd>{selectedCredential.proof.algorithm} válida</dd></div></dl></> : <><p className="eyebrow">Tu espacio personal</p><h2>Guardá credenciales emitidas por la universidad</h2><p className="detail-copy">Cada QR de entrega es de un solo uso y vence a los diez minutos.</p></>}</aside>
      </section>}

      {activeTab === 'issuer' && <section className="layout issuer-layout"><div className="panel form-panel"><p className="eyebrow">Panel institucional</p><h2>Emitir una credencial</h2><p className="muted">El servidor firma con Ed25519. La clave privada queda en la Mac y nunca se envía a los celulares.</p><div className="form-grid"><label>Tipo de credencial<select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Materia o servicio<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label></div><button type="button" className="primary-button" onClick={() => void issueCredential()} disabled={working}>Emitir y generar QR</button></div>
        <aside className="panel request-panel">{qr?.value.includes(':delivery:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Entrega de credencial</h3><p>Vence: {formatDate(qr.expiresAt)}</p><button type="button" className="secondary-button" onClick={() => void refreshIssuer()}>Actualizar emisiones</button></> : <><span className="qr-placeholder">▦</span><h3>Entrega por QR</h3><p>El estudiante escanea el QR con su cámara y recibe la credencial firmada en su billetera local.</p></>}</aside>
        <div className="panel issuer-records"><div className="section-heading"><div><p className="eyebrow">Registro del emisor</p><h2>Credenciales emitidas</h2></div><button type="button" className="secondary-button" onClick={() => void refreshIssuer()}>Actualizar</button></div>{serverCredentials.length ? <div className="credential-list">{serverCredentials.map((credential) => <div className="credential-card record-card" key={credential.id}><span className="credential-icon">{iconFor(credential.kind)}</span><span className="credential-copy"><small>{credential.kind}</small><strong>{credential.title}</strong><span>{credential.detail}</span></span><span className={credential.status === 'Activa' ? 'status good' : 'status bad'}>{credential.status}</span>{credential.status === 'Activa' && <button type="button" className="danger-link" onClick={() => void revokeCredential(credential)}>Revocar</button>}</div>)}</div> : <p className="muted">Todavía no se emitieron credenciales.</p>}</div>
      </section>}

      {activeTab === 'verify' && <section className="layout verify-layout"><div className="panel"><p className="eyebrow">Verificador</p><h2>Solicitar evidencia</h2><p className="muted">El QR vence en dos minutos y se acepta una única respuesta.</p><label>Requisito<select value={requestedKind} onChange={(event) => setRequestedKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><button type="button" className="primary-button" onClick={() => void createPresentationRequest()} disabled={working}>Generar QR de solicitud</button>{verifyResult && <div className="verification-result"><span className="result-check">✓</span><div><strong>Credencial válida</strong><p>{verifyResult.title} · {verifyResult.kind}</p><small>Firma, vigencia, revocación y posesión verificadas</small></div></div>}</div><aside className="panel request-panel">{qr?.value.includes(':verify:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>Solicitud temporal</h3><p>Vence: {formatDate(qr.expiresAt)}</p><button type="button" className="secondary-button" onClick={() => void pollVerification()}>Consultar resultado</button></> : <><span className="qr-placeholder">▦</span><h3>Presentación con consentimiento</h3><p>El estudiante ve qué se solicita y confirma antes de enviar su credencial.</p></>}</aside></section>}

      {activeTab === 'attendance' && <section className="layout verify-layout"><div className="panel"><p className="eyebrow">Profesor</p><h2>Asistencia de clase</h2><p className="muted">El QR de asistencia vence en un minuto. Cada billetera puede registrar una sola presencia.</p><label>Materia<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>{attendance?.status === 'Abierta' ? <button type="button" className="secondary-button" onClick={() => void closeAttendance()}>Cerrar sesión de asistencia</button> : <button type="button" className="primary-button" onClick={() => void openAttendance()} disabled={working}>Abrir asistencia y mostrar QR</button>}<div className="attendance-list"><h3>Presentes ({attendanceRecords.length})</h3>{attendanceRecords.map((record) => <p key={`${record.holder}-${record.recordedAt}`}>✓ Estudiante de prueba · {formatDate(record.recordedAt)}</p>)}{attendance?.status === 'Abierta' && attendanceRecords.length === 0 && <p className="muted">Esperando registros desde las billeteras.</p>}</div></div><aside className="panel request-panel">{attendance?.status === 'Abierta' && qr?.value.includes(':attendance:') ? <><QrDisplay value={qr.value} label={qr.label} /><h3>{attendance.subject}</h3><p>{attendance.section} · vence: {formatDate(attendance.expiresAt)}</p></> : <><span className="qr-placeholder">▦</span><h3>Asistencia temporal</h3><p>Abrí una sesión para generar el QR que escanearán los estudiantes.</p></>}</aside></section>}

      {pendingVerify && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Solicitud del verificador</p><h2>¿Compartir esta credencial?</h2><p>El verificador solicita: <strong>{pendingVerify.kind}</strong></p>{credentials.filter((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa').map((credential) => <div className="consent-credential" key={credential.id}><span className="credential-icon">{iconFor(credential.type as CredentialKind)}</span><div><strong>{credential.claims.titulo}</strong><p>{credential.claims.detalle}</p><small>Se comparte solo esta credencial</small></div></div>)}{!credentials.some((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa') && <p className="scanner-error">No tenés una credencial activa de este tipo.</p>}<div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingVerify(null); setNotice('Rechazaste compartir la credencial.') }}>Rechazar</button>{credentials.filter((credential) => credential.type === pendingVerify.kind && credential.localStatus === 'Activa').map((credential) => <button type="button" className="primary-button" key={credential.id} disabled={working} onClick={() => void shareCredential(credential)}>Confirmar y compartir</button>)}</div></section></div>}
      {pendingAttendance && <div className="consent-backdrop"><section className="consent-card" role="dialog" aria-modal="true"><p className="eyebrow">Confirmar asistencia</p><h2>{pendingAttendance.subject}</h2><p>{pendingAttendance.section} · sesión temporal del profesor</p><p>Se enviará tu identificador de billetera y una prueba criptográfica. No se comparten notas ni otras credenciales.</p><div className="consent-actions"><button type="button" className="secondary-button" onClick={() => { setPendingAttendance(null); setNotice('Cancelaste el registro de asistencia.') }}>Cancelar</button><button type="button" className="primary-button" disabled={working} onClick={() => void confirmAttendance()}>Confirmar presencia</button></div></section></div>}
      {scannerOpen && <QrScanner onScan={handleScan} onClose={() => setScannerOpen(false)} />}
      <footer>Datos ficticios · Prototipo académico independiente · No utiliza información académica real.</footer>
    </main>
  )
}

export default App
