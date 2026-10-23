# Código relevante para explicar el proyecto

Los siguientes extractos se basan en el código actual. Para una exposición, abrir el archivo original en el repositorio: este documento resume los pasajes que ayudan a explicar el diseño. Las líneas pueden cambiar al evolucionar el proyecto.

## 1. Payload canonicalizado antes de firmar

**Archivo:** `server/index.ts`, función `canonicalize`.

```ts
function canonicalize(value: CredentialPayload) {
  return JSON.stringify({
    claims: value.claims,
    expiresAt: value.expiresAt,
    holder: value.holder,
    id: value.id,
    issuedAt: value.issuedAt,
    issuer: value.issuer,
    type: value.type,
  })
}
```

**Qué explicar:** se seleccionan explícitamente los campos y su orden para reconstruir los mismos bytes al firmar y verificar. No es una serialización estándar interoperable; es la convención propia del prototipo.

## 2. Firma Ed25519 de la institución

**Archivo:** `server/index.ts`, función `signCredential`.

```ts
function signCredential(payload: CredentialPayload): SignedCredential {
  const signature = sign(
    null,
    Buffer.from(canonicalize(payload)),
    issuerPrivateKey,
  ).toString('base64url')

  return {
    ...payload,
    proof: {
      algorithm: 'Ed25519',
      verificationMethod: issuerId,
      signature,
    },
  }
}
```

**Qué explicar:** `node:crypto` calcula la firma sobre los bytes canonicalizados con la privada del emisor. La credencial contiene claims legibles y el proof; no cifra el contenido.

## 3. Verificación Ed25519 en el servidor

**Archivo:** `server/index.ts`, función `verifyCredential`.

```ts
function verifyCredential(credential: SignedCredential) {
  if (
    !credential?.proof ||
    credential.proof.algorithm !== 'Ed25519' ||
    credential.proof.verificationMethod !== issuerId
  ) return false

  const { proof, ...payload } = credential
  try {
    return verify(
      null,
      Buffer.from(canonicalize(payload)),
      issuerPublicKey,
      Buffer.from(proof.signature, 'base64url'),
    )
  } catch {
    return false
  }
}
```

**Qué explicar:** el verificador reconstruye el mismo mensaje y usa la clave pública configurada para el emisor. La firma solo comprueba datos + clave; el servidor hace controles de estado por separado.

## 4. Clave del emisor y persistencia local

**Archivo:** `server/index.ts`, inicialización.

```ts
if (!fileExists(privateKeyPath)) {
  const pair = generateKeyPairSync('ed25519')
  writeFileSync(
    privateKeyPath,
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  )
  writeFileSync(
    join(dataDir, 'issuer-ed25519-public.pem'),
    pair.publicKey.export({ type: 'spki', format: 'pem' }),
  )
}
```

**Qué explicar:** para la demo, la clave se genera al primer inicio y queda en `data/`, fuera del repositorio. En producción se necesitaría un sistema dedicado de custodia/rotación y control de acceso.

## 5. Emisión de nota

**Archivo:** `server/index.ts`, ruta `POST /api/credentials`.

```ts
if (kind === 'Nota de materia' &&
    (!Number.isFinite(request.body.grade) ||
     request.body.grade < 1 || request.body.grade > 10)) {
  return reply.code(400).send({ message: 'Ingresá una nota válida entre 1 y 10.' })
}

const detail = kind === 'Nota de materia'
  ? `Nota: ${request.body.grade}`
  : request.body.detail?.trim()
```

El payload también incorpora la nota como claim (`nota`), el titular, el nombre y matrícula ficticios, la materia/servicio, el emisor y la fecha. Después se firma y guarda en SQLite.

## 6. Comprobación en la billetera antes de guardar

**Archivo:** `src/lib/credentialCrypto.ts`.

```ts
export async function verifyCredential(
  credential: SignedCredential,
  publicKeyPem: string,
) {
  try {
    if (credential.proof.algorithm !== 'Ed25519') return false
    const body = publicKeyPem.replace(
      /-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,
      '',
    )
    const binary = Uint8Array.from(atob(body), c => c.charCodeAt(0))
    const publicKey = await crypto.subtle.importKey(
      'spki', binary, { name: 'Ed25519' }, false, ['verify'],
    )
    const { proof, ...payload } = credential
    return crypto.subtle.verify(
      { name: 'Ed25519' }, publicKey,
      base64UrlToBytes(proof.signature),
      encoder.encode(canonicalize(payload)),
    )
  } catch {
    return false
  }
}
```

**Qué explicar:** antes de escribir la credencial en el almacén local, el navegador importa la pública con Web Crypto y valida la firma. Este chequeo no consulta revocación por sí solo.

## 7. Clave y prueba de posesión del teléfono

**Archivo:** `src/lib/credentialCrypto.ts`.

```ts
async function getWalletKeys() {
  const existing = await getWalletKeyPair()
  if (existing) return existing

  const pair = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify'],
  )
  await storeWalletKeyPair(pair)
  return pair
}

export async function signWalletProof(message: string) {
  const keys = await getWalletKeys()
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' }, keys.privateKey, encoder.encode(message),
  )
  const publicKey = await crypto.subtle.exportKey('spki', keys.publicKey)
  return {
    walletPublicKey: bytesToBase64(new Uint8Array(publicKey)),
    holderSignature: bytesToBase64Url(new Uint8Array(signature)),
  }
}
```

