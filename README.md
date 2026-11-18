# Billetera Universitaria Verificable

Una app web para guardar y mostrar constancias universitarias desde tu navegador. Por ejemplo, un área académica puede emitir una constancia de **Materia aprobada**, el estudiante la guarda escaneando un QR y el docente puede pedirle que la muestre. El estudiante revisa la solicitud y decide si quiere compartirla.

La app comprueba que la constancia fue firmada por el emisor de la demo, que sigue vigente y que pertenece a la billetera que la presenta. El docente también puede tomar asistencia con un QR y descargar la planilla.

El proyecto se hizo para **Seminario de Actualización II**. Usá las cuentas y los datos de prueba para explorar el prototipo.

## Qué podés hacer con cada perfil

| Perfil | Qué puede hacer |
| --- | --- |
| Estudiante | Recibir constancias, consultarlas en **Mi billetera**, compartirlas y marcar asistencia. |
| Docente | Pedir una constancia para verificarla, abrir una sesión de asistencia y descargar la planilla. |
| Área Académica | Emitir constancias, como regularidad, materias aprobadas y notas. |
| Biblioteca y Gimnasio | Emitir credenciales de su propio servicio. |

## Cómo instalarla en tu computadora

Vas a necesitar **Windows, macOS o Linux**, conexión a Internet para la instalación y un navegador actualizado. Con la computadora podés entrar y explorar los perfiles. Para practicar con los QR, la guía incluye un paso opcional para usar el celular.

### 1. Instalá Node.js 24 LTS

