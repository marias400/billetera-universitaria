# Contexto del proyecto: Billetera Universitaria Verificable

## Resumen ejecutivo

**Billetera Universitaria Verificable** es un prototipo académico para el Seminario de Actualización II de Ingeniería en Sistemas de Información de la Universidad Nacional de La Rioja (UNLaR). Explora cómo emitir, guardar y presentar credenciales digitales firmadas, y cómo verificar su integridad y estado.

El sistema modela tres actores: una institución que emite y revoca credenciales; un estudiante que las guarda en su billetera y decide si las presenta; y un docente u otro verificador que solicita un atributo. La firma digital permite detectar modificaciones y comprobar que los datos corresponden a una clave de emisor confiable. La API consulta la revocación vigente.

No es un sistema oficial de UNLaR ni una identidad digital en producción. Usa personas, matrículas, cuentas y credenciales ficticias. El formato de credencial es propio del prototipo; no afirma interoperabilidad con un estándar de credenciales verificables.

## Problema que aborda

Para demostrar regularidad, una nota o acceso a un servicio, hoy suele compartirse un archivo, captura o documento que la persona receptora debe interpretar y confiar. Esto crea preguntas prácticas:

- ¿Quién emitió el documento?
- ¿Se modificó el contenido?
- ¿La credencial sigue activa o fue revocada?
- ¿Hace falta compartir todo el documento o alcanza con un dato?
- ¿La persona titular consintió la presentación?

El prototipo reúne emisión, custodia local, consentimiento y verificación en una PWA que puede demostrarse desde una Mac y teléfonos Android conectados a la misma red.

## Propuesta y recorrido

1. Una persona con rol institucional selecciona el estudiante, tipo de credencial, materia o servicio y, para una nota, calificación.
2. El servidor forma el payload y lo firma con Ed25519. Guarda el registro y crea un QR de entrega aleatorio, de un solo uso y con vencimiento de diez minutos.
3. La billetera del estudiante escanea el QR, comprueba la firma con la clave pública del emisor y guarda la credencial en IndexedDB.
4. Un docente o área institucional crea una solicitud temporal para un tipo de credencial. El QR contiene un código de solicitud, no la nota.
5. El estudiante escanea el pedido, revisa el tipo solicitado y puede aceptar o rechazarlo.
6. Si acepta, la billetera presenta la credencial y firma una prueba ligada al código de solicitud, al identificador de credencial y al titular.
7. El servidor verifica la firma del emisor, el titular, el tipo pedido, la prueba de posesión, el vencimiento, el uso único y el estado de revocación en SQLite.
8. Para asistencia, el docente abre una sesión con QR de un minuto. La billetera firma un desafío asociado a sesión y estudiante; el servidor impide duplicados y actualiza una planilla CSV de presentes/ausentes.

## Capacidades que existen en el código

- Inicio de sesión de demostración con permisos por rol y alcance institucional.
- Emisión y revocación por ámbito: académico, Biblioteca o Gimnasio.
- Tipos de credencial: regularidad, materia aprobada, nota de materia, Biblioteca y Gimnasio.
- La nota se incluye como claim firmado; el formulario valida valores entre 1 y 10.
- Perfiles estudiantiles ficticios con matrícula. La billetera no permite editar nombre o matrícula del perfil activo.
- Generación y lectura de QR para entrega, verificación y asistencia.
- Validación de firma institucional en el navegador antes de guardar la credencial.
- Vinculación de una clave pública de billetera al perfil de laboratorio mediante una prueba de posesión firmada.
- Presentación con consentimiento, expiración y uso único.
- Consulta de vigencia y revocación en el servidor.
- Asistencia firmada por la billetera, expiración de sesión, prevención de duplicados por sesión y titular.
- Planilla P/A generada como CSV, descargable y compatible con Excel o Numbers. La interfaz consulta novedades periódicamente.
- PWA instalable con service worker para recursos de interfaz. El service worker no guarda en caché las rutas de API.

