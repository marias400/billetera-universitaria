# Paquete de contexto para generar una presentación

Este directorio reúne materiales para darle a otro LLM o herramienta el contexto del proyecto y pedirle que genere una presentación completa.

## Archivos

- `CONTEXTO_PROYECTO.md`: objetivo, problema, actores, capacidades, stack, arquitectura, límites y fuentes.
- `CODIGO_RELEVANTE.md`: fragmentos comentados y guía de lectura del código real.
- `PROMPT_GENERADOR_PRESENTACION.md`: prompt listo para copiar.
- `codigo/`: copia de los archivos fuente principales para adjuntarlos como contexto.
- `recursos/`: logo raster de la aplicación para la portada.
- `referencias/`: presentación actual y alternativa editorial como ejemplos visuales/conceptuales.

El ZIP `docs/contexto-billetera-universitaria-para-llm.zip` incluye estos archivos en un único paquete. No incluye `data/`, claves, base de datos, contraseñas personales ni otros secretos. Los usuarios/passwords que se describen son valores compartidos y ficticios del entorno demo.

## Fuente de verdad

La implementación del repositorio es la fuente de verdad para tecnologías y capacidades. El material incluye límites explícitos para evitar que el generador afirme cifrado de credenciales, validación biométrica, blockchain, identidad oficial, estándar W3C o verificación de revocación sin servidor.

## Cómo usarlo

Adjuntá el ZIP en la herramienta de presentaciones y pegá el contenido de `PROMPT_GENERADOR_PRESENTACION.md`. Si no acepta ZIP, adjuntá los cuatro Markdown y los archivos dentro de `codigo/` por separado.
