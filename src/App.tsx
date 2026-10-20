import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { signCredential, verifyCredential as verifySignedCredential, type SignedCredential } from './lib/credentialCrypto'

type CredentialKind = 'Regularidad' | 'Materia aprobada' | 'Nota de materia' | 'Biblioteca' | 'Gimnasio'
type CredentialStatus = 'Activa' | 'Revocada'
type Credential = {
  id: string
  kind: CredentialKind
  title: string
  detail: string
  issuedAt: string
  expiresAt: string
  status: CredentialStatus
  signed?: SignedCredential
}
type AttendanceSession = { id: string; subject: string; expiresAt: string; checkedIn: boolean }
type TabId = 'wallet' | 'issuer' | 'verify' | 'attendance'

const kinds: CredentialKind[] = ['Regularidad', 'Materia aprobada', 'Nota de materia', 'Biblioteca', 'Gimnasio']
const tabs: { id: TabId; label: string }[] = [
  { id: 'wallet', label: 'Mi billetera' },
  { id: 'issuer', label: 'Emisor' },
  { id: 'verify', label: 'Verificar' },
  { id: 'attendance', label: 'Asistencia' },
]
const initialCredentials: Credential[] = [
  { id: 'cred-isi-302', kind: 'Materia aprobada', title: 'Bases de Datos', detail: 'Condición: aprobada', issuedAt: '18 oct 2026', expiresAt: 'Sin vencimiento', status: 'Activa' },
  { id: 'cred-regularidad', kind: 'Regularidad', title: 'Alumno regular', detail: 'Ingeniería en Sistemas de Información', issuedAt: '1 mar 2026', expiresAt: '31 dic 2026', status: 'Activa' },
  { id: 'cred-biblioteca', kind: 'Biblioteca', title: 'Acceso a biblioteca', detail: 'Membresía activa', issuedAt: '1 mar 2026', expiresAt: '31 dic 2026', status: 'Activa' },
]
const iconFor = (kind: CredentialKind) => ({ 'Materia aprobada': '✓', 'Nota de materia': '▣', Regularidad: '◇', Biblioteca: '▤', Gimnasio: '◌' }[kind])

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('wallet')
  const [credentials, setCredentials] = useState<Credential[]>(() => {
    const saved = localStorage.getItem('unidemo.credentials')
    return saved ? JSON.parse(saved) as Credential[] : initialCredentials
  })
  const [selectedCredentialId, setSelectedCredentialId] = useState(initialCredentials[0].id)
  const [notice, setNotice] = useState('Entorno local de demostración listo.')
  const [credentialKind, setCredentialKind] = useState<CredentialKind>('Materia aprobada')
  const [subject, setSubject] = useState('Ingeniería de Software')
  const [requestedKind, setRequestedKind] = useState<CredentialKind>('Materia aprobada')
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null)
  const selectedCredential = useMemo(() => credentials.find((credential) => credential.id === selectedCredentialId), [credentials, selectedCredentialId])

  useEffect(() => {
    localStorage.setItem('unidemo.credentials', JSON.stringify(credentials))
  }, [credentials])

  useEffect(() => {
    const unsigned = credentials.filter((credential) => !credential.signed)
    if (!unsigned.length) return
    void Promise.all(credentials.map(async (credential) => {
      if (credential.signed) return credential
      const signed = await signCredential({
        id: credential.id,
        type: credential.kind,
        issuer: 'did:web:unlar.edu.ar:prototipo',
        holder: 'did:key:estudiante-demo',
        claims: { titulo: credential.title, detalle: credential.detail },
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt === 'Sin vencimiento' ? undefined : credential.expiresAt,
      })
      return { ...credential, signed }
    })).then(setCredentials)
  // La migración se realiza solo al cargar credenciales de demostración antiguas.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const issueCredential = async () => {
    const title = credentialKind === 'Regularidad' ? 'Alumno regular' : credentialKind === 'Biblioteca' ? 'Acceso a biblioteca' : credentialKind === 'Gimnasio' ? 'Acceso al gimnasio' : subject.trim() || 'Materia sin especificar'
    const detail = credentialKind === 'Materia aprobada' ? 'Condición: aprobada' : credentialKind === 'Nota de materia' ? 'Nota: 8' : credentialKind === 'Regularidad' ? 'Ingeniería en Sistemas de Información' : 'Membresía activa'
    const id = crypto.randomUUID()
    const issuedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date())
    const expiresAt = credentialKind === 'Materia aprobada' || credentialKind === 'Nota de materia' ? 'Sin vencimiento' : '31 dic 2026'
    const signed = await signCredential({
      id,
      type: credentialKind,
      issuer: 'did:web:unlar.edu.ar:prototipo',
      holder: 'did:key:estudiante-demo',
      claims: { titulo: title, detalle: detail },
      issuedAt,
      expiresAt: expiresAt === 'Sin vencimiento' ? undefined : expiresAt,
    })
    const credential: Credential = { id, kind: credentialKind, title, detail, issuedAt, expiresAt, status: 'Activa', signed }
    setCredentials((current) => [credential, ...current])
    setSelectedCredentialId(credential.id)
    setActiveTab('wallet')
    setNotice('Se emitió la credencial "' + title + '" para la billetera de prueba.')
  }

  const revokeSelected = () => {
    if (!selectedCredential) return
    setCredentials((current) => current.map((credential) => credential.id === selectedCredential.id ? { ...credential, status: 'Revocada' } : credential))
    setNotice('La credencial "' + selectedCredential.title + '" fue revocada.')
  }

  const verifyCredential = async () => {
    if (!selectedCredential) return
    if (selectedCredential.status === 'Revocada') {
      setNotice('Verificación rechazada: la credencial está revocada.')
    } else if (selectedCredential.kind !== requestedKind) {
      setNotice('Verificación rechazada: se solicitó "' + requestedKind + '" y se presentó "' + selectedCredential.kind + '".')
    } else if (selectedCredential.signed && !(await verifySignedCredential(selectedCredential.signed))) {
      setNotice('Verificación rechazada: la firma digital de la credencial no es válida.')
    } else {
      setNotice('Verificación válida: ' + selectedCredential.title + ' cumple el requisito solicitado.')
    }
  }

  const openAttendance = () => {
    const session = { id: crypto.randomUUID().slice(0, 8).toUpperCase(), subject: subject.trim() || 'Ingeniería de Software', expiresAt: '19:42', checkedIn: false }
    setAttendance(session)
    setNotice('La asistencia para ' + session.subject + ' está abierta hasta las ' + session.expiresAt + '.')
  }

  const checkIn = () => {
    if (!attendance) return setNotice('No hay una sesión de asistencia abierta.')
    if (attendance.checkedIn) return setNotice('Registro rechazado: esta billetera ya registró asistencia en la sesión.')
    setAttendance({ ...attendance, checkedIn: true })
    setNotice('Asistencia registrada para ' + attendance.subject + '.')
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand" aria-label="Universidad Nacional de La Rioja"><span className="brand-mark">UNLaR</span><span className="brand-copy"><strong>Universidad Nacional de La Rioja</strong><small>Billetera universitaria</small></span></div>
        <span className="mode">PROTOTIPO ACADÉMICO</span>
      </header>
      <section className="hero">
        <div><p className="eyebrow">Billetera universitaria verificable</p><h1>Credenciales que compartís con control.</h1><p className="lead">Antecedentes académicos, servicios institucionales y asistencia en una misma billetera.</p></div>
        <div className="trust-card"><span className="trust-icon">⌁</span><div><strong>Privacidad por diseño</strong><p>Compartí solo el dato que te solicitan.</p></div></div>
      </section>
      <nav className="tabs" aria-label="Módulos del prototipo">
        {tabs.map((tab) => <button className={activeTab === tab.id ? 'tab active' : 'tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}
      </nav>
      <p className="notice" role="status">{notice}</p>

      {activeTab === 'wallet' && <section className="layout wallet-layout">
        <div>
          <div className="section-heading"><div><p className="eyebrow">Estudiante</p><h2>Mis credenciales</h2></div><span className="count">{credentials.length}</span></div>
          <div className="credential-list">{credentials.map((credential) => <button type="button" className={selectedCredentialId === credential.id ? 'credential-card selected' : 'credential-card'} onClick={() => setSelectedCredentialId(credential.id)} key={credential.id}>
            <span className="credential-icon">{iconFor(credential.kind)}</span>
            <span className="credential-copy"><small>{credential.kind}</small><strong>{credential.title}</strong><span>{credential.detail}</span></span>
            <span className={credential.status === 'Activa' ? 'status good' : 'status bad'}>{credential.status}</span>
          </button>)}</div>
        </div>
        <aside className="detail-panel">{selectedCredential && <>
          <p className="eyebrow">{selectedCredential.kind}</p><h2>{selectedCredential.title}</h2><p className="detail-copy">{selectedCredential.detail}</p>
          <dl><div><dt>Emisor</dt><dd>Universidad Nacional de La Rioja</dd></div><div><dt>Emitida</dt><dd>{selectedCredential.issuedAt}</dd></div><div><dt>Vigencia</dt><dd>{selectedCredential.expiresAt}</dd></div><div><dt>Estado</dt><dd>{selectedCredential.status}</dd></div></dl>
          <button type="button" className="danger-button" onClick={revokeSelected}>Revocar credencial de prueba</button>
        </>}</aside>
      </section>}

      {activeTab === 'issuer' && <section className="panel form-panel">
        <p className="eyebrow">Panel institucional</p><h2>Emitir una credencial</h2><p className="muted">El siguiente incremento añadirá la firma con una clave institucional protegida en el servidor.</p>
        <div className="form-grid">
          <label>Tipo de credencial<select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label>Materia o servicio<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        </div>
        <button type="button" className="primary-button" onClick={issueCredential}>Emitir en billetera de prueba</button>
      </section>}

      {activeTab === 'verify' && <section className="layout verify-layout">
        <div className="panel"><p className="eyebrow">Verificador</p><h2>Solicitar evidencia</h2>
          <label>Requisito<select value={requestedKind} onChange={(event) => setRequestedKind(event.target.value as CredentialKind)}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <button type="button" className="primary-button" onClick={verifyCredential}>Verificar credencial seleccionada</button>
        </div>
        <aside className="panel request-panel"><span className="qr-placeholder">▦</span><h3>Solicitud temporal</h3><p>El QR real contendrá un código de un solo uso, el destinatario y una fecha de vencimiento.</p></aside>
      </section>}

      {activeTab === 'attendance' && <section className="layout verify-layout">
        <div className="panel"><p className="eyebrow">Profesor</p><h2>Asistencia de clase</h2>
          <label>Materia<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <button type="button" className="primary-button" onClick={openAttendance}>Abrir asistencia</button>
        </div>
        <aside className="panel request-panel">{attendance ? <><span className="qr-placeholder">▦</span><h3>{attendance.subject}</h3><p>Comisión A · vence a las {attendance.expiresAt}</p><button type="button" className="secondary-button" onClick={checkIn}>{attendance.checkedIn ? 'Asistencia registrada' : 'Simular escaneo desde billetera'}</button></> : <p>Abrí una sesión para generar un QR temporal de asistencia.</p>}</aside>
      </section>}
      <footer>Datos ficticios · Prototipo académico independiente · No utiliza información académica real.</footer>
    </main>
  )
}

export default App
