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
| 2 | El problema que queremos resolver | 1:30 | Contexto |
| 3 | Objetivo y alcance del prototipo | 1:00 | Propuesta |
| 4 | Actores y recorrido de una credencial | 2:00 | Caso de uso |
| 5 | Arquitectura y tecnologías | 2:30 | Diseño |
| 6 | Código 1: cómo se firma una credencial | 3:00 | Implementación |
| 7 | Código 2: emitir y entregar por QR | 3:00 | Implementación |
| 8 | Código 3: billetera local y prueba de posesión | 3:00 | Implementación |
| 9 | Código 4: escaneo y consentimiento | 3:00 | Implementación |
| 10 | Código 5: verificar o rechazar una presentación | 3:00 | Implementación |
| 11 | Código 6: asistencia con QR temporal | 2:30 | Implementación |
| 12 | Firma, verificación offline y revocación | 3:00 | Evaluación |
| 13 | Demostración en dos Android | 8:00 | Demo final |
|  | **Total** | **36:00** | **Código: 15:00 (42%)** |

La diapositiva 11 es una sexta mirada al código: las cinco diapositivas 6–10 suman 15 minutos. Si se quiere contar también el módulo de asistencia como código, son 17:30 minutos (49% del total).

---

## Contenido y notas para exponer

### 1. Billetera Universitaria Verificable — 0:30

**En pantalla:** título, integrantes, materia, carrera y una captura limpia de la billetera.
**Decir:** “Vamos a mostrar cómo una constancia académica puede emitirse, guardarse en el celular y comprobarse sin enviar todo el historial del estudiante”.

### 2. El problema que queremos resolver — 1:30

**En pantalla:** un trámite pide una constancia; hoy el estudiante busca, descarga o reenvía un documento completo. Contraponerlo con una solicitud concreta: “¿Aprobó Bases de Datos?”.

**Puntos para explicar:**

- Los documentos estáticos son difíciles de verificar para quien los recibe.
- Compartir un historial completo revela más información de la necesaria.
- Un QR fijo puede fotografiarse o reenviarse; por eso el proyecto usa solicitudes breves y de un solo uso.

Presentarlo como una oportunidad para explorar confianza y privacidad, no como una auditoría de los procesos reales de UNLaR.

### 3. Objetivo y alcance del prototipo — 1:00

**En pantalla:** ciclo emisor → estudiante → verificador y los tipos de credenciales cubiertos: regularidad, materia aprobada, nota, biblioteca y gimnasio. Añadir una nota visible: “En esta versión, el verificador consulta la API local”.

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

**Aclaración sobre conexión:** la API corre en la Mac durante la demo. Los teléfonos pueden comunicarse con esa API en una red local sin depender de un servidor en la nube; eso permite una demo sin Internet si se mantiene el enlace local. La verificación, sin embargo, sigue consultando la API de la Mac: esto no es verificación offline.

**Distinción para decir en voz alta:** “Sin Internet” significa que los equipos siguen conectados entre sí por la red local y la Mac sigue prestando la API. “Verificación offline” significa que el teléfono verificador puede validar por sí mismo, sin consultar a la Mac ni a otro servidor. El prototipo hace lo primero, no lo segundo.

### 6. Código 1: cómo se firma una credencial — 3:00