## Actores y datos de demostración

El backend define tres roles generales:

| Rol | Capacidades representadas |
|---|---|
| Estudiante | Vincular la billetera al perfil, recibir credenciales, guardarlas, aceptar o rechazar pedidos y registrar asistencia. |
| Profesor | Solicitar credenciales y administrar sesiones de asistencia. En la demo: Marcelo Roldan. |
| Institucional | Emitir y revocar dentro de su alcance: área académica, Biblioteca o Gimnasio. |

Hay seis cuentas de demo (`student-mariano`, `student-nahuel`, `teacher-marcelo`, `admin-academic`, `admin-library`, `admin-gym`). La clave común de laboratorio es `demo2026`.

El código inicial registra a `Mariano Arias Simone` (matrícula ficticia `DEMO-ISI-001`) y `Peralta Herrera Nahuel` (`DEMO-ISI-002`). **Atención al generar diapositivas:** el equipo autor se presenta como Mariano Arias Simone y **Nahuel Peralta Herrera**. La segunda persona del equipo y el perfil demo tienen el orden del nombre distinto en el código; no asumir que son la misma cadena o cambiarla sin indicarlo.

## Tecnologías y función

| Tecnología | Uso en este prototipo |
|---|---|
| TypeScript | Tipos y lógica del frontend y backend. |
| React 19 | Interfaz web de billetera, emisor, docente y verificador. |
| Vite 8 | Servidor de desarrollo y build de la aplicación; proxy de `/api` hacia la API local. |
| Node.js + `tsx` | Ejecución de la API TypeScript durante desarrollo. |
| Fastify 5 | API HTTP, rutas, controles de rol y respuestas JSON. |
| `better-sqlite3` + SQLite | Persistencia local de credenciales, perfiles, claves públicas vinculadas, solicitudes, revocaciones y asistencia. |
| `node:crypto` | Generación/lectura de claves Ed25519, firma y verificación en el servidor; UUID y códigos aleatorios. |
| Web Crypto API (`crypto.subtle`) | Verificación Ed25519 en navegador; creación de la clave de billetera y firma de pruebas del titular. |
| SHA-512 | Función hash interna del esquema Ed25519 según RFC 8032; la aplicación delega el cálculo a la biblioteca criptográfica. |
| IndexedDB mediante `idb` | Almacenamiento local de credenciales y par de claves del titular. |
| `qrcode` | Generación de imágenes QR en la interfaz. |
| `@zxing/browser` | Lectura de QR usando la cámara del navegador Android. |
| PWA: manifest + service worker | Instalación de la web en pantalla de inicio y caché de recursos estáticos de interfaz. |
| CSV | Exportación de la planilla de asistencia para Excel/Numbers. |

`jose` figura como dependencia del `package.json`, pero los flujos centrales de credenciales en el código actual utilizan directamente `node:crypto` y Web Crypto; no describir `jose` como mecanismo de firma actualmente implementado.

## Arquitectura

```text
Android / navegador
  React + TypeScript + Vite
  ZXing cámara · qrcode · Web Crypto · IndexedDB
            │ HTTPS / red local, JSON y QR
            ▼
Mac / API local
  Fastify + Node.js + node:crypto (Ed25519)
            │
            ├── SQLite (better-sqlite3): estado, roles, registros
            └── CSV regenerado: planilla P/A de asistencia
```

La API escucha por defecto en el puerto `4001`; Vite usa `5173` y reenvía las rutas `/api` y `/health` a la API. Para cámara en Android se requiere un contexto seguro HTTPS; el flujo probado por `adb reverse` puede usar localhost.

## Criptografía explicada sin exagerar

