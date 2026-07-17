import fs from "node:fs";
import path from "node:path";
import db, { audit, now } from "../backend/db.js";

const automatico = process.argv.includes("--automatico");
const entrada = path.resolve(process.argv.find(arg => arg.endsWith(".json")) || "imports/privado/tareas-iniciales.json");
if (!fs.existsSync(entrada)) {
  if (!automatico) console.error(`No se encontró el archivo de importación: ${entrada}`);
  process.exit(automatico ? 0 : 1);
}

const normalizar = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const claveAsunto = value => {
  const match = String(value || "").match(/(^|\D)(\d{1,6})\D+(20\d{2}|19\d{2})(\D|$)/);
  return match ? `${Number(match[2])}/${match[3]}` : "";
};
const expedientes = db.prepare("SELECT id,numero,folio_interno,actor,demandado,cliente,contraparte,juzgado FROM expedientes").all();

function vincular(tarea) {
  const referencia = normalizar(tarea.expediente_referencia);
  if (!referencia || ["NO APLICA","SIN EXPEDIENTE","ENVIAR A HERMOSILLO"].includes(referencia)) return { id:null, metodo:"sin_referencia_judicial" };
  const exactos = expedientes.filter(exp => [exp.numero,exp.folio_interno].some(value => normalizar(value) === referencia));
  if (exactos.length === 1) return { id:exactos[0].id, metodo:"referencia_exacta" };
  const clave = claveAsunto(tarea.expediente_referencia);
  if (clave) {
    const numero = expedientes.filter(exp => claveAsunto(exp.numero) === clave);
    if (numero.length === 1) return { id:numero[0].id, metodo:"numero_normalizado" };
  }
  const nombres = [tarea.actor,tarea.demandado,tarea.cliente].map(normalizar).filter(value => value.length >= 10);
  const candidatos = expedientes.map(exp => {
    const propios = [exp.actor,exp.demandado,exp.cliente,exp.contraparte].map(normalizar).filter(Boolean);
    let score = 0;
    for (const nombre of nombres) if (propios.some(value => value === nombre)) score += 3;
    if (tarea.juzgado && normalizar(exp.juzgado) === normalizar(tarea.juzgado)) score += 1;
    return { id:exp.id,score };
  }).filter(item => item.score >= 4).sort((a,b) => b.score-a.score);
  if (candidatos.length && (!candidatos[1] || candidatos[0].score > candidatos[1].score)) return { id:candidatos[0].id, metodo:"partes_y_juzgado" };
  return { id:null, metodo:"sin_coincidencia_segura" };
}

const payload = JSON.parse(fs.readFileSync(entrada,"utf8"));
if (payload.formato !== "SIJOL_TAREAS_IMPORTACION_V1" || !Array.isArray(payload.tareas)) throw new Error("Formato de importación de tareas inválido");
const insert = db.prepare(`INSERT OR IGNORE INTO tareas(expediente_id,agenda_id,origen,titulo,fecha_vencimiento,hora,prioridad,estado,notas,created_at,updated_at,expediente_referencia,fecha_realizacion,importacion_hash)
  VALUES(?,NULL,'importacion_historica',?,?,?,?,?,?,?,?,?,?,?)`);
const resumen = { total:payload.tareas.length,insertadas:0,omitidas:0,revinculadas:0,vinculadas:0,sin_vincular:0,pendientes:0,cumplidas:0 };

db.exec("BEGIN IMMEDIATE");
try {
  for (const tarea of payload.tareas) {
    const enlace = vincular(tarea);
    const existente = db.prepare("SELECT id,expediente_id FROM tareas WHERE importacion_hash=?").get(tarea.importacion_hash);
    if (existente) {
      if (!existente.expediente_id && enlace.id) {
        db.prepare("UPDATE tareas SET expediente_id=?,updated_at=? WHERE id=?").run(enlace.id,now(),existente.id);
        resumen.revinculadas++;
      }
      resumen.omitidas++;
      continue;
    }
    const estado = normalizar(tarea.estado) === "REALIZADA" ? "cumplido" : "pendiente";
    const prioridadFuente = normalizar(tarea.prioridad).toLowerCase();
    const prioridad = ["urgente","alta"].includes(prioridadFuente) ? prioridadFuente : "normal";
    const notas = [
      tarea.datos_referencia ? `Referencia: ${tarea.datos_referencia}` : "",
      tarea.tipo_juicio ? `Tipo de juicio: ${tarea.tipo_juicio}` : "",
      tarea.juzgado ? `Órgano: ${tarea.juzgado}` : "",
      `Vinculación: ${enlace.metodo}`,
      tarea.automatica ? `Registro automático informado: ${tarea.automatica}` : ""
    ].filter(Boolean).join("\n");
    const result = insert.run(enlace.id,tarea.titulo,tarea.fecha_vencimiento || "","",prioridad,estado,notas,tarea.created_at || now(),tarea.updated_at || tarea.created_at || now(),tarea.expediente_referencia || "",tarea.fecha_realizacion || "",tarea.importacion_hash);
    if (result.changes) {
      resumen.insertadas++;
      enlace.id ? resumen.vinculadas++ : resumen.sin_vincular++;
      estado === "pendiente" ? resumen.pendientes++ : resumen.cumplidas++;
    } else resumen.omitidas++;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
if (resumen.insertadas) audit("tareas",null,"importar_archivo",resumen);
console.log(`Importación de tareas: ${resumen.insertadas} nuevas, ${resumen.omitidas} ya existentes, ${resumen.revinculadas} vinculadas posteriormente, ${resumen.vinculadas} vinculadas al crear y ${resumen.sin_vincular} sin vínculo seguro.`);
console.log(`Estados importados: ${resumen.pendientes} pendientes y ${resumen.cumplidas} cumplidas.`);