**Abrir:** [`server/index.ts`](../server/index.ts#L103) y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L30).

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

**Abrir:** [`server/index.ts`](../server/index.ts#L254) para la emisión y la ruta de reclamo `/api/deliveries/:code/claim`.

**Mostrar:** el emisor elige un perfil de estudiante, construye los claims, firma la credencial, guarda el estado y genera un código aleatorio con vencimiento. Para “Nota de materia”, el campo numérico se valida entre 1 y 10 y la nota queda dentro de los claims firmados. En el reclamo, explicar vencimiento, uso único y comprobación de que el perfil que reclama sea el destinatario.

**Punto central:** el QR no contiene la credencial ni información académica; solo un código opaco que autoriza una recepción temporal. SQLite marca el código como usado.

**Nota de honestidad:** los nombres y matrículas son perfiles ficticios de laboratorio. La cuenta de demo fija esos datos y no permite editarlos desde la billetera, pero no reemplaza un alta institucional autenticada.

### 8. Código 3: billetera local y prueba de posesión — 3:00

**Abrir:** [`walletStore.ts`](../src/lib/walletStore.ts) y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L45).

**Mostrar:** guardar credenciales y el par de claves del dispositivo en IndexedDB; firmar el desafío asociado a una solicitud.

**Explicar la diferencia entre las dos firmas:**

- Firma del emisor: protege el contenido académico.
- Firma de billetera: demuestra que la respuesta se creó con la clave vinculada al dispositivo.

La segunda ayuda a impedir que alguien copie solamente el archivo de la credencial y responda desde otra clave. No demuestra de forma absoluta qué persona sostiene el teléfono.

### 9. Código 4: escaneo y consentimiento — 3:00

**Abrir:** [`App.tsx`](../src/App.tsx#L45), componente `QrScanner`, y la función `handleScan` cerca de la línea 287.

**Mostrar:** lectura con cámara y clasificación del QR (`delivery`, `verify`, `attendance`). Para una solicitud de verificación, la interfaz enseña qué tipo se pide y deja aceptar o rechazar.

**Decir:** el consentimiento no está solo en el texto de la exposición: hay una pantalla de confirmación antes de mandar la presentación. La cámara requiere HTTPS en Android; por eso se prepara un enlace HTTPS temporal para la demostración.

### 10. Código 5: verificar o rechazar una presentación — 3:00

**Abrir:** [`server/index.ts`](../server/index.ts#L340), ruta `respond`, y [`credentialCrypto.ts`](../src/lib/credentialCrypto.ts#L34).

**Recorrer las validaciones en este orden:**

1. La solicitud existe, está vigente y no fue respondida.
2. El tipo presentado satisface el tipo requerido.
3. La firma del emisor es correcta.
4. La credencial sigue activa en el registro y no venció.
5. La clave pública coincide con la billetera vinculada.
6. La firma de la billetera cubre el código de solicitud, la credencial y el titular.

**Mensaje:** una firma válida no es suficiente si la credencial fue revocada o la solicitud ya venció. La verificación de esta versión requiere la API: allí se consulta el estado de revocación y se marca la solicitud de un solo uso como respondida.

### 11. Código 6: asistencia con QR temporal — 2:30

**Abrir:** [`server/index.ts`](../server/index.ts#L375), rutas de asistencia, y el esquema `attendance_records` al comienzo del archivo.

**Mostrar:** QR de sesión de un minuto, firma de billetera en el registro y restricción única `(session_id, holder)` para rechazar duplicados. La lista del profesor se actualiza desde la API.

**Límite que conviene decir:** prueba que una billetera vinculada respondió dentro de la ventana; no prueba por sí sola la presencia física ni evita que el titular preste un teléfono desbloqueado.

### 12. Firma, verificación offline y revocación — 3:00

**En pantalla:** dos columnas, “Prototipo actual” y “Posible ampliación offline”, más una comparación entre “firma” y “estado actual”.

```text
ACTUAL: estudiante ── presentación ──► API local en la Mac
                                      valida firma, vigencia,
                                      revocación y uso único

AMPLIACIÓN: verificador ── desafío QR ──► estudiante
             verificador ◄─ credencial + prueba firmada ─ billetera
             valida localmente con clave pública y estado guardados
```

**Explicar en orden:**

1. Una firma válida confirma que el contenido no cambió desde que lo firmó el emisor y que la firma corresponde a una clave pública que el verificador considera confiable.
2. Con la credencial y esa clave pública guardadas, el verificador podría comprobar la firma sin conectarse al servidor.
3. La firma no avisa si la credencial se revocó después. Para revisar eso offline haría falta una lista de revocación firmada y descargada previamente, con fecha de actualización y un límite de antigüedad.
4. Si la lista está vencida, el resultado correcto es “firma válida; estado de revocación desconocido”, no “credencial activa”.

**Qué hace hoy el prototipo:** la billetera guarda credenciales en el teléfono, pero al presentarlas el servidor verifica firma, vigencia, revocación, posesión de clave y uso de la solicitud. Por eso hoy no se debe afirmar que el verificador funciona offline.

**Qué conllevaría el modo offline futuro:** el verificador generaría un desafío aleatorio y lo mostraría en un QR; la billetera firmaría una respuesta que vincule ese desafío con la credencial seleccionada; el verificador escanearía la respuesta y comprobaría localmente la firma del emisor, la prueba de posesión, el vencimiento y una lista de revocación firmada que descargó antes. La solicitud/respuesta sería un intercambio de dos QR entre teléfonos, ya que hoy la API hace de intermediaria. El desafío reduce la reutilización de una captura vieja, pero no acredita por sí solo que quien sostiene el teléfono sea el titular.

**Condición para comunicar el resultado:** si el verificador no tiene una lista de revocación vigente según la política acordada, debe mostrar “firma válida; estado de revocación desconocido” o pedir conexión, nunca asegurar que la credencial sigue activa. Una política offline tiene que decidir cuánto tiempo acepta esa lista y qué tipos de operaciones se permiten sin conexión.

**Límites y trabajo adicional:** los datos son ficticios y la identidad no está validada por el padrón universitario. La revocación nueva no puede conocerse mientras el verificador esté desconectado. La ampliación de verificación offline no exige necesariamente emitir sin conexión: si también se quisiera emitir offline, habría que proteger la clave privada institucional en el dispositivo emisor, limitar quién puede usarla y sincronizar luego las emisiones y revocaciones. En una demo, no usar credenciales reales y cerrar el túnel HTTPS al terminar.

**Próximos pasos sugeridos:** probar la secuencia en dos Android, capturar evidencia, agregar autenticación/enrolamiento y revisar compatibilidad formal con W3C VC u OpenID4VP si se busca interoperabilidad.

### 13. Demostración en dos Android — 8:00, siempre al final

**Distribución:** Android 1 representa al profesor/verificador y Android 2 al estudiante. La administración institucional se muestra desde la Mac o cambiando la cuenta de demo. La Mac ejecuta la API y Vite; usar únicamente datos de prueba.

| Tiempo | Acción |
|---:|---|
| 0:30 | Mostrar las dos pantallas y confirmar que el estudiante no tiene todavía la credencial de Bases de Datos. |
| 1:30 | En Android 1, emitir “Bases de Datos aprobada”; en Android 2, escanear y recibirla. Señalar que ya aparece guardada. |
| 2:00 | En Android 1, crear solicitud “Materia aprobada”; en Android 2, escanearla, revisar el consentimiento y compartir. Volver al primero y consultar el resultado válido. |
| 2:00 | Abrir asistencia en Android 1, generar QR; escanear desde Android 2 y confirmar presencia. Mostrar el registro en la lista del profesor. |
| 1:00 | Volver a escanear o registrar asistencia otra vez y mostrar el rechazo por QR consumido o asistencia duplicada. |
| 1:00 | Cerrar con qué información se compartió y qué comprobó el servidor. No explicar código durante la demo; eso ya se cubrió en las diapositivas anteriores. |

#### Checklist antes de exponer

- API (`npm run server`) y Vite (`npm run dev -- --host 0.0.0.0`) iniciados en la Mac.
- Para la cámara: usar un túnel HTTPS temporal o abrir `http://localhost:5173` con `adb reverse tcp:5173 tcp:5173` activo. Un enlace HTTP por IP local no habilita la cámara en Android.
- Se puede hacer la demo sin Internet si los teléfonos conservan conexión local con la Mac; la API de la Mac debe seguir encendida. Esto no equivale a verificación offline.
- Ambos teléfonos abren la misma URL; el servidor conserva SQLite y la clave del emisor en la Mac.
- Probar previamente emisión, escaneo, presentación y asistencia; generar credenciales ficticias nuevas si hace falta.
- Tener capturas o un video local de respaldo por si falla internet, cámara o proyección.
- No borrar `data/` ni regenerar la clave del emisor antes de la presentación: las credenciales ya emitidas dependen de esa clave.

#### Frase para cerrar la demo

“En este recorrido el estudiante conserva una credencial firmada y decide cuándo compartirla. Hoy el servidor comprueba la firma, la vigencia, la revocación y la solicitud. La firma permitiría verificar que el contenido no fue alterado sin conexión, pero para conocer una revocación reciente hace falta actualizar el estado con el emisor.”

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