- **Ed25519 es firma digital, no cifrado.** La privada del emisor firma los bytes del payload canonicalizado; la pública permite verificar si la firma coincide con esos datos.
- El backend usa `sign(null, bytes, privateKey)` y `verify(null, bytes, publicKey, signature)` de `node:crypto`. La firma se transporta como Base64URL.
- En el navegador, `crypto.subtle.verify({name: 'Ed25519'}, ...)` valida la credencial antes de guardarla. La clave del titular se genera con `crypto.subtle.generateKey` y se guarda en IndexedDB.
- Conceptualmente, Ed25519 deriva la pública como `A = [a]B`, deriva un nonce determinista `r` a partir del secreto y mensaje, calcula `R = [r]B`, un desafío `k = H(R || A || M) mod L`, y `S = (r + k·a) mod L`. La verificación comprueba `[S]B = R + [k]A`. El código de aplicación no implementa manualmente estas operaciones; delega en implementaciones criptográficas probadas.
- La firma prueba integridad respecto de la clave indicada, pero no demuestra por sí sola que una persona sea quien dice ser, que la clave pública se haya obtenido de una fuente institucional confiable, ni que la credencial no haya sido revocada después.

## Límites y caveats que deben aparecer

- Las cuentas, contraseñas compartidas, roles y matrículas son de laboratorio. El token de sesión se mantiene en memoria del servidor; no hay autenticación institucional real.
- Nombre bloqueado y vínculo de billetera representan una regla del prototipo, pero no constituyen prueba de identidad de UNLaR.
- Los claims de la credencial permanecen legibles. Ed25519 no los cifra.
- Para consultar revocación actual se necesita la API y SQLite. Si Mac y Android están en una LAN pueden funcionar sin Internet, pero eso **no** equivale a verificación totalmente offline.
- El service worker conserva recursos de interfaz, no el estado de revocación ni respuestas de API.
- La clave privada del emisor se crea en `data/issuer-ed25519-private.pem`, directorio local excluido de Git. Es un prototipo local, no gestión de claves de producción.
- La clave de billetera se genera con `extractable: true` en el código actual y se guarda en IndexedDB; una implementación de producción debería estudiar almacenamiento no exportable/protegido por hardware.
- El QR temporal, la prueba firmada y la restricción única dificultan repetición y duplicados, pero no prueban presencia física ni evitan que una persona preste un teléfono o que exista colusión.
- No hay blockchain. SQLite lleva el estado actual centralizado.
- El formato es propio y no se presenta como W3C Verifiable Credentials ni como interoperable con otras billeteras.
- La cámara requiere permisos y contexto seguro. Un túnel HTTPS público durante la demo debe manejar solo datos ficticios y apagarse al terminar.

## Archivos de código recomendados para abrir

- `server/index.ts`: roles de demo, SQLite, clave institucional, canonicalización, firma, emisión, revocación, consentimiento, verificación, asistencia y CSV.
- `src/lib/credentialCrypto.ts`: validación Ed25519 en la PWA, par de claves del titular y prueba de posesión.
- `src/lib/walletStore.ts`: IndexedDB para credenciales y claves.
- `src/App.tsx`: flujo de interfaz, roles, generación/escaneo de QR, consentimiento y asistencia.
- `src/lib/api.ts`: token de demo en encabezado Bearer.
- `vite.config.ts`, `public/manifest.webmanifest` y `public/sw.js`: proxy, instalación PWA y caché del shell.
- `package.json`: dependencias y comandos disponibles.

## Ejecución local

```bash
npm install
npm run server
npm run dev -- --host 0.0.0.0
```

La app se abre en `http://localhost:5173`; la API escucha en `4001`. No distribuir el directorio `data/`: contiene base local y clave privada del emisor.

## Fuentes criptográficas primarias

- RFC 8032, Edwards-Curve Digital Signature Algorithm (EdDSA): <https://www.rfc-editor.org/rfc/rfc8032.html>
- Diffie y Hellman, *New Directions in Cryptography* (1976): <https://cr.yp.to/bib/1976/diffie.pdf>
- Propuesta Ed25519 de Bernstein et al.: <https://ed25519.cr.yp.to/ed25519-20110926.pdf>
