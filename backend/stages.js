import db, { audit, now } from "./db.js";
import { sincronizarEtapa } from "./tasks.js";

const estados = new Set(["pendiente","en_curso","completada","cancelada"]);
const fechaValida = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));

function sincronizarExpediente(expedienteId) {
  const etapas=db.prepare("SELECT * FROM expediente_etapas WHERE expediente_id=? AND estado<>'cancelada' ORDER BY orden,id").all(expedienteId),completadas=etapas.filter(row=>row.estado==="completada"),actual=etapas.find(row=>row.estado==="en_curso")||etapas.find(row=>row.estado==="pendiente");
  const estadoProcesal=actual?.estado==="en_curso"?actual.titulo:(completadas.at(-1)?.titulo||actual?.titulo||""),etapaProxima=actual?.titulo||"",fecha=String(actual?.fecha_objetivo||"");
  db.prepare("UPDATE expedientes SET estado_procesal=?,etapa_proxima=?,proximo_termino=?,updated_at=? WHERE id=?").run(estadoProcesal,etapaProxima,fecha,now(),expedienteId);
  sincronizarEtapa(expedienteId,etapaProxima,fecha);
}

export function listarEtapas(expedienteId) {
  const rows=db.prepare("SELECT * FROM expediente_etapas WHERE expediente_id=? ORDER BY orden,id").all(expedienteId),consideradas=rows.filter(row=>row.estado!=="cancelada"),completadas=consideradas.filter(row=>row.estado==="completada").length;
  return {rows,avance:consideradas.length?Math.round(completadas/consideradas.length*100):0,total:consideradas.length,completadas};
}
export function asegurarEtapasDesdeCampos(expedienteId,estadoProcesal,etapaProxima,fechaObjetivo="") {
  const existente=db.prepare("SELECT 1 FROM expediente_etapas WHERE expediente_id=? LIMIT 1").get(expedienteId);if(existente)return false;const t=now(),actual=String(estadoProcesal||"").trim(),proxima=String(etapaProxima||"").trim();if(actual)db.prepare("INSERT INTO expediente_etapas(expediente_id,titulo,estado,orden,notas,origen,created_at,updated_at) VALUES(?,?,'en_curso',1,?,'captura_anterior',?,?)").run(expedienteId,actual,"Creada desde el estado procesal capturado",t,t);if(proxima&&proxima!==actual)db.prepare("INSERT INTO expediente_etapas(expediente_id,titulo,fecha_objetivo,estado,orden,notas,origen,created_at,updated_at) VALUES(?,?,?,'pendiente',2,?,'captura_anterior',?,?)").run(expedienteId,proxima,fechaObjetivo||"","Creada desde la próxima etapa capturada",t,t);return Boolean(actual||proxima);
}
export function crearEtapa(expedienteId,datos) {
  const expediente=db.prepare("SELECT id FROM expedientes WHERE id=?").get(expedienteId);if(!expediente)throw new Error("Expediente no encontrado");const titulo=String(datos.titulo||"").trim();if(!titulo)throw new Error("El nombre de la etapa es obligatorio");if(!fechaValida(datos.fecha_objetivo))throw new Error("Fecha objetivo inválida");const max=db.prepare("SELECT COALESCE(MAX(orden),0) valor FROM expediente_etapas WHERE expediente_id=?").get(expedienteId).valor,estado=estados.has(datos.estado)?datos.estado:"pendiente",t=now(),r=db.prepare("INSERT INTO expediente_etapas(expediente_id,titulo,fecha_objetivo,estado,orden,notas,origen,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(expedienteId,titulo,datos.fecha_objetivo||"",estado,Number(datos.orden||max+1),datos.notas||"",datos.origen||"manual",estado==="completada"?t:null,t,t);sincronizarExpediente(expedienteId);audit("etapa",r.lastInsertRowid,"crear",{expediente_id:expedienteId,titulo,estado});return db.prepare("SELECT * FROM expediente_etapas WHERE id=?").get(r.lastInsertRowid);
}
export function cambiarEstadoEtapa(id,estado) {
  if(!estados.has(estado))return null;const row=db.prepare("SELECT * FROM expediente_etapas WHERE id=?").get(id);if(!row)return null;const t=now();if(estado==="en_curso")db.prepare("UPDATE expediente_etapas SET estado='pendiente',updated_at=? WHERE expediente_id=? AND estado='en_curso' AND id<>?").run(t,row.expediente_id,id);db.prepare("UPDATE expediente_etapas SET estado=?,completed_at=?,updated_at=? WHERE id=?").run(estado,estado==="completada"?t:null,t,id);if(estado==="completada"){const next=db.prepare("SELECT id FROM expediente_etapas WHERE expediente_id=? AND estado='pendiente' AND orden>? ORDER BY orden,id LIMIT 1").get(row.expediente_id,row.orden);if(next)db.prepare("UPDATE expediente_etapas SET estado='en_curso',updated_at=? WHERE id=?").run(t,next.id);}sincronizarExpediente(row.expediente_id);audit("etapa",Number(id),"cambiar_estado",{anterior:row.estado,nuevo:estado});return db.prepare("SELECT * FROM expediente_etapas WHERE id=?").get(id);
}
export function actualizarEtapa(id,datos) {
  const row=db.prepare("SELECT * FROM expediente_etapas WHERE id=?").get(id);if(!row)return null;const titulo=String(datos.titulo??row.titulo).trim();if(!titulo)throw new Error("El nombre de la etapa es obligatorio");const fecha=String(datos.fecha_objetivo??row.fecha_objetivo);if(!fechaValida(fecha))throw new Error("Fecha objetivo inválida");db.prepare("UPDATE expediente_etapas SET titulo=?,fecha_objetivo=?,orden=?,notas=?,updated_at=? WHERE id=?").run(titulo,fecha,Number(datos.orden??row.orden),String(datos.notas??row.notas),now(),id);sincronizarExpediente(row.expediente_id);audit("etapa",Number(id),"editar",{anterior:row,nuevo:datos});return db.prepare("SELECT * FROM expediente_etapas WHERE id=?").get(id);
}
