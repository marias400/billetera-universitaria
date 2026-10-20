# Borrador de presentación — Billetera Universitaria Verificable

**Duración objetivo:** 36 minutos, dentro del rango de 30–40.
**Estructura:** 28 minutos de exposición + 8 minutos de demostración, que queda al final.
**Tiempo de código:** 15 minutos en cinco diapositivas (42% del total).
**Formato sugerido:** Canva para las diapositivas visuales y VS Code o el editor del proyecto para mostrar los fragmentos de implementación con zoom. No llenar las diapositivas con archivos enteros.

## Idea que debe quedar clara

El proyecto convierte datos académicos ficticios en credenciales firmadas. El estudiante las guarda en su teléfono y decide cuándo presentarlas. Un servidor valida la firma, el vencimiento, la revocación y la prueba de posesión de la billetera. Los QR sirven para iniciar entregas, verificaciones y asistencia; no llevan las notas dentro del código.

## Guion de 13 diapositivas

| # | Diapositiva | Tiempo | Parte |
|---:|---|---:|---|
| 1 | Billetera Universitaria Verificable | 0:30 | Apertura |
| 2 | El problema que queremos resolver | 2:00 | Contexto |
| 3 | Objetivo y alcance del prototipo | 1:30 | Propuesta |
| 4 | Actores y recorrido de una credencial | 2:00 | Caso de uso |
| 5 | Arquitectura y tecnologías | 2:30 | Diseño |
| 6 | Código 1: cómo se firma una credencial | 3:00 | Implementación |
| 7 | Código 2: emitir y entregar por QR | 3:00 | Implementación |
| 8 | Código 3: billetera local y prueba de posesión | 3:00 | Implementación |
| 9 | Código 4: escaneo y consentimiento | 3:00 | Implementación |
| 10 | Código 5: verificar o rechazar una presentación | 3:00 | Implementación |
| 11 | Código 6: asistencia con QR temporal | 2:30 | Implementación |
| 12 | Seguridad, límites y próximos pasos | 2:00 | Evaluación |
| 13 | Demostración en dos Android | 8:00 | Demo final |
|  | **Total** | **36:00** | **Código: 15:00 (42%)** |

La diapositiva 11 es una sexta mirada al código: las cinco diapositivas 6–10 suman 15 minutos. Si se quiere contar también el módulo de asistencia como código, son 17:30 minutos (49% del total).

---

## Contenido y notas para exponer

### 1. Billetera Universitaria Verificable — 0:30

**En pantalla:** título, integrantes, materia, carrera y una captura limpia de la billetera.
**Decir:** “Vamos a mostrar cómo una constancia académica puede emitirse, guardarse en el celular y comprobarse sin enviar todo el historial del estudiante”.

### 2. El problema que queremos resolver — 2:00

**En pantalla:** un trámite pide una constancia; hoy el estudiante busca, descarga o reenvía un documento completo. Contraponerlo con una solicitud concreta: “¿Aprobó Bases de Datos?”.

**Puntos para explicar:**

- Los documentos estáticos son difíciles de verificar para quien los recibe.
- Compartir un historial completo revela más información de la necesaria.
- Un QR fijo puede fotografiarse o reenviarse; por eso el proyecto usa solicitudes breves y de un solo uso.

Presentarlo como una oportunidad para explorar confianza y privacidad, no como una auditoría de los procesos reales de UNLaR.

### 3. Objetivo y alcance del prototipo — 1:30

**En pantalla:** ciclo emisor → estudiante → verificador y los tipos de credenciales cubiertos: regularidad, materia aprobada, nota, biblioteca y gimnasio.

**Decir:** el prototipo usa datos ficticios. El estudiante conserva una credencial firmada y comparte una presentación únicamente después de revisar la solicitud. No usa blockchain.

**Aclaración técnica:** el formato propio está inspirado en el modelo emisor/titular/verificador de las credenciales verificables. No debe presentarse como implementación interoperable o certificada de W3C VC v2.

### 4. Actores y recorrido de una credencial — 2:00

**En pantalla:** secuencia visual sencilla:

1. Emisor crea y firma.
2. El estudiante escanea QR y guarda.
3. Verificador solicita un dato.
4. Estudiante acepta o rechaza.
5. Servidor valida y devuelve el resultado.

**Decir:** el QR contiene un código aleatorio, no la materia, la nota ni la credencial. La credencial viaja por la API cuando se reclama; la presentación solo se envía con consentimiento.

### 5. Arquitectura y tecnologías — 2:30

**En pantalla:** diagrama de cuatro partes:

