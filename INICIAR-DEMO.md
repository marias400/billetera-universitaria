# Iniciar la demo desde la Mac

## Primera preparación

Con internet, abrí Terminal, entrá a la carpeta del proyecto y descargá sus dependencias una sola vez:

```sh
cd "/Users/nano/Documents/Seminario de Actualizacion II/billetera-universitaria"
../.tools/node/bin/npm install
```

El certificado HTTPS local debe estar en `certs/local-dev/`. La carpeta y los archivos del proyecto deben permanecer en la Mac.

## Cada vez que quieras usar la demo

1. Conectá la Mac y los teléfonos a la misma red Wi‑Fi. Puede ser una red sin internet.
2. En Terminal, ejecutá:

   ```sh
   cd "/Users/nano/Documents/Seminario de Actualizacion II/billetera-universitaria"
   ./scripts/iniciar-demo.command
   ```

3. En la Mac, abrí `https://localhost:5173`. Para los teléfonos, usá el enlace que muestra la pestaña **Conexión** o el que imprime Terminal.
4. Dejá la Terminal abierta durante la demo. Al terminar, presioná `Ctrl+C` para cerrar la API y la interfaz.

También podés abrir `scripts/iniciar-demo.command` desde Finder. Si macOS impide abrirlo, ejecutalo desde Terminal con los pasos anteriores.

## Uso sin internet

Después de instalar las dependencias, la app, la API, la base SQLite, la emisión y la verificación funcionan dentro de la Mac y la red local. Los asistentes pueden conectarse aunque el router no tenga internet, siempre que permita que los dispositivos se comuniquen entre sí y que estén en la misma red que la Mac. Algunas redes de invitados bloquean esa comunicación; en ese caso, la pestaña **Conexión** no podrá abrirse desde los teléfonos.

El QR del Wi‑Fi se genera localmente. Si macOS no informa el nombre de la red, ingresalo manualmente en **Conexión**; para redes abiertas elegí la opción sin contraseña. El lanzador renueva automáticamente el certificado HTTPS con la IP actual de la Mac, así los cambios de DHCP no dejan un certificado con una dirección vieja.

Para que la cámara funcione sin advertencias, cada teléfono debe confiar una sola vez en la CA local de la demo; iOS y Android no permiten que una página web instale esa confianza automáticamente. Transferí `certs/local-dev/UNLaR-local-dev-rootCA.crt` desde la Mac por AirDrop, cable u otro medio directo e instalalo como certificado de CA en cada teléfono. En iPhone, después de instalarlo, activá su confianza completa en **Ajustes → General → Información → Ajustes de confianza de certificados**. En Android, instalalo desde **Seguridad → Cifrado y credenciales → Instalar un certificado → Certificado de CA** (los nombres pueden variar según el fabricante). La clave privada (`rootCA-key.pem`) debe permanecer en la Mac y no se debe compartir. Esa instalación es una sola vez por teléfono; luego los QR abren la app y la cámara sin el paso de advertencia.
