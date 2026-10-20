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
- El profesor abre una sesión de asistencia con QR de un minuto; la billetera envía una confirmación firmada y el servidor impide duplicados.
- La interfaz funciona como PWA instalable en Android y usa la cámara para leer QR cuando se sirve por HTTPS.

Es una demo académica con un estudiante de prueba. La vinculación usa “primera recepción gana”; no equivale a una inscripción institucional y no se deben usar datos reales. El servidor no tiene autenticación de roles. La llave privada generada dentro de `data/` es local al equipo que ejecuta la API.

## Identidad visual UNLaR

La interfaz toma como referencia la identidad visible en el Campus Virtual oficial: azul institucional y acento dorado, tipografía sans serif y jerarquía sobria de información. La [Resolución HCS 15/2025](https://digesto.unlar.edu.ar/archivos/3638_HCS-15-2025_280880.pdf) indica que la Universidad aprobó un Manual de Marca Institucional y nuevos logos.

No se publicó un enlace descargable al manual ni a sus archivos maestros durante esta investigación. Por eso esta versión no reproduce el escudo ni afirma usar la tipografía oficial: usa una adaptación visual basada en los recursos públicos actuales. Antes de distribuir una versión institucional, corresponde solicitar el manual y los archivos de marca a UNLaR.

## Presentación del seminario

El [borrador de presentación](docs/borrador-presentacion.md) propone una charla de 36 minutos con la demostración al final y reserva aproximadamente el 42% para explicar la implementación con código. Incluye el guion por diapositiva, fragmentos/archivos a mostrar y la secuencia para los dos Android.

## Ejecución

Con Node.js instalado globalmente:

    npm install

En una terminal, iniciar la API local y la base SQLite:

    npm run server

En otra terminal, iniciar la interfaz:

    npm run dev -- --host 0.0.0.0

En la Mac, abrí la dirección local que informa Vite. Para dos celulares en la misma red, abrí `http://IP-DE-LA-MAC:5173`.

### Escaneo desde Android

Los navegadores Android solo habilitan la cámara y la instalación de la PWA en un contexto seguro HTTPS. Para una demo en vivo, iniciá un túnel HTTPS temporal hacia Vite, por ejemplo con Cloudflare Tunnel:

    cloudflared tunnel --url http://localhost:5173

Abrí en ambos celulares la dirección `https://...trycloudflare.com` que muestre el túnel. Vite reenvía las rutas `/api` y `/health` a la API local del puerto 4000. El túnel es público mientras esté encendido: usá solo datos ficticios y cerralo al terminar.

En el celular del estudiante, abrí `Mi billetera` → `Escanear QR con la cámara`. La primera vez, aceptá el permiso de cámara. Se recomienda instalar la página en la pantalla de inicio para presentar la demo como una app.

### Secuencia de demostración

1. En el equipo del profesor/emisor, abrí `Emisor`, elegí “Materia aprobada” y emití “Bases de Datos”.
2. En el Android del estudiante, escaneá el QR de entrega. La billetera valida la firma del servidor y guarda la credencial.
3. En el equipo del profesor, abrí `Verificar`, solicitá “Materia aprobada” y generá el QR.
4. En el celular del estudiante, escaneá la solicitud y confirmá el envío.
5. En el verificador, consultá el resultado. Luego revocá la credencial en el emisor y repetí con una solicitud nueva para ver el rechazo.
6. En el profesor, abrí `Asistencia`; desde el estudiante escaneá el QR y confirmá la presencia. El listado del profesor se actualiza automáticamente.

Mientras se completa la instalación global, el proyecto incluye un runtime local en la carpeta superior `.tools/node`. Desde este directorio:

    PATH="../.tools/node/bin:$PATH" ../.tools/node/bin/npm run dev

La API queda disponible en el puerto 4000. No subas `data/`: ahí se almacenan SQLite y la clave privada local del emisor.
