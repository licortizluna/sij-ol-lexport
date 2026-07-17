import test from "node:test";
import assert from "node:assert/strict";
import db, { audit, now, runAuditContext } from "../backend/db.js";
import { crearDocx } from "../backend/export.js";
import { consolidarDuplicados, detectarDuplicados } from "../backend/duplicates.js";
import { cambiarEstadoEtapa, crearEtapa, listarEtapas } from "../backend/stages.js";
import fs from "node:fs";

test("la base contiene las entidades nucleares de SIJ-OL", () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
  for (const expected of ["expedientes", "tesauro_documentos", "generaciones", "auditoria", "agenda", "expediente_documentos", "analisis_documentales", "acuerdos_expediente", "consultas_cartera", "consulta_cartera_detalle", "tareas", "expediente_etapas"]) assert.ok(names.includes(expected));
});

test("las tareas conservan origen, vencimiento y sincronización", () => {
  const columns = db.prepare("PRAGMA table_info(tareas)").all().map(row => row.name);
  for (const expected of ["expediente_id","agenda_id","origen","titulo","fecha_vencimiento","prioridad","estado","expediente_referencia","fecha_realizacion","importacion_hash","google_event_id","google_sync_estado","google_sync_at","google_sync_error","apple_reminder_at"]) assert.ok(columns.includes(expected));
  const consultas = db.prepare("PRAGMA table_info(consultas_cartera)").all().map(row => row.name);
  assert.ok(consultas.includes("modo"));
  assert.ok(consultas.includes("fecha_consulta"));
});

test("las integraciones de calendario protegen tokens y exponen controles de sincronización", () => {
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name),servidor=fs.readFileSync(new URL("../backend/server.js",import.meta.url),"utf8"),interfaz=fs.readFileSync(new URL("../frontend/index.html",import.meta.url),"utf8"),calendario=fs.readFileSync(new URL("../backend/calendar.js",import.meta.url),"utf8");
  assert.ok(names.includes("integraciones"));
  assert.match(calendario,/aes-256-gcm/);
  assert.match(calendario,/calendar\.events/);
  assert.match(calendario,/shortcuts:\/\/run-shortcut/);
  assert.match(servidor,/\/api\/tareas\/:id\/google-calendar/);
  assert.match(servidor,/\/api\/tareas\/:id\/recordatorio-iphone/);
  assert.match(interfaz,/Conectar Google Calendar/);
  assert.match(interfaz,/Configurar Recordatorios de iPhone/);
});

test("la carga privada contiene 145 tareas sin duplicados", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("../imports/privado/tareas-iniciales.json", import.meta.url), "utf8"));
  assert.equal(payload.formato, "SIJOL_TAREAS_IMPORTACION_V1");
  assert.equal(payload.tareas.length, 145);
  assert.equal(new Set(payload.tareas.map(item => item.importacion_hash)).size, 145);
  assert.equal(payload.tareas.filter(item => item.estado.toLowerCase() === "pendiente").length, 42);
  assert.equal(payload.tareas.filter(item => item.estado.toLowerCase() === "realizada").length, 103);
});

test("el editor de tareas no se estira con listas extensas", () => {
  const interfaz = fs.readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const estilos = fs.readFileSync(new URL("../frontend/modules.css", import.meta.url), "utf8");
  assert.match(interfaz, /class="task-layout"/);
  assert.match(interfaz, /class="card form-stack task-editor"/);
  assert.match(estilos, /\.task-layout\s*\{[^}]*align-items:start/);
  assert.match(estilos, /\.task-editor\s*\{[^}]*grid-auto-rows:max-content[^}]*align-content:start[^}]*height:max-content/);
});

