# Billetera Universitaria Verificable

Prototipo para Seminario de Actualización II. Reúne credenciales académicas, acceso a servicios institucionales y asistencia mediante una misma billetera.

## Estado actual

La primera interfaz implementa:

- Billetera con credenciales académicas y de biblioteca de ejemplo.
- Emisión simulada de regularidad, materias aprobadas, notas, biblioteca y gimnasio.
- Revocación local de credenciales.
- Verificación del tipo de evidencia solicitado.
- Apertura y registro simulado de una sesión de asistencia.

Esta etapa guarda datos de prueba en el navegador e incorpora firmas Ed25519 generadas para la demostración. La API local y SQLite ya están preparadas para el siguiente incremento; todavía falta conectarlas a la interfaz y sustituir la clave local por una clave institucional protegida en el servidor.

## Identidad visual UNLaR

La interfaz toma como referencia la identidad visible en el Campus Virtual oficial: azul institucional y acento dorado, tipografía sans serif y jerarquía sobria de información. La [Resolución HCS 15/2025](https://digesto.unlar.edu.ar/archivos/3638_HCS-15-2025_280880.pdf) indica que la Universidad aprobó un Manual de Marca Institucional y nuevos logos.

No se publicó un enlace descargable al manual ni a sus archivos maestros durante esta investigación. Por eso esta versión no reproduce el escudo ni afirma usar la tipografía oficial: usa una adaptación visual basada en los recursos públicos actuales. Antes de distribuir una versión institucional, corresponde solicitar el manual y los archivos de marca a UNLaR.

## Ejecución

Con Node.js instalado globalmente:

    npm install
    npm run dev

En una segunda terminal, iniciar la API local y la base SQLite:

    npm run server

Mientras se completa la instalación global, el proyecto incluye un runtime local en la carpeta superior .tools/node. Desde este directorio:

    PATH="../.tools/node/bin:$PATH" ../.tools/node/bin/npm run dev

Vite mostrará una dirección local para abrir la aplicación en el navegador. La API queda disponible en el puerto 4000.
