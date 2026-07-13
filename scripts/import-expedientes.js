import fs from "node:fs";
import path from "node:path";
import db, { audit, now } from "../backend/db.js";

const source = process.argv[2] || path.resolve("private-import/expedientes.json");
if (!fs.existsSync(source)) throw new Error(`No se encontró el archivo privado de importación: ${source}`);
const rows = JSON.parse(fs.readFileSync(source, "utf8"));

const existing = db.prepare("SELECT id FROM expedientes WHERE folio_interno=?");
const insert = db.prepare(`INSERT INTO expedientes(
  folio_interno,numero,cliente,actor,demandado,contraparte,asunto,materia,tipo_juicio,tipo_procedimiento,
  juzgado,distrito_judicial,ciudad,estado,estado_procesal,riesgo,fecha_inicio,proximo_termino,numero_credito,
  notas,abogado_responsable,estado_expediente,probabilidad_exito,monto_reclamado,ultima_actuacion,
  calidad_datos,campos_faltantes,created_at,updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const update = db.prepare(`UPDATE expedientes SET
  numero=?,cliente=?,actor=?,demandado=?,contraparte=?,asunto=?,materia=?,tipo_juicio=?,tipo_procedimiento=?,
  juzgado=?,distrito_judicial=?,ciudad=?,estado=?,estado_procesal=?,riesgo=?,fecha_inicio=?,proximo_termino=?,
  numero_credito=?,notas=?,abogado_responsable=?,estado_expediente=?,probabilidad_exito=?,monto_reclamado=?,
  ultima_actuacion=?,calidad_datos=?,campos_faltantes=?,updated_at=? WHERE folio_interno=?`);

let imported = 0, updated = 0, omitted = 0;
db.exec("BEGIN");
try {
  for (const r of rows) {
    const action = String(r.accion_importacion || "IMPORTAR").toUpperCase();
    if (action === "OMITIR") { omitted++; continue; }
    const t = now();
    const values = [
      r.expediente_externo || "SIN NÚMERO", r.cliente || "", r.actor || r.cliente || "",
      r.contraparte || "", r.contraparte || "", r.asunto || "", r.materia || "",
      r.tipo_procedimiento || r.asunto || "", r.tipo_procedimiento || r.asunto || "", r.juzgado || "",
      r.distrito_judicial || "", r.distrito_judicial || "", r.estado || "SONORA", r.etapa || "Captura inicial",
      r.riesgo || "", r.fecha_inicio || "", r.proximo_termino || "", r.numero_credito || "",
      r.observaciones || "", r.abogado_responsable || "", r.estado_expediente || "activo",
      r.probabilidad_exito || "no_determinada", Number(r.monto_reclamado || 0), r.ultima_actuacion || "",
      r.resultado_validacion || "INCOMPLETO", r.campos_faltantes || ""
    ];
    if (existing.get(r.folio_interno)) {
      update.run(...values, t, r.folio_interno); updated++;
    } else {
      insert.run(r.folio_interno, ...values, t, t); imported++;
    }
  }
  audit("expedientes", null, "importacion_masiva", { fuente: path.basename(source), registros: rows.length, importados: imported, actualizados: updated, omitidos: omitted });
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({ registros: rows.length, importados: imported, actualizados: updated, omitidos: omitted }));