test("las tareas se pueden buscar, editar y reabrir", () => {
  const interfaz = fs.readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const cliente = fs.readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
  const servidor = fs.readFileSync(new URL("../backend/server.js", import.meta.url), "utf8");
  assert.match(interfaz, /id="task-search"/);
  assert.match(interfaz, /id="task-cancel-edit"/);
  assert.match(cliente, /function editTask\(/);
  assert.match(cliente, /data-next-state="pendiente"/);
  assert.match(servidor, /app\.patch\("\/api\/tareas\/:id"/);
});

test("la consolidación conserva documentos y archiva el duplicado vacío", () => {
  const stamp=`PRUEBA-${Date.now()}`,t=now();
  const first=db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,demandado,juzgado,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("0099/2099","ORDINARIO",stamp,"CONTRAPARTE","JUZGADO DE PRUEBA",t,t).lastInsertRowid;
  const second=db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,demandado,juzgado,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("99 / 2099","ORDINARIO",stamp,"CONTRAPARTE","JUZGADO DE PRUEBA",t,t).lastInsertRowid;
  try{
    db.prepare("INSERT INTO expediente_documentos(expediente_id,titulo,archivo_nombre,archivo_ruta,sha256,created_at) VALUES(?,?,?,?,?,?)").run(second,"Documento conservado","prueba.pdf","/tmp/prueba.pdf",stamp,t);
    db.prepare("INSERT INTO tareas(expediente_id,titulo,created_at,updated_at) VALUES(?,?,?,?)").run(first,"Tarea por migrar",t,t);
    const group=detectarDuplicados().find(item=>item.candidatos.some(row=>row.id===Number(first)));
    assert.ok(group);
    assert.equal(group.principal_id,Number(second));
    const result=consolidarDuplicados([group.clave]);
    assert.equal(result.grupos,1);
    assert.equal(db.prepare("SELECT estado_expediente FROM expedientes WHERE id=?").get(first).estado_expediente,"duplicado_archivado");
    assert.equal(db.prepare("SELECT expediente_id FROM expediente_documentos WHERE sha256=?").get(stamp).expediente_id,Number(second));
    assert.equal(db.prepare("SELECT expediente_id FROM tareas WHERE titulo='Tarea por migrar'").get().expediente_id,Number(second));
  } finally {
    db.prepare("DELETE FROM auditoria WHERE entidad='expediente' AND entidad_id IN (?,?)").run(first,second);
    db.prepare("DELETE FROM expedientes WHERE id IN (?,?)").run(first,second);
  }
});

test("el control de etapas calcula avance y activa la etapa siguiente", () => {
  const stamp=`ETAPAS-${Date.now()}`,t=now(),expedienteId=db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,juzgado,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(stamp,"ORDINARIO","ACTOR","JUZGADO DE PRUEBA",t,t).lastInsertRowid;
  try{
    const primera=crearEtapa(Number(expedienteId),{titulo:"Demanda presentada",estado:"en_curso"});
    const segunda=crearEtapa(Number(expedienteId),{titulo:"Emplazamiento",fecha_objetivo:"2099-01-02"});
    cambiarEstadoEtapa(primera.id,"completada");
    const etapas=listarEtapas(expedienteId),actual=db.prepare("SELECT estado_procesal,etapa_proxima,proximo_termino FROM expedientes WHERE id=?").get(expedienteId);
    assert.equal(etapas.avance,50);
    assert.equal(etapas.rows.find(row=>row.id===segunda.id).estado,"en_curso");
    assert.equal(actual.etapa_proxima,"Emplazamiento");
    assert.equal(actual.proximo_termino,"2099-01-02");
  } finally {
    db.prepare("DELETE FROM auditoria WHERE entidad IN ('etapa','expediente') AND (entidad_id=? OR detalle LIKE ?)").run(expedienteId,`%${expedienteId}%`);
    db.prepare("DELETE FROM expedientes WHERE id=?").run(expedienteId);
  }
});

test("todos los selectores de expediente usan texto predictivo", () => {
  const interfaz=fs.readFileSync(new URL("../frontend/index.html",import.meta.url),"utf8"),cliente=fs.readFileSync(new URL("../frontend/app.js",import.meta.url),"utf8");
  for(const id of ["gen-exp","agenda-exp","task-exp","doc-exp","doc-filter","acuerdo-exp"])assert.match(interfaz,new RegExp(`id="${id}"`));
  assert.match(cliente,/function enhanceExpedienteSelect\(/);
  assert.match(cliente,/Escriba número, juzgado, actor o demandado/);
});

test("los expedientes permiten controlar su situación operativa", () => {
  const interfaz=fs.readFileSync(new URL("../frontend/index.html",import.meta.url),"utf8"),cliente=fs.readFileSync(new URL("../frontend/app.js",import.meta.url),"utf8"),servidor=fs.readFileSync(new URL("../backend/server.js",import.meta.url),"utf8");
  assert.match(interfaz,/name="estado_expediente"/);
  for(const estado of ["activo","suspendido","concluido","archivado","pendiente_numero"])assert.match(interfaz,new RegExp(`value="${estado}"`));
  assert.match(cliente,/id="detail-case-status"/);
  assert.match(servidor,/app\.patch\("\/api\/expedientes\/:id\/estado"/);
  assert.match(servidor,/WHERE estado_expediente='activo'/);
});

test("las listas de acuerdos se vinculan con expediente y conservan huella", () => {
  const columns = db.prepare("PRAGMA table_info(acuerdos_expediente)").all().map(row => row.name);
  for (const expected of ["expediente_id","fecha_publicacion","organo","secretaria","partes","sintesis","texto","fuente_url","sha256"]) assert.ok(columns.includes(expected));
  const expedienteColumns = db.prepare("PRAGMA table_info(expedientes)").all().map(row => row.name);
  assert.ok(expedienteColumns.includes("resumen_acuerdos"));
  for (const expected of ["stj_unidad_id","stj_organo_oficial","stj_homologacion"]) assert.ok(expedienteColumns.includes(expected));
});

test("la exportación Word produce un archivo OOXML válido", async () => {
  const archivo = await crearDocx("# DEMANDA\n\nC. JUEZ\n\nContenido procesal de prueba.");
  assert.equal(archivo.subarray(0, 2).toString(), "PK");
  assert.ok(archivo.length > 1000);
});

test("las correcciones pueden conservar trazabilidad", () => {
  runAuditContext("Abogado de prueba", () => audit("prueba", null, "verificar", { instante: now() }));
  const row = db.prepare("SELECT * FROM auditoria WHERE entidad='prueba' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.accion, "verificar");
  assert.match(row.detalle, /instante/);
  assert.equal(row.usuario, "Abogado de prueba");
});

test("la demanda usa domicilio procesal y no solicita domicilio particular", () => {
  const formulario = fs.readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const servidor = fs.readFileSync(new URL("../backend/server.js", import.meta.url), "utf8");
  const motor = fs.readFileSync(new URL("../backend/ai.js", import.meta.url), "utf8");
  assert.doesNotMatch(formulario, /name="domicilio_actor"/);
  assert.doesNotMatch(servidor, /body\.domicilio_actor/);
  assert.doesNotMatch(motor, /"domicilio_actor"/);
  assert.match(motor, /únicamente el domicilio procesal/);
});