Node.js es el programa que permite ejecutar la app en tu computadora. Elegí la versión **24 LTS** desde el selector y seguí los pasos del instalador o las instrucciones para tu sistema. La instalación incluye **npm**, que descarga las bibliotecas que usa el proyecto. [Descargar Node.js](https://nodejs.org/en/download)

Abrí **Símbolo del sistema (CMD)** en Windows o **Terminal** en macOS o Linux. Escribí estos comandos de a uno y presioná Enter después de cada línea.

```sh
node -v
npm -v
```

El primero debería mostrar `v24` seguido de otros números. El segundo muestra la versión de npm.

### 2. Descargá y descomprimí el proyecto

1. En la portada de GitHub, verificá que el selector de ramas diga **main**. Hacé clic en **Code → Download ZIP**. También podés usar la [descarga directa del ZIP](https://github.com/marias400/billetera-universitaria/archive/refs/heads/main.zip).
2. En Descargas, extraé el archivo. En Windows, hacé clic derecho y elegí **Extraer todo**. En macOS, hacé doble clic. En Linux, usá la opción **Extraer aquí** del gestor de archivos.
3. Ubicá la carpeta extraída `billetera-universitaria-main`. Es la que contiene el archivo `package.json`.

### 3. Instalá las bibliotecas del proyecto

En CMD o Terminal, escribí `cd` seguido de un espacio, arrastrá la carpeta extraída a la ventana y presioná Enter. Si tu terminal no admite arrastrar carpetas, copiá su ruta y pegala entre comillas después de `cd`. En Windows, usá `cd /d` en lugar de `cd` si la carpeta está en otra unidad.

Ahora ejecutá este comando y esperá hasta que termine. Solo necesitás hacer este paso la primera vez o cuando descargues una versión nueva.

```sh
npm ci
```

### 4. Iniciá la app

1. En esa misma ventana, ejecutá el siguiente comando. Inicia el servidor que guarda y verifica los datos. Dejá la ventana abierta.

   ```sh
   npm run server
   ```

2. Abrí **otra ventana** de CMD o Terminal y volvé a entrar en la carpeta del proyecto como en el paso 3. Ejecutá el siguiente comando para iniciar la página web. Dejá abierta también esta ventana.

   ```sh
   npm run dev -- --host 127.0.0.1
   ```

3. Abrí [http://localhost:5173](http://localhost:5173) en el navegador. Si la segunda ventana muestra otro puerto junto a **Local**, usá la dirección que aparece ahí. Vas a ver la pantalla **Iniciar sesión**.

### 5. Entrá con una cuenta de prueba

Elegí un perfil de la lista y usá la contraseña **`demo2026`**. Para empezar, probá **Gestión Institucional · Área Académica** y entrá en **Emisión**. Desde **Cambiar perfil** podés pasar a **Docente · Marcelo Roldán** y ver **Verificar** y **Asistencia**.

Para apagar la app, presioná **Ctrl+C** en cada ventana. La próxima vez empezá en el paso 4 y usá la dirección que aparezca junto a **Local**. La computadora guarda los registros en la carpeta `data/` y la billetera conserva sus credenciales en el navegador donde las recibiste.

## Cómo probar los QR con el celular

Para esta prueba, la computadora muestra los QR y el celular hace de billetera del estudiante. Usá tu computadora y tu celular de prueba en la misma red Wi-Fi. El navegador del celular necesita una conexión HTTPS de confianza para habilitar la cámara.

### Prepará el acceso desde el celular

1. Buscá la **dirección IPv4** de tu computadora en los detalles de la conexión Wi-Fi. Suele verse como `192.168.1.25`. En Windows también podés ejecutar `ipconfig` en CMD y buscar la dirección IPv4 del adaptador Wi-Fi.
2. Instalá **mkcert**, que genera certificados HTTPS para pruebas locales. En Windows podés ejecutar `winget install --id FiloSottile.mkcert -e` y abrir una nueva ventana de CMD. En macOS, si ya usás Homebrew, ejecutá `brew install mkcert`. Para las demás opciones, seguí las [instrucciones de instalación de mkcert](https://github.com/FiloSottile/mkcert#installation).
3. Desde la carpeta del proyecto, ejecutá estos comandos de a uno. Reemplazá `192.168.1.25` por la dirección de tu computadora. Si la carpeta `certs/local-dev` ya existe, podés saltar la línea `mkdir`.

   ```sh
   mkcert -install
   mkdir -p certs/local-dev
   mkcert -key-file certs/local-dev/server-key.pem -cert-file certs/local-dev/server-cert.pem localhost 127.0.0.1 192.168.1.25
   mkcert -CAROOT
   ```

   En **CMD de Windows**, escribí la línea que crea la carpeta como `mkdir certs\local-dev`.

4. El último comando muestra la carpeta donde mkcert dejó **`rootCA.pem`**. Copiá ese certificado al celular y, si el teléfono lo pide, cambiá el nombre de la copia a `rootCA.crt`. Guardá `rootCA-key.pem` y `server-key.pem` en la computadora, ya que son claves privadas.

   - En **Android**, buscá **Instalar un certificado → Certificado de CA** en Ajustes, elegí el archivo y después abrí Chrome. Los nombres de los menús pueden variar.
   - En **iPhone**, abrí el archivo, instalá el perfil descargado desde Ajustes y activá su confianza completa en **Ajustes → General → Información → Ajustes de confianza de certificados**. [Guía de Apple](https://support.apple.com/es-es/102390)

5. Dejá el servidor del paso 4 funcionando. En la ventana de la interfaz, presioná **Ctrl+C** y volvé a iniciarla con `npm run dev -- --host 0.0.0.0`. Si Windows te pregunta por el acceso de red, habilitalo para redes privadas.
6. Ahora abrí `https://localhost:5173` en la computadora y, en el celular, `https://192.168.1.25:5173` con tu dirección real. Si cambió el puerto, ajustalo en ambos equipos. Si cambia la dirección IP de la computadora, repetí el comando que genera los dos archivos del servidor y reiniciá la interfaz.

### Emití, recibí y verificá una constancia

1. **Celular:** iniciá sesión como **Estudiante · Mariano Arias Simone**, abrí **Mi billetera** y tocá **Vincular esta billetera**.
2. **Computadora:** entrá como **Gestión Institucional · Área Académica**. En **Emisión**, seleccioná a Mariano, elegí **Materia aprobada**, escribí **Bases de Datos** y pulsá **Emitir y generar código QR**.
3. **Celular:** tocá el botón de cámara de la app, aceptá el permiso y apuntá al QR de la computadora. La constancia debería aparecer en **Mis credenciales**.
4. **Computadora:** elegí **Cambiar perfil**, entrá como **Docente · Marcelo Roldán**, abrí **Verificar**, pedí **Materia aprobada** y pulsá **Generar código QR de verificación**.
5. **Celular:** escaneá el nuevo QR, revisá qué se solicita y tocá **Autorizar y compartir**. El resultado aparece en la pantalla del docente.

Para practicar asistencia, abrí **Asistencia → Abrir asistencia y mostrar código QR** en el perfil docente. Escanealo desde la billetera vinculada y tocá **Confirmar mi presencia** antes de que se cumpla un minuto. En la computadora podés ver la presencia y elegir **Descargar planilla (CSV / Excel)**.

## Si algo falla

| Qué ves | Qué podés hacer |
| --- | --- |
| `node` o `npm` no se reconoce | Cerrá y volvé a abrir la terminal después de instalar Node.js 24. |
| `npm` no encuentra `package.json` | Entrá en la carpeta que extrajiste. Revisá que el archivo se vea en esa carpeta. |
| La página carga, pero no podés iniciar sesión | Confirmá que `npm run server` sigue abierto. Visitá [http://localhost:4001/health](http://localhost:4001/health). Deberías ver `"ok":true`. |
| El celular no abre la dirección | Revisá que ambos equipos estén en el mismo Wi-Fi, que la dirección y el puerto coincidan y que hayas usado el comando del paso 5 de la preparación del celular. Algunas redes de invitados bloquean la comunicación entre equipos. |
| El navegador del celular avisa que el certificado no es de confianza | Revisá el paso de instalación del certificado en ese celular y comprobá que la IP de la dirección coincida con la que usaste al generarlo. |
| La app no abre la cámara o el QR caducó | Permití el acceso a la cámara desde el navegador. Si el QR venció, generá otro desde el perfil que corresponde. |

<details>
<summary>Detalles técnicos y documentación</summary>

- La interfaz usa React y Vite. El servidor usa Fastify y SQLite. La firma de las credenciales usa **ML-DSA-65**. Al arrancar se generan la base de datos y las claves locales en `data/`. Mantené fuera de Git esa carpeta y `certs/local-dev/`.
- La app guarda las credenciales y la clave de la billetera del estudiante en IndexedDB, el almacenamiento del navegador. Para seguir usando la misma billetera, entrá desde el mismo navegador y la misma dirección.
- `npm test` comprueba los flujos locales. `npm run build` genera la versión para desplegar. También están disponibles `npm run test:access`, `npm run test:emails` y, después de compilar, `npm run test:cloud`.
- Para Railway, el proyecto incluye [Dockerfile](Dockerfile) y [railway.json](railway.json). El modo desplegado usa `APP_MODE=cloud`, `HOST=0.0.0.0`, `DATA_DIR=/data`, `PORT=8080` y un volumen persistente en `/data` con una réplica. `ACCESS_PASSWORD_HASHES` contiene hashes scrypt en formato `salt:hash` para `teacher-marcelo`, `admin-academic`, `admin-library`, `admin-gym` y `demo-tools`. La entrada pública es `/?registro=1` y la institucional, `/?acceso=institucional`.
- El reinicio de la demo desde Asistencia borra las vinculaciones, credenciales, asistencias nuevas, sorteos y recuerdos. Conserva los perfiles de laboratorio, las asistencias de ejemplo y la clave institucional.
- [Borrador de la presentación](docs/borrador-presentacion.md) · [Plan de implementación](docs/plan-implementacion.md) · [Identidad visual](docs/identidad-visual-unlar.md)

</details>
