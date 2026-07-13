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
`);

export function now() { return new Date().toISOString(); }
export function audit(entidad, entidadId, accion, detalle) {
  db.prepare("INSERT INTO auditoria(entidad, entidad_id, accion, detalle, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(entidad, entidadId ?? null, accion, JSON.stringify(detalle), now());
}
export default db;
