# SIJ-OL

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