```text
PWA React + TypeScript (emisor / billetera / verificador)
        │ HTTPS · API JSON · QR de un solo uso
        ▼
Fastify + Node.js ─── SQLite
        │ Ed25519 / Web Crypto
        ├── credencial firmada por el emisor
        └── prueba firmada por la billetera

Android: cámara ZXing + IndexedDB
```

**Explicación corta del stack:**

- **React y TypeScript:** interfaz compartida entre computadora y teléfono.
- **PWA:** se puede agregar a la pantalla de inicio sin publicar en una tienda.
- **Fastify y SQLite:** API y persistencia del prototipo.
- **Ed25519:** firmas compactas para detectar cambios y probar posesión de una clave.
- **qrcode y ZXing:** crear y leer los códigos.
- **IndexedDB:** guardar credenciales y claves locales en el teléfono.

### 6. Código 1: cómo se firma una credencial — 3:00

**Abrir:** [`server/index.ts`](../server/index.ts#L48) y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L30).

**Mostrar solo:** canonicalización del contenido y `sign(null, ...)`; después, en el front, verificación con la clave pública del servidor.

```ts
function signCredential(payload: CredentialPayload): SignedCredential {
  const signature = sign(null, Buffer.from(canonicalize(payload)), issuerPrivateKey)
    .toString('base64url')
  return { ...payload, proof: { algorithm: 'Ed25519', verificationMethod: issuerId, signature } }
}
```

**Explicar:** la firma se calcula sobre un orden estable de los campos. Si cambia el título, la condición o la fecha, la comprobación deja de dar válida. La clave privada se queda en el servidor; el teléfono obtiene la clave pública para verificar.

**Evitar:** explicar matemática de curvas elípticas en detalle. La audiencia debe salir entendiendo integridad y quién firmó, no una prueba formal del algoritmo.

### 7. Código 2: emitir y entregar por QR — 3:00

**Abrir:** [`server/index.ts`](../server/index.ts#L78) y el reclamo de entrega en el mismo archivo cerca de la ruta `/api/deliveries/:code/claim`.

**Mostrar:** el endpoint crea el contenido, firma, guarda estado y genera código aleatorio con vencimiento. En el reclamo, explicar vencimiento, uso único y vínculo de primera recepción.

**Punto central:** el QR no contiene la credencial ni información académica; solo un código opaco que autoriza una recepción temporal. SQLite marca el código como usado.

**Nota de honestidad:** hoy la identidad del estudiante es ficticia y la primera recepción vincula ese titular a una billetera. Eso sirve para la demostración, pero no reemplaza un alta institucional autenticada.

### 8. Código 3: billetera local y prueba de posesión — 3:00

**Abrir:** [`walletStore.ts`](../src/lib/walletStore.ts) y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L45).

**Mostrar:** guardar credenciales y el par de claves del dispositivo en IndexedDB; firmar el desafío asociado a una solicitud.

**Explicar la diferencia entre las dos firmas:**

- Firma del emisor: protege el contenido académico.
- Firma de billetera: demuestra que la respuesta se creó con la clave vinculada al dispositivo.

La segunda ayuda a impedir que alguien copie solamente el archivo de la credencial y responda desde otra clave. No demuestra de forma absoluta qué persona sostiene el teléfono.

### 9. Código 4: escaneo y consentimiento — 3:00

**Abrir:** [`App.tsx`](../src/App.tsx#L23), componente `QrScanner`, y la función `handleScan` cerca de la línea 145.

**Mostrar:** lectura con cámara y clasificación del QR (`delivery`, `verify`, `attendance`). Para una solicitud de verificación, la interfaz enseña qué tipo se pide y deja aceptar o rechazar.

**Decir:** el consentimiento no está solo en el texto de la exposición: hay una pantalla de confirmación antes de mandar la presentación. La cámara requiere HTTPS en Android; por eso se prepara un enlace HTTPS temporal para la demostración.

### 10. Código 5: verificar o rechazar una presentación — 3:00

**Abrir:** [`server/index.ts`](../server/index.ts#L142), ruta `respond`, y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L34).

**Recorrer las validaciones en este orden:**

1. La solicitud existe, está vigente y no fue respondida.
2. El tipo presentado satisface el tipo requerido.
3. La firma del emisor es correcta.
4. La credencial sigue activa en el registro y no venció.
5. La clave pública coincide con la billetera vinculada.
6. La firma de la billetera cubre el código de solicitud, la credencial y el titular.

**Mensaje:** una firma válida no es suficiente si la credencial fue revocada o la solicitud ya venció.

### 11. Código 6: asistencia con QR temporal — 2:30

**Abrir:** [`server/index.ts`](../server/index.ts#L173), rutas de asistencia, y el esquema `attendance_records` al comienzo del archivo.

**Mostrar:** QR de sesión de un minuto, firma de billetera en el registro y restricción única `(session_id, holder)` para rechazar duplicados. La lista del profesor se actualiza desde la API.

**Límite que conviene decir:** prueba que una billetera vinculada respondió dentro de la ventana; no prueba por sí sola la presencia física ni evita que el titular preste un teléfono desbloqueado.

### 12. Seguridad, límites y próximos pasos — 2:00

**En pantalla:** dos columnas “Qué protege” y “Qué falta para producción”.

**Protege en el prototipo:** cambios a una credencial firmada, QR usado o vencido, credencial revocada, respuesta con una clave no vinculada y doble asistencia de la misma billetera.

**Limitaciones actuales:** datos ficticios; primera recepción gana; identificador fijo de estudiante; no hay roles ni autenticación para emisor/profesor/verificador; la clave de emisor se guarda localmente en la Mac; no hay PIN/passkey ni enrolamiento institucional. En una demo, no usar credenciales reales y cerrar el túnel HTTPS al terminar.

**Próximos pasos sugeridos:** probar la secuencia en dos Android, capturar evidencia, agregar autenticación/enrolamiento y revisar compatibilidad formal con W3C VC u OpenID4VP si se busca interoperabilidad.

### 13. Demostración en dos Android — 8:00, siempre al final

**Distribución:** Android 1 representa al emisor/profesor/verificador (se cambia de pestaña); Android 2 representa al estudiante. La Mac ejecuta la API y Vite. Ambos celulares abren el mismo enlace HTTPS temporal. Usar únicamente datos de prueba.

| Tiempo | Acción |
|---:|---|
| 0:30 | Mostrar las dos pantallas y confirmar que el estudiante no tiene todavía la credencial de Bases de Datos. |
| 1:30 | En Android 1, emitir “Bases de Datos aprobada”; en Android 2, escanear y recibirla. Señalar que ya aparece guardada. |
| 2:00 | En Android 1, crear solicitud “Materia aprobada”; en Android 2, escanearla, revisar el consentimiento y compartir. Volver al primero y consultar el resultado válido. |
| 2:00 | Abrir asistencia en Android 1, generar QR; escanear desde Android 2 y confirmar presencia. Mostrar el registro en la lista del profesor. |
| 1:00 | Volver a escanear o registrar asistencia otra vez y mostrar el rechazo por QR consumido o asistencia duplicada. |
| 1:00 | Cerrar con qué información se compartió y qué comprobó el servidor. No explicar código durante la demo; eso ya se cubrió en las diapositivas anteriores. |

#### Checklist antes de exponer

- Mac conectada a internet y API (`npm run server`) y Vite (`npm run dev -- --host 0.0.0.0`) iniciados.
- Túnel HTTPS temporal hacia `http://localhost:5173`; probar el enlace y el permiso de cámara en ambos Android antes de entrar al aula.
- Ambos teléfonos abren la misma URL; el servidor conserva SQLite y la clave del emisor en la Mac.
- Probar previamente emisión, escaneo, presentación y asistencia; generar credenciales ficticias nuevas si hace falta.
- Tener capturas o un video local de respaldo por si falla internet, cámara o proyección.
- No borrar `data/` ni regenerar la clave del emisor antes de la presentación: las credenciales ya emitidas dependen de esa clave.

#### Frase para cerrar la demo

“En este recorrido mostramos que una credencial puede verificarse sin confiar en una captura de pantalla: el servidor comprueba quién la emitió, si sigue vigente y si la respuesta corresponde a una solicitud nueva; el estudiante conserva el control de compartirla.”

---

## Ajuste a otras duraciones

- **30 minutos:** exposición 22 min, código 12–13 min (40–43%), demo 8 min. Recortar contexto y stack; mantener las validaciones de seguridad.
- **40 minutos:** exposición 31–32 min, código 17–18 min (43–45%), demo 8 min. Usar el tiempo adicional para recorrer revocación y manejo de errores en el código.
- Reservar preguntas para después o acordar con la cátedra si forman parte de esos 30–40 minutos.

## Recomendaciones visuales para Canva

- Una idea por diapositiva; máximo 3–5 elementos visibles.
- Diapositivas 1–5 y 12: diagramas, iconos y capturas; texto breve.
- Diapositivas 6–11: fragmento de código grande (idealmente 8–15 líneas), resaltado de una sola validación y un diagrama pequeño del flujo.
- Usar la paleta visual provisional del prototipo (azul y dorado) y marcar que es adaptación académica; reemplazar logos/fuentes si la Universidad entrega manual oficial.
- Mantener un guion aparte para que la explicación verbal lleve el detalle y no se lea texto de la pantalla.
