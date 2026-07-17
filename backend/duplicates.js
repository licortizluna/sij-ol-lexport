import db, { audit, now } from "./db.js";

const normalizar = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const numeroCanonico = value => {
  const match = String(value || "").match(/(\d+)\s*\/\s*(\d{4})/);
  return match ? `${Number(match[1])}/${match[2]}` : normalizar(value);
};
const organoCanonico = row => String(row.stj_unidad_id || "").trim() ? `STJ:${row.stj_unidad_id}` : normalizar(row.stj_organo_oficial || row.juzgado);
const partesCanonicas = row => normalizar(`${row.actor || row.cliente} ${row.demandado || row.contraparte}`);
const valor = value => String(value ?? "").trim();
const camposInformativos = ["tipo_juicio","actor","demandado","juzgado","distrito_judicial","ciudad","estado_procesal","notas","cliente","contraparte","asunto","materia","tipo_procedimiento","riesgo","fecha_inicio","proximo_termino","numero_credito","abogado_responsable","ultima_actuacion","resumen_acuerdos","etapa_proxima","stj_unidad_id","stj_organo_oficial","stj_homologacion"];

function inventario(id) {
  const count = table => db.prepare(`SELECT COUNT(*) total FROM ${table} WHERE expediente_id=?`).get(id).total;
  return { documentos:count("expediente_documentos"), acuerdos:count("acuerdos_expediente"), tareas:count("tareas"), agenda:count("agenda"), etapas:count("expediente_etapas"), generaciones:count("generaciones"), analisis:count("analisis_documentales") };
}
function puntuacion(row, counts) {
  const completos = camposInformativos.filter(field => valor(row[field])).length;
  return counts.documentos * 100000 + counts.acuerdos * 1000 + counts.tareas * 100 + counts.etapas * 75 + counts.agenda * 50 + counts.generaciones * 20 + counts.analisis * 20 + completos;
}
function claveDuplicado(row) {
  const numero = numeroCanonico(row.numero), organo = organoCanonico(row);
  if (!numero) return "";
  if (organo) return `${numero}|${organo}`;
  const partes = partesCanonicas(row);
  return partes ? `${numero}|SIN_ORGANO|${partes}` : "";
}

export function detectarDuplicados() {
  const rows = db.prepare("SELECT * FROM expedientes WHERE estado_expediente <> 'duplicado_archivado' ORDER BY id").all(), grupos = new Map();
  for (const row of rows) { const key=claveDuplicado(row); if(!key)continue; if(!grupos.has(key))grupos.set(key,[]); grupos.get(key).push(row); }
  return [...grupos.entries()].filter(([,items])=>items.length>1).map(([clave,items])=>{
    const candidatos=items.map(row=>{const counts=inventario(row.id);return {...row,conteos:counts,puntuacion:puntuacion(row,counts)};}).sort((a,b)=>b.puntuacion-a.puntuacion||a.id-b.id),principal=candidatos[0];
    return { clave, numero:numeroCanonico(principal.numero), organo:principal.stj_organo_oficial||principal.juzgado||"Sin órgano", principal_id:principal.id, candidatos:candidatos.map(row=>({id:row.id,numero:row.numero,actor:row.actor||row.cliente,demandado:row.demandado||row.contraparte,juzgado:row.juzgado,estado_expediente:row.estado_expediente,conteos:row.conteos,sera_principal:row.id===principal.id})) };
  });
}

function completarPrincipal(principalId, secundarios) {
  const principal=db.prepare("SELECT * FROM expedientes WHERE id=?").get(principalId),cambios={};
  for(const field of camposInformativos){if(valor(principal[field]))continue;const encontrado=secundarios.map(row=>valor(row[field])).find(Boolean);if(encontrado)cambios[field]=encontrado;}
  if(!Object.keys(cambios).length)return;
  const assignments=Object.keys(cambios).map(field=>`${field}=?`).join(",");
  db.prepare(`UPDATE expedientes SET ${assignments},updated_at=? WHERE id=?`).run(...Object.values(cambios),now(),principalId);
}

function moverAcuerdos(origenId,destinoId) {
  const rows=db.prepare("SELECT id,sha256 FROM acuerdos_expediente WHERE expediente_id=?").all(origenId);let movidos=0,repetidos=0;
  for(const row of rows){const existe=db.prepare("SELECT id FROM acuerdos_expediente WHERE expediente_id=? AND sha256=?").get(destinoId,row.sha256);if(existe){db.prepare("DELETE FROM acuerdos_expediente WHERE id=?").run(row.id);repetidos++;}else{db.prepare("UPDATE acuerdos_expediente SET expediente_id=? WHERE id=?").run(destinoId,row.id);movidos++;}}
  return {movidos,repetidos};
}

export function consolidarDuplicados(claves=[]) {
  const seleccion=new Set((Array.isArray(claves)?claves:[]).map(String)),detectados=detectarDuplicados().filter(group=>!seleccion.size||seleccion.has(group.clave));
  if(!detectados.length)return {grupos:0,archivados:0,documentos_movidos:0,acuerdos_movidos:0,acuerdos_repetidos:0};
  const resultado={grupos:0,archivados:0,documentos_movidos:0,acuerdos_movidos:0,acuerdos_repetidos:0};
  db.exec("BEGIN IMMEDIATE");
  try{
    for(const group of detectados){const principalId=group.principal_id,secundarios=group.candidatos.filter(row=>row.id!==principalId).map(row=>db.prepare("SELECT * FROM expedientes WHERE id=?").get(row.id));completarPrincipal(principalId,secundarios);
      for(const secundario of secundarios){const docs=db.prepare("UPDATE expediente_documentos SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id).changes,acuerdos=moverAcuerdos(secundario.id,principalId),maxOrden=db.prepare("SELECT COALESCE(MAX(orden),0) valor FROM expediente_etapas WHERE expediente_id=?").get(principalId).valor;db.prepare("UPDATE expediente_etapas SET expediente_id=?,orden=orden+? WHERE expediente_id=?").run(principalId,maxOrden,secundario.id);db.prepare("UPDATE agenda SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id);db.prepare("UPDATE tareas SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id);db.prepare("UPDATE generaciones SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id);db.prepare("UPDATE analisis_documentales SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id);db.prepare("UPDATE consulta_cartera_detalle SET expediente_id=? WHERE expediente_id=?").run(principalId,secundario.id);const nota=`${valor(secundario.notas)}\n[SIJ-OL] Duplicado consolidado en expediente interno #${principalId} el ${now().slice(0,10)}.`.trim();db.prepare("UPDATE expedientes SET estado_expediente='duplicado_archivado',notas=?,updated_at=? WHERE id=?").run(nota,now(),secundario.id);audit("expediente",secundario.id,"archivar_duplicado",{principal_id:principalId,clave:group.clave,documentos_movidos:docs,acuerdos});resultado.archivados++;resultado.documentos_movidos+=docs;resultado.acuerdos_movidos+=acuerdos.movidos;resultado.acuerdos_repetidos+=acuerdos.repetidos;}
      audit("expediente",principalId,"consolidar_duplicados",{clave:group.clave,secundarios:secundarios.map(row=>row.id)});resultado.grupos++;}
    db.exec("COMMIT");return resultado;
  }catch(error){db.exec("ROLLBACK");throw error;}
}
