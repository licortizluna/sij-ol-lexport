import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

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
CREATE TABLE IF NOT EXISTS expediente_documentos (
  id INTEGER PRIMARY KEY, expediente_id INTEGER NOT NULL, titulo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'otro', archivo_nombre TEXT NOT NULL, archivo_ruta TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '', tamano INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, notas TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS analisis_documentales (
  id INTEGER PRIMARY KEY, expediente_id INTEGER, datos TEXT NOT NULL,
  anexos_texto TEXT NOT NULL, archivos TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS acuerdos_expediente (
  id INTEGER PRIMARY KEY, expediente_id INTEGER NOT NULL, fecha_publicacion TEXT NOT NULL DEFAULT '',
  organo TEXT NOT NULL DEFAULT '', tipo_asunto TEXT NOT NULL DEFAULT 'EXPEDIENTE',
  numero_asunto TEXT NOT NULL DEFAULT '', sintesis TEXT NOT NULL DEFAULT '', texto TEXT NOT NULL,
  fuente_url TEXT NOT NULL DEFAULT '', archivo_nombre TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS consultas_cartera (
  id INTEGER PRIMARY KEY, estado TEXT NOT NULL DEFAULT 'pendiente', total INTEGER NOT NULL DEFAULT 0,
  procesados INTEGER NOT NULL DEFAULT 0, encontrados INTEGER NOT NULL DEFAULT 0,
  nuevas_publicaciones INTEGER NOT NULL DEFAULT 0, sin_coincidencia INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0, cancelado INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS consulta_cartera_detalle (
  id INTEGER PRIMARY KEY, consulta_id INTEGER NOT NULL, expediente_id INTEGER NOT NULL,
  estado TEXT NOT NULL, publicaciones INTEGER NOT NULL DEFAULT 0, nuevas INTEGER NOT NULL DEFAULT 0,
  ultima_fecha TEXT NOT NULL DEFAULT '', mensaje TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  FOREIGN KEY(consulta_id) REFERENCES consultas_cartera(id) ON DELETE CASCADE,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY, expediente_id INTEGER, agenda_id INTEGER,
  origen TEXT NOT NULL DEFAULT 'manual', titulo TEXT NOT NULL,
  fecha_vencimiento TEXT NOT NULL DEFAULT '', hora TEXT NOT NULL DEFAULT '',
  prioridad TEXT NOT NULL DEFAULT 'normal', estado TEXT NOT NULL DEFAULT 'pendiente',
  notas TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE,
  FOREIGN KEY(agenda_id) REFERENCES agenda(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS integraciones (
  proveedor TEXT PRIMARY KEY, estado TEXT NOT NULL DEFAULT 'desconectado',
  datos_cifrados TEXT NOT NULL DEFAULT '', configuracion TEXT NOT NULL DEFAULT '{}',
  ultimo_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expediente_etapas (
  id INTEGER PRIMARY KEY, expediente_id INTEGER NOT NULL, titulo TEXT NOT NULL,
  fecha_objetivo TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL DEFAULT 'pendiente',
  orden INTEGER NOT NULL DEFAULT 0, notas TEXT NOT NULL DEFAULT '', origen TEXT NOT NULL DEFAULT 'manual',
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE
);
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_documentos_expediente ON expediente_documentos(expediente_id, created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_acuerdos_expediente ON acuerdos_expediente(expediente_id, fecha_publicacion DESC)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_acuerdos_hash ON acuerdos_expediente(expediente_id, sha256)");
db.exec("CREATE INDEX IF NOT EXISTS idx_consulta_detalle ON consulta_cartera_detalle(consulta_id, expediente_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tareas_fecha ON tareas(estado, fecha_vencimiento)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tareas_agenda ON tareas(agenda_id) WHERE agenda_id IS NOT NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_etapas_expediente ON expediente_etapas(expediente_id, orden, id)");

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
  ,resumen_acuerdos: "TEXT NOT NULL DEFAULT ''"
  ,etapa_proxima: "TEXT NOT NULL DEFAULT ''"
  ,stj_unidad_id: "TEXT NOT NULL DEFAULT ''"
  ,stj_organo_oficial: "TEXT NOT NULL DEFAULT ''"
  ,stj_homologacion: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("expedientes", column, definition);

db.exec(`INSERT INTO expediente_etapas(expediente_id,titulo,fecha_objetivo,estado,orden,notas,origen,created_at,updated_at)
  SELECT e.id,e.estado_procesal,'','en_curso',1,'Recuperada del control procesal anterior','migracion',e.created_at,e.updated_at
  FROM expedientes e WHERE TRIM(e.estado_procesal)<>'' AND NOT EXISTS(SELECT 1 FROM expediente_etapas x WHERE x.expediente_id=e.id)`);
db.exec(`INSERT INTO expediente_etapas(expediente_id,titulo,fecha_objetivo,estado,orden,notas,origen,created_at,updated_at)
  SELECT e.id,e.etapa_proxima,e.proximo_termino,'pendiente',2,'Recuperada de la próxima etapa anterior','migracion',e.created_at,e.updated_at
  FROM expedientes e WHERE TRIM(e.etapa_proxima)<>'' AND e.etapa_proxima<>e.estado_procesal
  AND NOT EXISTS(SELECT 1 FROM expediente_etapas x WHERE x.expediente_id=e.id AND x.titulo=e.etapa_proxima)`);

for (const [column, definition] of Object.entries({
  modo: "TEXT NOT NULL DEFAULT 'historico'",
  fecha_consulta: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("consultas_cartera", column, definition);

for (const [column, definition] of Object.entries({
  expediente_referencia: "TEXT NOT NULL DEFAULT ''",
  fecha_realizacion: "TEXT NOT NULL DEFAULT ''",
  importacion_hash: "TEXT NOT NULL DEFAULT ''",
  google_event_id: "TEXT NOT NULL DEFAULT ''",
  google_sync_estado: "TEXT NOT NULL DEFAULT 'sin_sincronizar'",
  google_sync_at: "TEXT NOT NULL DEFAULT ''",
  google_sync_error: "TEXT NOT NULL DEFAULT ''",
  apple_reminder_at: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("tareas", column, definition);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tareas_importacion_hash ON tareas(importacion_hash) WHERE importacion_hash <> ''");

for (const [column, definition] of Object.entries({
  secretaria: "TEXT NOT NULL DEFAULT ''",
  partes: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("acuerdos_expediente", column, definition);
db.exec("UPDATE consultas_cartera SET estado='interrumpida',finished_at=datetime('now') WHERE estado='ejecutando'");

for (const [column, definition] of Object.entries({
  control_calidad: "TEXT NOT NULL DEFAULT ''",
  aprobado_at: "TEXT",
  aprobado_por: "TEXT NOT NULL DEFAULT ''"
})) ensureColumn("generaciones", column, definition);

ensureColumn("auditoria", "usuario", "TEXT NOT NULL DEFAULT 'sistema'");

db.exec(`INSERT OR IGNORE INTO tareas(expediente_id,agenda_id,origen,titulo,fecha_vencimiento,hora,prioridad,estado,notas,created_at,updated_at)
  SELECT expediente_id,id,'agenda',titulo,fecha,hora,CASE WHEN tipo='termino' THEN 'alta' ELSE 'normal' END,estado,notas,created_at,updated_at FROM agenda`);

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_expedientes_folio_interno ON expedientes(folio_interno) WHERE folio_interno IS NOT NULL AND folio_interno <> ''");

export function now() { return new Date().toISOString(); }
const auditStorage = new AsyncLocalStorage();
export function runAuditContext(usuario, callback) { return auditStorage.run({ usuario: usuario || "sistema" }, callback); }
export function audit(entidad, entidadId, accion, detalle) {
  const usuario = auditStorage.getStore()?.usuario || "sistema";
  db.prepare("INSERT INTO auditoria(entidad, entidad_id, accion, detalle, created_at, usuario) VALUES (?, ?, ?, ?, ?, ?)")
    .run(entidad, entidadId ?? null, accion, JSON.stringify(detalle), now(), usuario);
}
export default db;