**Qué explicar:** el teléfono tiene un par distinto del emisor. La privada de billetera firma un desafío ligado a la acción actual; el servidor comprueba la firma con la pública vinculada al perfil. En el prototipo, `extractable: true` y IndexedDB son simplificaciones de laboratorio.

## 8. Almacenamiento local con IndexedDB

**Archivo:** `src/lib/walletStore.ts`.

```ts
const database = openDB('unlar-wallet', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('credentials', { keyPath: 'id' })
    if (oldVersion < 2) db.createObjectStore('keys')
  },
})

export async function storeWalletCredential(credential: SignedCredential) {
  const db = await database
  const current = await db.get('credentials', credential.id)
  await db.put('credentials', {
    ...credential,
    localStatus: current?.localStatus ?? 'Activa',
  })
}
```

**Qué explicar:** el teléfono conserva una copia local para mostrar la billetera; no necesita volver a descargar los claims en cada apertura. La revocación actual aún requiere consultar el backend.

## 9. Pedido temporal y consentimiento

**Archivo:** `server/index.ts`, rutas `/api/presentation-requests` y `.../:code/respond`.

El servidor genera un código aleatorio, guarda el tipo solicitado, un vencimiento y estado `Abierta`. Al responder valida, en este orden lógico:

1. Que el pedido exista, siga abierto y no haya vencido.
2. Que el tipo presentado sea el solicitado y el titular coincida con el perfil autenticado.
3. Que la firma Ed25519 de la institución sea válida.
4. Que SQLite siga indicando estado `Activa` y que no haya vencido la credencial.
5. Que la clave pública pertenezca a la billetera vinculada y firme el desafío `{código, credencial, titular}`.
6. Que el pedido se consuma una sola vez.

**Qué explicar:** el QR lleva el identificador aleatorio del pedido, no la nota. El estudiante ve el pedido y decide; el servidor vuelve a validar todo al recibir la respuesta.

## 10. Asistencia firmada y no duplicada

**Archivo:** `server/index.ts`, ruta `POST /api/attendance/sessions/:id/check-in`.

```ts
const proofMessage = `attendance.${request.params.id}.${student.id}`
if (!verify(
  null,
  Buffer.from(proofMessage),
  proofKey,
  Buffer.from(holderSignature, 'base64url'),
)) {
  return reply.code(422).send({ message: 'La prueba de posesión de la billetera no es válida.' })
}

db.prepare(`
  insert into attendance_records
    (id, session_id, holder, recorded_at, student_id, student_name)
  values (?, ?, ?, ?, ?, ?)
`).run(randomUUID(), request.params.id, student.id,
  new Date().toISOString(), student.id, student.fullName)
```

La tabla impone `unique(session_id, holder)`. El endpoint también comprueba que la sesión esté abierta/no vencida y que la pública corresponda al estudiante autenticado.

**Qué explicar:** esto prueba que una billetera vinculada contestó a un desafío de sesión y evita repetir un registro en la misma sesión. No demuestra ubicación ni impide préstamo del teléfono o colusión.

## 11. Planilla P/A exportable

**Archivo:** `server/index.ts`, `getAttendanceRoster` y `regenerateAttendanceFile`.

```ts
attendance: Object.fromEntries(dateKeys.map(key => [
  key,
  present.has(`${student.id}|${key}`) ? 'P' : 'A',
]))
```

```ts
const rows = [
  ['Profesor', 'Materia', 'Estudiante', ...dates.map(date => date.label)],
  ...students.map(student => [
    teacherName,
    courseName,
    student.fullName,
    ...dates.map(date => student.attendance[date.key] ?? 'A'),
  ]),
]
```

El backend regenera `data/planilla-asistencia.csv`; la UI la consulta y ofrece descargarla para Excel/Numbers. Las celdas se escapan y se antepone apóstrofo a valores que podrían interpretarse como fórmulas.

## 12. QR y cámara

**Archivo:** `src/App.tsx`.

```ts
const qrPayload = (kind: string, code: string) =>
  `unlar-wallet:${kind}:${code}`
```

`qrcode` genera la imagen del código y `@zxing/browser` lee desde la cámara. Los tipos admitidos son `delivery`, `verify` y `attendance`. La cámara necesita permiso del navegador y contexto seguro HTTPS, salvo el caso especial de localhost/puente ADB.

## Lectura sugerida para presentar la implementación

1. `server/index.ts` → esquema de datos y actores/roles.
2. `canonicalize` → `signCredential` → `verifyCredential`.
3. `src/lib/credentialCrypto.ts` → validación y firma de posesión.
4. `src/lib/walletStore.ts` → IndexedDB.
5. Rutas de entrega y presentación → vencimiento, titular, consentimiento y revocación.
6. Rutas de asistencia y CSV → firma de desafío, restricción única y P/A.
7. `src/App.tsx` → QR, cámara y pantallas por rol.
