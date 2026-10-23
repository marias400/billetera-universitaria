# Billetera Universitaria Verificable

Prototipo para Seminario de Actualización II. Reúne credenciales académicas, acceso a servicios institucionales y asistencia mediante una misma billetera.

## Estado actual

El prototipo ya implementa una demo de flujo entre dispositivos:

- El emisor crea credenciales ficticias y el servidor las firma con Ed25519.
- La clave privada del emisor se genera en el primer inicio y se guarda en `data/`, excluida de Git.
- El emisor genera un QR de entrega, de un solo uso y con vencimiento a los diez minutos.
- La billetera escanea el QR, valida la firma y guarda la credencial y su clave de dispositivo en IndexedDB.
- La primera recepción vincula el identificador de estudiante de prueba a esa billetera.
- Un verificador genera una solicitud QR de un solo uso; el estudiante ve qué se pide, acepta o rechaza, y el verificador consulta el resultado.
- El servidor verifica firma institucional, revocación, vencimiento, uso de la solicitud y prueba de posesión de la billetera.
- El prototipo separa los perfiles Estudiante, Profesor e Institución. El profesor Marcelo Roldan abre sesiones de asistencia con QR de un minuto; el servidor solo permite leerlo y confirmar la presencia desde la misma red local privada que usó el profesor, además de exigir el perfil de estudiante correspondiente y rechazar duplicados.
- Las cuentas de laboratorio incluyen a los estudiantes Mariano Arias Simone y Peralta Herrera Nahuel, al profesor Marcelo Roldan y a áreas institucionales académica, Biblioteca y Gimnasio. Todas usan la clave de demo `demo2026`.
- Los perfiles de estudiantes tienen nombres y matrículas ficticios, inmutables desde la billetera. Las credenciales nuevas incluyen nombre, matrícula e identificador del perfil como claims protegidos por la firma institucional.
- Al elegir “Nota de materia”, el emisor solicita una nota de 1 a 10 y la incluye en los claims firmados de la credencial.
- El backend requiere una sesión de demo y aplica permisos por rol. Los usuarios académicos emiten credenciales académicas; Biblioteca y Gimnasio solo emiten y revocan las propias; el profesor gestiona asistencia y solicitudes de verificación.
- La planilla de Seminario de Actualización II se actualiza en `data/planilla-asistencia.csv` después de cada sesión, alta de alumno o presencia. La pantalla Asistencia muestra la matriz P/A y permite descargar el CSV para Excel o Numbers.
- La interfaz funciona como PWA instalable en Android y usa la cámara para leer QR cuando se sirve por HTTPS.
- Se incorporó el logo de UNLaR adjuntado para el prototipo; en modo desarrollo se desactiva el service worker para evitar que una caché vieja deje la página móvil sin cargar.

Es una demo académica con perfiles y matrículas ficticios. La identidad bloqueada y los roles son una simulación de laboratorio, no autentican usuarios de UNLaR ni deben usarse para registros oficiales. La clave de demo es compartida y visible; no constituye una barrera de seguridad para producción. Una versión real requiere autenticación institucional, padrón validado, gestión de cuentas y protección operativa de claves.

## Identidad visual UNLaR

