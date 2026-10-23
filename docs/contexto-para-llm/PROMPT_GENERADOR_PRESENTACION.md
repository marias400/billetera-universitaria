# Prompt para generar la presentación

Copiá este prompt en la herramienta que vaya a crear las diapositivas y adjuntá el paquete `contexto-billetera-universitaria-para-llm.zip`. Si la herramienta no puede leer ZIP, adjuntá también los Markdown y los archivos fuente de `codigo/`.

---

Actuá como diseñador editorial de presentaciones técnicas y como docente capaz de explicar criptografía a estudiantes de Sistemas y a público que recién conoce el tema. Creá una presentación completa, clara y visual en español rioplatense sobre **Billetera Universitaria Verificable**, un prototipo académico de UNLaR descrito en los archivos adjuntos.

## Objetivo y público

La presentación debe explicar qué problema aborda el prototipo, cómo se usa, cómo se construyó y qué límites conserva. El público incluye personas sin conocimientos previos de criptografía y docentes/alumnos de Ingeniería en Sistemas de Información. Definí los conceptos al aparecer; no des por sabido qué es una clave pública, un hash, un nonce o una firma digital.

## Duración y estructura

- 35 minutos de exposición y 5 minutos de demostración en vivo.
- Aproximadamente 8–10 minutos para enseñar criptografía desde cero y Ed25519.
- Entre 40% y 50% del tiempo de exposición debe explicar implementación mostrando fragmentos reales de código.
- Usá unas 20–24 diapositivas, con título, narrativa, conclusión y diapositiva de demo.
- Incluí notas del presentador con explicación oral, tiempo aproximado, transición y, en diapositivas de código, qué líneas resaltar.
- El tiempo de cada diapositiva debe sumar exactamente 35 minutos de exposición; la demo se agenda aparte por 5 minutos.

## Dirección visual

Proponé una dirección editorial radicalmente distinta a una plantilla corporativa de tarjetas repetidas. Usá una composición de revista técnica: fondo marfil o papel cálido, tipografía negra con alto contraste, acentos naranja y azul, márgenes amplios, reglas finas, números grandes y composiciones asimétricas. Alterná páginas claras con algunas páginas oscuras para separar capítulos. Evitá mosaicos repetidos de paneles redondeados, exceso de etiquetas, adornos sin función y párrafos largos. Mantené texto grande y legible en proyector.

La portada debe usar el logo raster adjunto `recursos/logo-billetera-universitaria.png`, sin deformarlo. Presentá a los integrantes como **Mariano Arias Simone** y **Nahuel Peralta Herrera**. No agregues “identidad visual propia del sistema” ni tiempo de duración en la portada.

Usá ilustraciones o diagramas claramente legibles para institución, estudiante y verificador. Priorizá imágenes auténticas/ilustrativas y diagramas editables. Etiquetá las relaciones, mostrales dirección con flechas limpias y evitá conexiones diagonales que se crucen.

## Narrativa recomendada

1. Portada e integrantes.
2. Situación problemática: compartir un documento no demuestra su vigencia ni quién lo emitió.
3. Qué resuelve el prototipo y qué pregunta práctica responde.
4. Tres actores: institución, estudiante y verificador/docente.
5. Recorrido general: emisión → guardar → pedido QR → consentimiento → verificación.
6. Arquitectura y tecnologías, con qué función cumple cada una.
7. Historia breve de criptografía de clave pública y firmas digitales.
8. Diferencias: cifrado, hash y firma.
9. Par de claves y qué significa firmar/verificar.
10. Ed25519 desde cero, con una metáfora sencilla y sin confundir firma con cifrado.
11. Una diapositiva gráfica de las ecuaciones Ed25519: `A = [a]B`, `r = H(prefix || M) mod L`, `R = [r]B`, `k = H(R || A || M) mod L`, `S = (r + k·a) mod L` y verificación `[S]B = R + [k]A`. Definí a, B, A, M, H, L, r, R, k y S en lenguaje simple. Dibujá el flujo de cálculo, señalá qué produce cada paso y mostrale al público por qué modificar M altera k y rompe la igualdad. Explicá que el código no implementa la aritmética de curva a mano: la biblioteca criptográfica lo hace.
12. Validar una firma y diferencia entre firma válida y credencial vigente.
13. Claves de emisor y de billetera: son dos pares distintos.
14. Canonicalización del payload, firma institucional y verificación en código.
15. Generación y custodia local de la billetera en IndexedDB.
16. QR de entrega temporal, credencial y datos firmados.
17. Consentimiento para presentar una credencial.
18. Solicitud temporal, prueba de posesión de la billetera y prevención de repetición.
19. Asistencia firmada, sesión de un minuto, registro único y planilla CSV P/A.
20. Revocación y qué exigiría una verificación verdaderamente offline.
21. Limitaciones, amenazas residuales y qué falta para uso institucional.
22. Guion de demostración en 5 minutos, con plan alternativo.
23. Cierre: emisor firma, estudiante decide, verificador comprueba.

Podés combinar o reorganizar puntos si mejora el ritmo; conservá todos los conceptos centrales y límites reales.

## Código y precisión técnica

- Basate en `CODIGO_RELEVANTE.md` y en los archivos fuente adjuntos; no inventes funciones, endpoints ni propiedades que el código no tenga.
- Elegí fragmentos cortos, legibles y representativos de `server/index.ts`, `src/lib/credentialCrypto.ts`, `src/lib/walletStore.ts` y `src/App.tsx`.
- Mostrá la canonicalización, la firma Ed25519, la verificación, firma del desafío del titular, almacenamiento IndexedDB, consentimiento, asistencia y exportación CSV.
- Presentá los fragmentos en ventanas de código con sintaxis coloreada estilo IDE y controles de ventana Mac. Usá flechas, números o llamadas breves para conectar líneas con su explicación. Evitá pegar funciones largas e ilegibles.
- No presentes una firma digital como cifrado. Los datos de credenciales quedan legibles en este prototipo.
- No afirmes que el prototipo acredita identidad humana, impide préstamos de teléfonos, valida ubicación, es blockchain, usa W3C Verifiable Credentials o funciona sin servidor para validar revocaciones.
- Aclaración importante: puede funcionar sin Internet si Mac y teléfonos están en la misma red local y la API está activa; no es verificación totalmente offline.
- Los perfiles y credenciales son de laboratorio. Las cuentas usan la misma contraseña de demostración. Los nombres no implican registro real en UNLaR.
- Aclarar que los nombres del equipo son Mariano Arias Simone y Nahuel Peralta Herrera. En los datos seed del código figura el estudiante `Peralta Herrera Nahuel`; no mezclarlo ni ocultar la diferencia.
- Citá RFC 8032 para EdDSA/Ed25519 y usá referencias técnicas primarias. No inventes fuentes o datos históricos.

## Resultado esperado

Entregá una presentación editable y visualmente revisada, no un esquema de diapositivas. Asegurate de que las ecuaciones, títulos, diagramas y código se lean en pantalla grande; evitá texto cortado, superposiciones y logos con fondo o proporción incorrectos. Incluí notas del presentador y una lista final breve de fuentes.

---

### Referencia de la presentación previa

El paquete incluye dos decks para comparar contenido y ritmo:

- `referencias/Billetera-Universitaria-Verificable.pptx`
- `referencias/Billetera-Universitaria-Alternativa-Editorial.pptx`

Usalos como contexto y ejemplos de contenidos; seguí la dirección visual editorial indicada arriba, no copies automáticamente sus layouts.
