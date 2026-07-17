# SIJ-OL

## Apertura como aplicación en macOS

Después de instalar dependencias, ejecute una sola vez `INSTALAR_SIJOL_MAC.command`. El instalador crea `SIJ-OL.app` y `Detener SIJ-OL.app` dentro de `~/Applications`. A partir de entonces SIJ-OL puede abrirse desde Finder o agregarse al Dock, sin iniciar Terminal manualmente.

Sistema de Inteligencia Jurídica del Despacho Ortiz Luna. Implementación nativa con Node.js, SQLite y OpenAI API, sin dependencia de Base44.

## Sprint 0.1

- Alta y edición de expedientes con auditoría de cada corrección.
- Tesauro Jurídico para sentencias, convenios con cosa juzgada, apelaciones y resoluciones de amparo.
- Extracción de texto de PDF, DOCX, TXT y Markdown.
- Generación de demandas, contestaciones, vistas, agravios, amparos, pruebas y escritos de trámite.
- Recuperación local de razonamientos y registro de las fuentes empleadas.
- Preservación del CORPUS JURIS ORTIZ como patrimonio intelectual independiente de la tecnología.

## Ejecución

Requiere Node.js 24 o posterior y `OPENAI_API_KEY` en `.env.local`.

```bash
npm install
npm start
```

Abrir `http://localhost:3000`. La base de datos se crea en `.data/sijol.sqlite`; la información y los archivos cargados no se publican en GitHub.

## Acceso desde otra ubicación

No abra el puerto 3000 en el módem. La configuración autenticada y el túnel HTTPS privado están descritos en [ACCESO_REMOTO_SEGURO.md](ACCESO_REMOTO_SEGURO.md). Antes de habilitarlo ejecute `npm run configurar:acceso`.

## Respaldos y recuperación

La sección **Respaldos** crea copias cifradas `.sijolbak` de la base y los documentos. Descargue cada copia y consérvela fuera del iMac. Para restaurar, detenga SIJ-OL y ejecute `npm run restaurar -- /ruta/al/archivo.sijolbak`; el sistema verificará la integridad y generará una copia de seguridad previa.