La interfaz usa el logo entregado para este proyecto, más azul institucional, acento dorado, tipografía sans serif y una jerarquía sobria. La [Resolución HCS 15/2025](https://digesto.unlar.edu.ar/archivos/3638_HCS-15-2025_280880.pdf) indica que la Universidad aprobó un Manual de Marca Institucional y nuevos logos.

No se publicó un enlace descargable al manual ni a sus archivos maestros durante esta investigación. El logo recibido se usa tal como fue adjuntado; la aplicación no afirma aplicar la tipografía oficial del manual. Antes de distribuir una versión institucional, corresponde contrastar el arte final con los lineamientos vigentes de UNLaR.

## Presentación del seminario

El [borrador de presentación](docs/borrador-presentacion.md) propone una charla de 36 minutos con la demostración al final y reserva aproximadamente el 42% para explicar la implementación con código. Incluye el guion por diapositiva, fragmentos/archivos a mostrar y la secuencia para los dos Android.

## Ejecución

Con Node.js instalado globalmente:

    npm install

En una terminal, iniciar la API local y la base SQLite:

    npm run server

En otra terminal, iniciar la interfaz:

    npm run dev -- --host 0.0.0.0

Para tomar asistencia, iniciá el servidor en una computadora conectada al Wi-Fi del aula y abrí la aplicación desde la dirección local de esa computadora, por ejemplo `https://IP-DE-LA-COMPUTADORA:5173`. Los estudiantes deben abrirla desde la misma red. Mantené el servidor dentro de esa red y no uses un túnel público ni lo expongas a Internet durante la asistencia.

### Escaneo desde Android

Los navegadores Android solo habilitan la cámara y la instalación de la PWA en un contexto seguro HTTPS. Para una demo en vivo, iniciá un túnel HTTPS temporal hacia Vite, por ejemplo con Cloudflare Tunnel:

    cloudflared tunnel --url http://localhost:5173

Abrí en ambos celulares la dirección `https://...trycloudflare.com` que muestre el túnel. Vite reenvía las rutas `/api` y `/health` a la API local del puerto 4001. El túnel expone la aplicación a Internet mientras esté encendido, por lo que no debe usarse para tomar asistencia. Usá solo datos ficticios y cerralo al terminar.

En el celular del estudiante, abrí `Mi billetera` → `Escanear QR con la cámara`. La primera vez, aceptá el permiso de cámara. Se recomienda instalar la página en la pantalla de inicio para presentar la demo como una app.

### Prueba local por ADB inalámbrico

También se puede probar sin un túnel público, usando el puente inalámbrico de Android:

1. En Android, activá **Opciones para desarrolladores → Depuración inalámbrica → Vincular dispositivo con código**. La Mac y el teléfono deben estar en la misma red Wi-Fi.
2. En la Mac, ejecutá `adb pair IP:PUERTO_DE_VINCULACIÓN` e ingresá el código temporal que aparece en el teléfono.
3. Luego ejecutá `adb connect IP:PUERTO_DE_CONEXIÓN` usando la dirección de conexión que muestra Depuración inalámbrica.
4. Ejecutá `adb reverse tcp:5173 tcp:5173`.
5. En Chrome Android, abrí `http://localhost:5173`. La Mac puede abrir la misma dirección en su navegador y actuar como emisor/verificador.

El ejecutable `adb` se instala con Android Platform Tools. Si se usa cable USB, se puede autorizar la computadora y aplicar el mismo `adb reverse` sin emparejar por Wi-Fi.

#### Abrir los dos Android desde la Mac

El proyecto incluye un lanzador para conectar los dos equipos, iniciar la app local si hace falta, abrirla en ambos teléfonos y mostrar sus pantallas lado a lado con scrcpy:

    ./scripts/android-doble-pantalla.sh

El programa pide el IP:puerto de conexión que figura en **Depuración inalámbrica** para cada teléfono. Si un equipo todavía no está emparejado con esta Mac, ingresá también su IP:puerto de **Vincular dispositivo con código** y el código temporal. Si ya se emparejó antes, dejá vacío ese dato. El código se solicita sin mostrarlo en pantalla y no se guarda.

Android puede cambiar los puertos de conexión al desactivar o reiniciar Depuración inalámbrica; en ese caso, copiá el puerto nuevo que aparece en la pantalla del teléfono. La Mac y ambos Android deben compartir la red Wi-Fi. El lanzador conserva la conexión ADB hasta que se cierren las ventanas de scrcpy y deja los registros de inicio de la app en `logs/`.

Si Android muestra la pestaña en blanco con esa dirección, normalmente se perdió el puente inalámbrico: `localhost` apunta al propio teléfono y solo funciona con `adb reverse` activo. Confirmá la conexión con `adb devices`; si no aparece el teléfono, volvé a vincular Depuración inalámbrica y ejecutá `adb reverse tcp:5173 tcp:5173`. Recargá la página para quitar una posible caché de desarrollo anterior. Si accedés por la IP de la Mac, usá HTTPS para habilitar cámara y WebCrypto.

### Secuencia de demostración

1. En cada dispositivo, elegí la cuenta de demo correspondiente e ingresá la clave compartida `demo2026`.
2. En el Mac, ingresá como Administración académica, elegí un estudiante de prueba y emití “Materia aprobada” para “Bases de Datos”.
3. En el Android del estudiante destinatario, vinculá su billetera y escaneá el QR de entrega. La billetera valida la firma y recibe una credencial con nombre y matrícula del perfil de laboratorio.
4. En la Mac, ingresá como Profesor · Marcelo Roldan, solicitá “Materia aprobada” y generá el QR.
5. En el celular del estudiante, escaneá la solicitud y confirmá el envío; en la Mac, consultá el resultado.
6. Para emitir credenciales de Biblioteca o Gimnasio, cambiá a la cuenta institucional de esa área: su lista de tipos y sus permisos quedan limitados al ámbito correspondiente.
7. En la cuenta del profesor, abrí `Asistencia`; desde cada perfil estudiante escaneá el QR y confirmá la presencia. La matriz P/A se actualiza automáticamente y el CSV local se reescribe en la Mac.

Mientras se completa la instalación global, el proyecto incluye un runtime local en la carpeta superior `.tools/node`. Desde este directorio:

    PATH="../.tools/node/bin:$PATH" ../.tools/node/bin/npm run dev

La API queda disponible en el puerto 4001. No subas `data/`: ahí se almacenan SQLite y la clave privada local del emisor.
