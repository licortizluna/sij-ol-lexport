import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "sijol.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS expedientes (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL, tipo_juicio TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '', demandado TEXT NOT NULL DEFAULT '', juzgado TEXT NOT NULL DEFAULT '',
  distrito_judicial TEXT NOT NULL DEFAULT '', ciudad TEXT NOT NULL DEFAULT '',
  estado_procesal TEXT NOT NULL DEFAULT '', notas TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tesauro_documentos (
  id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, clase TEXT NOT NULL, organo TEXT NOT NULL DEFAULT '',
  expediente_origen TEXT NOT NULL DEFAULT '', fecha_resolucion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'borrador', texto TEXT NOT NULL, archivo_nombre TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generaciones (
  id INTEGER PRIMARY KEY, expediente_id INTEGER, tipo_escrito TEXT NOT NULL, instrucciones TEXT NOT NULL,
  resultado TEXT NOT NULL, modelo TEXT NOT NULL, fuentes TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY, entidad TEXT NOT NULL, entidad_id INTEGER, accion TEXT NOT NULL,
  detalle TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agenda (
  id INTEGER PRIMARY KEY, expediente_id INTEGER, titulo TEXT NOT NULL,
  fecha TEXT NOT NULL, hora TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'termino',
  estado TEXT NOT NULL DEFAULT 'pendiente', notas TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE SET NULL
);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

for (const [column, definition] of Object.entries({
  folio_interno: "TEXT",
  cliente: "TEXT NOT NULL DEFAULT ''",
  contraparte: "TEXT NOT NULL DEFAULT ''",
  asunto: "TEXT NOT NULL DEFAULT ''",
  materia: "TEXT NOT NULL DEFAULT ''",
  tipo_procedimiento: "TEXT NOT NULL DEFAULT ''",
  estado: "TEXT NOT NULL DEFAULT 'SONORA'",
  riesgo: "TEXT NOT NULL DEFAULT ''",
  fecha_inicio: "TEXT NOT NULL DEFAULT ''",
  proximo_termino: "TEXT NOT NULL DEFAULT ''",
  numero_credito: "TEXT NOT NULL DEFAULT ''",
  abogado_responsable: "TEXT NOT NULL DEFAULT ''",
  estado_expediente: "TEXT NOT NULL DEFAULT 'activo'",
  probabilidad_exito: "TEXT NOT NULL DEFAULT 'no_determinada'",
  monto_reclamado: "REAL NOT NULL DEFAULT 0",
  ultima_actuacion: "TEXT NOT NULL DEFAULT ''",
  calidad_datos: "TEXT NOT NULL DEFAULT 'captura_manual'",
  campos_faltantes: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("expedientes", column, definition);

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_expedientes_folio_interno ON expedientes(folio_interno) WHERE folio_interno IS NOT NULL AND folio_interno <> ''");

export function now() { return new Date().toISOString(); }
export function audit(entidad, entidadId, accion, detalle) {
  db.prepare("INSERT INTO auditoria(entidad, entidad_id, accion, detalle, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(entidad, entidadId ?? null, accion, JSON.stringify(detalle), now());
}
export default db;
