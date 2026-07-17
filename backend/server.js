import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { PDFDocument } from "pdf-lib";
import db, { audit, now, runAuditContext } from "./db.js";
import { estructurarExpediente, extraerDatosForenses, extraerTextoDocumento, generarEscrito, resumirHistorialAcuerdos } from "./ai.js";
import { crearDocx, enviarPdf } from "./export.js";
import { installSecurity, securityStatus } from "./security.js";
import { crearRespaldo, listarRespaldos, rutaRespaldo, verificarRespaldo } from "./backup.js";
import { iniciarConsultaCartera, detenerConsultaCartera, obtenerConsulta, ultimaConsulta } from "./acuerdos-oficiales.js";
import { actualizarTarea, avisosTareas, cambiarEstadoTarea, crearDesdeAgenda, crearTarea, listarTareas, sincronizarEstadoAgenda, sincronizarEtapa } from "./tasks.js";
import { consolidarDuplicados, detectarDuplicados } from "./duplicates.js";
import { actualizarEtapa, asegurarEtapasDesdeCampos, cambiarEstadoEtapa, crearEtapa, listarEtapas } from "./stages.js";
import { appleReminder, disconnectGoogle, googleAuthorizationUrl, googleCallback, googleStatus, markTaskDirty, syncPending, syncTask } from "./calendar.js";

const app = express();
const appVersion = "0.27.0";
const uploadDir = path.resolve("uploads");
await fs.mkdir(uploadDir, { recursive: true });
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({ dest: uploadDir, limits: { fileSize: maxUploadMb * 1024 * 1024, files: 10 } });
const maxBackupMb = Number(process.env.MAX_BACKUP_MB || 2048);
const backupUpload = multer({ dest: uploadDir, limits: { fileSize: maxBackupMb * 1024 * 1024, files: 1 } });
const clases = new Set(["sentencia_primera_instancia", "convenio_cosa_juzgada", "sentencia_apelacion", "amparo_directo", "amparo_indirecto", "revision_amparo", "otro"]);
const analysisJobs = new Map();
const generationJobs = new Map();

app.use(express.json({ limit: "2mb" }));
installSecurity(app);
app.use((req, _res, next) => runAuditContext(req.sijolUser, next));
app.use(express.static("frontend",{setHeaders(res){res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");res.setHeader("Pragma","no-cache");}}));
app.get("/api/health", (_req, res) => res.json({ ok: true, version:appVersion, aiConfigured: Boolean(process.env.OPENAI_API_KEY), remoteMode:securityStatus.remoteMode }));

app.get("/api/dashboard", (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE estado_expediente<>'duplicado_archivado'").get().total;
  const incompletos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE calidad_datos='incompleto' OR campos_faltantes<>''").get().total;
  const activos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE estado_expediente='activo'").get().total;
  const suspendidos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE estado_expediente='suspendido'").get().total;
  const concluidos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE estado_expediente='concluido'").get().total;
  const tesauro = db.prepare("SELECT COUNT(*) total FROM tesauro_documentos WHERE estado='validado'").get().total;
  const proximos = db.prepare("SELECT a.*, e.numero expediente_numero FROM agenda a LEFT JOIN expedientes e ON e.id=a.expediente_id WHERE a.estado='pendiente' AND a.fecha>=date('now','localtime') ORDER BY a.fecha,a.hora LIMIT 8").all();
  const estados = db.prepare("SELECT COALESCE(NULLIF(estado_procesal,''),'Sin clasificar') nombre, COUNT(*) total FROM expedientes GROUP BY nombre ORDER BY total DESC LIMIT 8").all();
  res.json({ total, activos, suspendidos, concluidos, incompletos, tesauro, proximos, estados, avisos_tareas:avisosTareas() });
});

app.get("/api/clientes", (_req, res) => {
  const rows = db.prepare("SELECT * FROM expedientes WHERE estado_expediente<>'duplicado_archivado' ORDER BY cliente, actor, numero").all();
  const clientes = new Map();
  for (const row of rows) {
    const nombre = String(row.cliente || row.actor || '').trim();
    if (!nombre) continue;
    const key = nombre.toLocaleUpperCase('es-MX');
    if (!clientes.has(key)) clientes.set(key, { nombre, expedientes: [], contrapartes: new Set() });
    const cliente = clientes.get(key);
    cliente.expedientes.push({ id: row.id, numero: row.numero, asunto: row.asunto, estado_procesal: row.estado_procesal });
    const contraparte = String(row.contraparte || row.demandado || '').trim();
    if (contraparte) cliente.contrapartes.add(contraparte);
  }
  res.json([...clientes.values()].map(item => ({ ...item, contrapartes: [...item.contrapartes] })).sort((a,b) => a.nombre.localeCompare(b.nombre, 'es')));
});

app.get("/api/agenda", (_req, res) => res.json(db.prepare("SELECT a.*,e.numero expediente_numero FROM agenda a LEFT JOIN expedientes e ON e.id=a.expediente_id ORDER BY a.fecha,a.hora,a.id").all()));
app.post("/api/agenda", (req, res) => {
  const a = req.body;
  if (!String(a.titulo || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.fecha || ''))) return res.status(400).json({ error: "Título y fecha válida son obligatorios" });
  const t = now();
  const r = db.prepare("INSERT INTO agenda(expediente_id,titulo,fecha,hora,tipo,estado,notas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(a.expediente_id || null, a.titulo.trim(), a.fecha, a.hora || '', a.tipo || 'termino', 'pendiente', a.notas || '', t, t);
  audit('agenda', r.lastInsertRowid, 'crear', { expediente_id: a.expediente_id || null, titulo: a.titulo, fecha: a.fecha });
  crearDesdeAgenda(Number(r.lastInsertRowid));
  res.status(201).json(db.prepare("SELECT * FROM agenda WHERE id=?").get(r.lastInsertRowid));
});
app.patch("/api/agenda/:id/estado", (req, res) => {
  const estado = req.body.estado;
  if (!['pendiente','cumplido','cancelado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  const anterior = db.prepare("SELECT * FROM agenda WHERE id=?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: 'Evento no encontrado' });
  db.prepare("UPDATE agenda SET estado=?,updated_at=? WHERE id=?").run(estado, now(), req.params.id);
  sincronizarEstadoAgenda(Number(req.params.id),estado);
  audit('agenda', Number(req.params.id), 'cambiar_estado', { anterior: anterior.estado, nuevo: estado });
  res.json(db.prepare("SELECT * FROM agenda WHERE id=?").get(req.params.id));
});

app.get("/api/tareas",(req,res)=>res.json(listarTareas(req.query.estado||"pendiente",req.query.expediente_id||0)));
app.get("/api/tareas/avisos",(_req,res)=>res.json(avisosTareas()));
app.post("/api/tareas",(req,res)=>{if(!String(req.body.titulo||"").trim())return res.status(400).json({error:"El título es obligatorio"});res.status(201).json(crearTarea(req.body));});
app.patch("/api/tareas/:id",(req,res)=>{if(!String(req.body.titulo||"").trim())return res.status(400).json({error:"El título es obligatorio"});const tarea=actualizarTarea(req.params.id,req.body);if(tarea)markTaskDirty(req.params.id);return tarea?res.json(tarea):res.status(404).json({error:"Tarea no encontrada"});});
app.patch("/api/tareas/:id/estado",(req,res)=>{const tarea=cambiarEstadoTarea(req.params.id,req.body.estado);if(tarea)markTaskDirty(req.params.id);return tarea?res.json(tarea):res.status(400).json({error:"Tarea o estado inválido"});});

app.get("/api/integraciones/calendario",(_req,res)=>res.json(googleStatus()));
app.get("/api/integraciones/google/autorizar",(_req,res)=>{try{res.json({url:googleAuthorizationUrl()});}catch(error){res.status(400).json({error:error.message});}});
app.get("/api/integraciones/google/callback",async(req,res)=>{try{await googleCallback(req.query.code,req.query.state);res.redirect("/?google_calendar=conectado");}catch(error){res.status(400).type("html").send(`<h1>No fue posible conectar Google Calendar</h1><p>${String(error.message).replace(/[<>&]/g,"")}</p><p>Regrese a SIJ-OL e inténtelo nuevamente.</p>`);}});
app.delete("/api/integraciones/google",(_req,res)=>{disconnectGoogle();res.json({ok:true});});
app.post("/api/integraciones/google/sincronizar",async(_req,res)=>{try{res.json(await syncPending());}catch(error){res.status(400).json({error:error.message});}});
app.post("/api/tareas/:id/google-calendar",async(req,res)=>{try{res.json(await syncTask(req.params.id));}catch(error){res.status(400).json({error:error.message});}});
app.get("/api/tareas/:id/recordatorio-iphone",(req,res)=>{try{const result=appleReminder(req.params.id);db.prepare("UPDATE tareas SET apple_reminder_at=? WHERE id=?").run(now(),req.params.id);audit("tarea",Number(req.params.id),"enviar_recordatorios_iphone",{});res.json(result);}catch(error){res.status(400).json({error:error.message});}});

app.get("/api/documentos", (req, res) => {
  const expedienteId = Number(req.query.expediente_id || 0);
  const sql = `SELECT d.id,d.expediente_id,d.titulo,d.tipo,d.archivo_nombre,d.mime_type,d.tamano,d.sha256,d.version,d.notas,d.created_at,e.numero expediente_numero
    FROM expediente_documentos d JOIN expedientes e ON e.id=d.expediente_id
    ${expedienteId ? "WHERE d.expediente_id=?" : ""} ORDER BY d.created_at DESC,d.id DESC LIMIT 300`;
  res.json(expedienteId ? db.prepare(sql).all(expedienteId) : db.prepare(sql).all());
});

app.post("/api/documentos", upload.single("archivo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Debe seleccionar un archivo" });
    const expedienteId = Number(req.body.expediente_id || 0);
    const expediente = db.prepare("SELECT id,numero FROM expedientes WHERE id=?").get(expedienteId);
    if (!expediente) { await fs.unlink(req.file.path).catch(() => {}); return res.status(404).json({ error: "Expediente no encontrado" }); }
    const buffer = await fs.readFile(req.file.path);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const repetido = db.prepare("SELECT id,version FROM expediente_documentos WHERE expediente_id=? AND sha256=?").get(expedienteId, sha256);
    if (repetido) { await fs.unlink(req.file.path).catch(() => {}); return res.status(409).json({ error: `Este archivo ya está registrado como versión ${repetido.version}` }); }
    const titulo = String(req.body.titulo || req.file.originalname).trim();
    const version = Number(db.prepare("SELECT COALESCE(MAX(version),0)+1 version FROM expediente_documentos WHERE expediente_id=? AND titulo=?").get(expedienteId, titulo).version);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const destinoDir = path.join(uploadDir, `expediente-${expedienteId}`);
    await fs.mkdir(destinoDir, { recursive: true });
    const destino = path.join(destinoDir, `${Date.now()}-${sha256.slice(0,12)}${ext}`);
    await fs.rename(req.file.path, destino);
    const r = db.prepare("INSERT INTO expediente_documentos(expediente_id,titulo,tipo,archivo_nombre,archivo_ruta,mime_type,tamano,sha256,version,notas,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(expedienteId, titulo, req.body.tipo || "otro", req.file.originalname, destino, req.file.mimetype || "", req.file.size, sha256, version, req.body.notas || "", now());
    audit("documento", r.lastInsertRowid, "incorporar", { expediente_id: expedienteId, archivo: req.file.originalname, sha256, version });
    res.status(201).json({ id: r.lastInsertRowid, expediente_numero: expediente.numero, titulo, version, sha256 });
  } catch (error) { next(error); }
});

app.get("/api/documentos/:id/descargar", (req, res) => {
  const documento = db.prepare("SELECT * FROM expediente_documentos WHERE id=?").get(req.params.id);
  if (!documento) return res.status(404).json({ error: "Documento no encontrado" });
  res.download(path.resolve(documento.archivo_ruta), documento.archivo_nombre, error => { if (error && !res.headersSent) res.status(404).json({ error: "El archivo físico no está disponible" }); });
});

app.get("/api/expedientes", (req, res) => res.json(db.prepare(req.query.incluir_archivados==="1"?"SELECT * FROM expedientes ORDER BY updated_at DESC":"SELECT * FROM expedientes WHERE estado_expediente <> 'duplicado_archivado' ORDER BY updated_at DESC").all()));
app.get("/api/expedientes/duplicados", (_req, res) => res.json({grupos:detectarDuplicados()}));
app.post("/api/expedientes/duplicados/consolidar", (req, res, next) => {try{if(req.body.confirmacion!=="CONSOLIDAR")return res.status(400).json({error:"Confirme expresamente la consolidación"});res.json(consolidarDuplicados(req.body.claves||[]));}catch(error){next(error);}});
app.get("/api/expedientes/:id/etapas", (req,res) => res.json(listarEtapas(req.params.id)));
app.post("/api/expedientes/:id/etapas", (req,res,next) => {try{res.status(201).json(crearEtapa(Number(req.params.id),req.body));}catch(error){next(error);}});
app.patch("/api/etapas/:id", (req,res,next) => {try{const etapa=actualizarEtapa(Number(req.params.id),req.body);return etapa?res.json(etapa):res.status(404).json({error:"Etapa no encontrada"});}catch(error){next(error);}});
app.patch("/api/etapas/:id/estado", (req,res) => {const etapa=cambiarEstadoEtapa(Number(req.params.id),req.body.estado);return etapa?res.json(etapa):res.status(400).json({error:"Etapa o estado inválido"});});
app.patch("/api/expedientes/:id/estado", (req,res) => {const permitidos=new Set(["activo","suspendido","concluido","archivado","pendiente_numero"]),nuevo=String(req.body.estado||"");if(!permitidos.has(nuevo))return res.status(400).json({error:"Situación de expediente inválida"});const anterior=db.prepare("SELECT id,numero,estado_expediente FROM expedientes WHERE id=?").get(req.params.id);if(!anterior)return res.status(404).json({error:"Expediente no encontrado"});db.prepare("UPDATE expedientes SET estado_expediente=?,updated_at=? WHERE id=?").run(nuevo,now(),req.params.id);audit("expediente",Number(req.params.id),"cambiar_situacion",{anterior:anterior.estado_expediente,nuevo});res.json(db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id));});
app.post("/api/expedientes", (req, res) => {
  const e = req.body;
  if (!String(e.numero || "").trim()) return res.status(400).json({ error: "El numero de expediente es obligatorio" });
  const t = now();
  const estados=new Set(["activo","suspendido","concluido","archivado","pendiente_numero"]),estadoExpediente=estados.has(e.estado_expediente)?e.estado_expediente:"activo";
  const r = db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,demandado,juzgado,distrito_judicial,ciudad,estado_procesal,notas,etapa_proxima,proximo_termino,estado_expediente,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(e.numero.trim(), e.tipo_juicio || "", e.actor || "", e.demandado || "", e.juzgado || "", e.distrito_judicial || "", e.ciudad || "", e.estado_procesal || "", e.notas || "",e.etapa_proxima||"",e.proximo_termino||"",estadoExpediente, t, t);
  sincronizarEtapa(Number(r.lastInsertRowid),e.etapa_proxima,e.proximo_termino);
  asegurarEtapasDesdeCampos(Number(r.lastInsertRowid),e.estado_procesal,e.etapa_proxima,e.proximo_termino);
  audit("expediente", r.lastInsertRowid, "crear", e);
  res.status(201).json(db.prepare("SELECT * FROM expedientes WHERE id=?").get(r.lastInsertRowid));
});
app.put("/api/expedientes/:id", (req, res) => {
  const anterior = db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: "Expediente no encontrado" });
  const e = req.body;
  if (!String(e.numero || "").trim()) return res.status(400).json({ error: "El numero de expediente es obligatorio" });
  const numero = e.numero.trim();
  const estados=new Set(["activo","suspendido","concluido","archivado","pendiente_numero"]),solicitado=estados.has(e.estado_expediente)?e.estado_expediente:anterior.estado_expediente;
  const estadoExpediente = solicitado === "pendiente_numero" && !numero.startsWith("PENDIENTE-") ? "activo" : solicitado;
  db.prepare("UPDATE expedientes SET numero=?,tipo_juicio=?,actor=?,demandado=?,juzgado=?,distrito_judicial=?,ciudad=?,estado_procesal=?,notas=?,etapa_proxima=?,proximo_termino=?,estado_expediente=?,updated_at=? WHERE id=?")
    .run(numero, e.tipo_juicio || "", e.actor || "", e.demandado || "", e.juzgado || "", e.distrito_judicial || "", e.ciudad || "", e.estado_procesal || "", e.notas || "",e.etapa_proxima||"",e.proximo_termino||"", estadoExpediente, now(), req.params.id);
  sincronizarEtapa(Number(req.params.id),e.etapa_proxima,e.proximo_termino);
  asegurarEtapasDesdeCampos(Number(req.params.id),e.estado_procesal,e.etapa_proxima,e.proximo_termino);
  audit("expediente", Number(req.params.id), "editar", { anterior, nuevo: e });
  res.json(db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id));
});

app.post("/api/expedientes/ia/estructurar", async (req, res, next) => {
  try {
    const propuesta = await estructurarExpediente(req.body.narrativa);
    audit("expediente", null, "propuesta_ia", { campos_propuestos: Object.keys(propuesta).filter(key => propuesta[key]) });
    res.json({ propuesta, advertencia: "Propuesta pendiente de revisión humana; todavía no se ha guardado." });
  } catch (error) { next(error); }
});

app.get("/api/tesauro", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json(db.prepare("SELECT id,titulo,clase,organo,expediente_origen,fecha_resolucion,estado,archivo_nombre,created_at,updated_at FROM tesauro_documentos ORDER BY updated_at DESC").all());
  const term = `%${q}%`;
  res.json(db.prepare("SELECT id,titulo,clase,organo,expediente_origen,fecha_resolucion,estado,archivo_nombre,created_at,updated_at FROM tesauro_documentos WHERE titulo LIKE ? OR texto LIKE ? OR organo LIKE ? ORDER BY updated_at DESC LIMIT 50").all(term, term, term));
});

async function extraerTexto(file, onProgress = () => {}, isCancelled = () => false) {
  const ext = path.extname(file.originalname).toLowerCase();
  const data = await fs.readFile(file.path);
  if (ext === ".pdf") {
    onProgress({ fase:"Revisando si el PDF contiene texto", porcentaje:5 });
    const local = (await pdf(data)).text.trim();
    if (local.length >= 100) return { texto: local, metodo: "capa_texto_pdf" };
    onProgress({ fase:"Preparando páginas para OCR", porcentaje:10 });
    const original = await PDFDocument.load(data, { ignoreEncryption:true });
    const total = original.getPageCount();
    if (!total) throw new Error("El PDF no contiene páginas procesables");
    const partes = [], paginasPorBloque = 4;
    for (let inicio = 0; inicio < total; inicio += paginasPorBloque) {
      if (isCancelled()) throw new Error("Análisis cancelado por el usuario");
      const fin = Math.min(inicio + paginasPorBloque, total);
      const bloque = await PDFDocument.create();
      const indices = Array.from({ length:fin-inicio }, (_,i) => inicio+i);
      const paginas = await bloque.copyPages(original, indices);
      paginas.forEach(pagina => bloque.addPage(pagina));
      const buffer = Buffer.from(await bloque.save({ useObjectStreams:false }));
      onProgress({ fase:`Aplicando OCR a páginas ${inicio+1}-${fin} de ${total}`, porcentaje:Math.round(10 + (inicio/total)*78) });
      partes.push(await extraerTextoDocumento({ buffer, filename:`${path.parse(file.originalname).name}-paginas-${inicio+1}-${fin}.pdf`, mimeType:"application/pdf" }));
    }
    onProgress({ fase:"OCR terminado", porcentaje:90 });
    return { texto: partes.join("\n\n"), metodo: "ocr_openai_por_paginas" };
  }
  if (ext === ".docx") return { texto: (await mammoth.extractRawText({ buffer: data })).value, metodo: "docx" };
  if ([".txt", ".md"].includes(ext)) return { texto: data.toString("utf8"), metodo: "texto_plano" };
  throw new Error("Formato no admitido. Use PDF, DOCX, TXT o MD");
}

app.get("/api/acuerdos",(req,res)=>{const expedienteId=Number(req.query.expediente_id||0);if(!expedienteId)return res.status(400).json({error:"Seleccione un expediente"});res.json(db.prepare("SELECT id,expediente_id,fecha_publicacion,organo,secretaria,partes,tipo_asunto,numero_asunto,sintesis,texto,fuente_url,archivo_nombre,sha256,created_at FROM acuerdos_expediente WHERE expediente_id=? ORDER BY COALESCE(NULLIF(fecha_publicacion,''),created_at) DESC,id DESC").all(expedienteId));});
app.get("/api/acuerdos/consulta-cartera/ultima",(_req,res)=>res.json(ultimaConsulta()||{}));
app.post("/api/acuerdos/consulta-cartera",(_req,res)=>res.status(202).json({id:iniciarConsultaCartera()}));
app.get("/api/acuerdos/consulta-cartera/:id",(req,res)=>{const result=obtenerConsulta(req.params.id);return result?res.json(result):res.status(404).json({error:"Consulta no encontrada"});});
app.post("/api/acuerdos/consulta-cartera/:id/detener",(req,res)=>res.json({detenida:detenerConsultaCartera(req.params.id)}));
app.get("/api/acuerdos/consulta-cartera/:id/concentrado.csv",(req,res)=>{const result=obtenerConsulta(req.params.id);if(!result)return res.status(404).json({error:"Consulta no encontrada"});const escape=value=>`"${String(value??"").replaceAll('"','""')}"`,diario=result.modo==="diario",rows=diario?result.movimientos.map(row=>[row.fecha_publicacion,row.organo,row.secretaria,row.numero_asunto,row.tipo_asunto,row.partes||[row.actor,row.demandado].filter(Boolean).join(" VS "),row.sintesis].map(escape).join(",")):result.detalle.map(row=>[row.numero,row.actor,row.demandado,row.stj_organo_oficial||row.juzgado,row.estado,row.publicaciones,row.nuevas,row.ultima_fecha,row.mensaje].map(escape).join(",")),cabecera=diario?"fecha_publicacion,organo_judicial,secretaria,expediente,tipo_asunto,partes,sintesis":"expediente,actor,demandado,organo_judicial,resultado,publicaciones,nuevas,ultima_fecha,detalle",sufijo=diario?(result.fecha_consulta||"hoy"):`historico-${result.id}`;res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="SIJOL-resultados-listas-${sufijo}.csv"`);res.send("\uFEFF"+[cabecera,...rows].join("\r\n"));});
app.post("/api/acuerdos",upload.single("archivo"),async(req,res,next)=>{try{const expedienteId=Number(req.body.expediente_id||0),expediente=db.prepare("SELECT * FROM expedientes WHERE id=?").get(expedienteId);if(!expediente)return res.status(404).json({error:"Expediente no encontrado"});let texto=String(req.body.texto||"").trim(),archivoNombre="";if(req.file){const extraido=await extraerTexto(req.file);texto=[texto,extraido.texto].filter(Boolean).join("\n\n").trim();archivoNombre=req.file.originalname;}if(texto.length<20)return res.status(400).json({error:"Pegue el acuerdo o adjunte una lista con texto legible"});const fecha=String(req.body.fecha_publicacion||"");if(fecha&&!/^\d{4}-\d{2}-\d{2}$/.test(fecha))return res.status(400).json({error:"Fecha de publicación inválida"});const hash=crypto.createHash("sha256").update([expedienteId,fecha,texto].join("|")).digest("hex"),sintesis=String(req.body.sintesis||texto.replace(/\s+/g," ").slice(0,500)).trim();const r=db.prepare("INSERT INTO acuerdos_expediente(expediente_id,fecha_publicacion,organo,tipo_asunto,numero_asunto,sintesis,texto,fuente_url,archivo_nombre,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(expedienteId,fecha,req.body.organo||expediente.juzgado||"",req.body.tipo_asunto||"EXPEDIENTE",req.body.numero_asunto||expediente.numero,sintesis,texto,req.body.fuente_url||"https://stjsonora.gob.mx/Publicaciones/ListaAcuerdos",archivoNombre,hash,now());db.prepare("UPDATE expedientes SET ultima_actuacion=?,resumen_acuerdos='',updated_at=? WHERE id=?").run(fecha||now().slice(0,10),now(),expedienteId);audit("acuerdo",r.lastInsertRowid,"incorporar",{expediente_id:expedienteId,fecha_publicacion:fecha,archivo:archivoNombre,sha256:hash});res.status(201).json({id:Number(r.lastInsertRowid),sha256:hash,coincide_numero:texto.toLocaleLowerCase("es").includes(String(expediente.numero).toLocaleLowerCase("es"))});}catch(error){if(error.code==="SQLITE_CONSTRAINT_UNIQUE")return res.status(409).json({error:"Esta publicación ya está incorporada al expediente"});next(error);}finally{if(req.file)await fs.unlink(req.file.path).catch(()=>{});}});
app.get("/api/expedientes/:id/resumen-acuerdos",(req,res)=>{const expediente=db.prepare("SELECT id,numero,juzgado,ultima_actuacion,resumen_acuerdos FROM expedientes WHERE id=?").get(req.params.id);if(!expediente)return res.status(404).json({error:"Expediente no encontrado"});const total=db.prepare("SELECT COUNT(*) total FROM acuerdos_expediente WHERE expediente_id=?").get(req.params.id).total;res.json({...expediente,total});});
app.post("/api/expedientes/:id/resumen-acuerdos",async(req,res,next)=>{try{const expediente=db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id);if(!expediente)return res.status(404).json({error:"Expediente no encontrado"});const acuerdos=db.prepare("SELECT * FROM acuerdos_expediente WHERE expediente_id=? ORDER BY COALESCE(NULLIF(fecha_publicacion,''),created_at),id").all(req.params.id);if(!acuerdos.length)return res.status(400).json({error:"El expediente todavía no tiene listas de acuerdos incorporadas"});const generado=await resumirHistorialAcuerdos(expediente,acuerdos);db.prepare("UPDATE expedientes SET resumen_acuerdos=?,updated_at=? WHERE id=?").run(generado.texto,now(),req.params.id);audit("expediente",Number(req.params.id),"resumir_acuerdos",{publicaciones:acuerdos.length,modelo:generado.modelo,response_id:generado.responseId});res.json({resumen:generado.texto,total:acuerdos.length,modelo:generado.modelo});}catch(error){next(error);}});
app.get("/api/expedientes/:id/acuerdos.csv",(req,res)=>{const expediente=db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id);if(!expediente)return res.status(404).json({error:"Expediente no encontrado"});const rows=db.prepare("SELECT fecha_publicacion,organo,tipo_asunto,numero_asunto,sintesis,texto,fuente_url,archivo_nombre,sha256 FROM acuerdos_expediente WHERE expediente_id=? ORDER BY COALESCE(NULLIF(fecha_publicacion,''),created_at),id").all(req.params.id),escape=value=>`"${String(value||"").replaceAll('"','""')}"`;const csv=["fecha_publicacion,organo,tipo_asunto,numero_asunto,sintesis,texto_publicado,fuente_url,archivo_nombre,sha256",...rows.map(row=>Object.values(row).map(escape).join(","))].join("\r\n");res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="SIJOL-historico-${String(expediente.numero).replace(/[^a-zA-Z0-9_-]+/g,"-")}.csv"`);res.send("\uFEFF"+csv);});

app.post("/api/tesauro", upload.single("archivo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Debe adjuntar un archivo" });
    if (!clases.has(req.body.clase)) return res.status(400).json({ error: "Clase documental invalida" });
    const extraido = await extraerTexto(req.file);
    const texto = extraido.texto.trim();
    if (texto.length < 100) return res.status(400).json({ error: "No fue posible extraer texto suficiente" });
    const t = now();
    const r = db.prepare("INSERT INTO tesauro_documentos(titulo,clase,organo,expediente_origen,fecha_resolucion,estado,texto,archivo_nombre,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(req.body.titulo || req.file.originalname, req.body.clase, req.body.organo || "", req.body.expediente_origen || "", req.body.fecha_resolucion || "", "validado", texto, req.file.originalname, t, t);
    audit("tesauro", r.lastInsertRowid, "incorporar", { archivo: req.file.originalname, clase: req.body.clase, caracteres: texto.length, metodo_extraccion: extraido.metodo });
    res.status(201).json({ id: r.lastInsertRowid, titulo: req.body.titulo || req.file.originalname, caracteres: texto.length, metodo_extraccion: extraido.metodo });
  } catch (e) { next(e); }
});

async function procesarTrabajoAnalisis(jobId, files, expedienteId) {
  const job = analysisJobs.get(jobId);
  try {
    job.estado = "procesando";
    const anexos = [];
    for (let index=0; index<files.length; index++) {
      const file = files[index];
      const extraido = await extraerTexto(file, progreso => {
        const base = index / files.length * 85;
        job.porcentaje = Math.min(89, Math.round(base + progreso.porcentaje / files.length * 85 / 100));
        job.fase = `${file.originalname}: ${progreso.fase}`;
      }, () => job.cancelado);
      anexos.push({ nombre:file.originalname, texto:extraido.texto, metodo:extraido.metodo });
      await fs.unlink(file.path).catch(() => {});
    }
    if (job.cancelado) throw new Error("Análisis cancelado por el usuario");
    job.fase = "Identificando escritura, inmueble y datos registrales"; job.porcentaje = 92;
    const datos = await extraerDatosForenses(anexos);
    const r = db.prepare("INSERT INTO analisis_documentales(expediente_id,datos,anexos_texto,archivos,created_at) VALUES(?,?,?,?,?)")
      .run(expedienteId, JSON.stringify(datos), JSON.stringify(anexos), JSON.stringify(anexos.map(a => ({ nombre:a.nombre, metodo:a.metodo, caracteres:a.texto.length }))), now());
    audit("analisis_documental", r.lastInsertRowid, "extraer", { expediente_id:expedienteId, archivos:anexos.map(a=>a.nombre), campos:Object.keys(datos).filter(key=>datos[key]) });
    job.estado="completado"; job.porcentaje=100; job.fase="Análisis terminado";
    job.resultado={ id:Number(r.lastInsertRowid), datos, archivos:anexos.map(a=>({ nombre:a.nombre, metodo:a.metodo, caracteres:a.texto.length })) };
  } catch(error) {
    job.estado = job.cancelado ? "cancelado" : "error"; job.error = error.message; job.fase = error.message;
  } finally {
    for (const file of files) await fs.unlink(file.path).catch(() => {});
    setTimeout(() => analysisJobs.delete(jobId), 60*60*1000);
  }
}

app.post("/api/generaciones/analizar", upload.array("anexos", 10), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error:"Seleccione al menos un documento fuente" });
  const jobId = crypto.randomUUID();
  const expedienteId = Number(req.body.expediente_id || 0) || null;
  analysisJobs.set(jobId, { id:jobId, estado:"en_cola", porcentaje:0, fase:"Archivo recibido", cancelado:false });
  res.status(202).json({ job_id:jobId });
  setImmediate(() => procesarTrabajoAnalisis(jobId, req.files, expedienteId));
});

app.get("/api/generaciones/analizar/:jobId", (req, res) => {
  const job = analysisJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error:"Trabajo de análisis no encontrado o vencido" });
  res.json({ estado:job.estado, porcentaje:job.porcentaje, fase:job.fase, resultado:job.resultado, error:job.error });
});

app.delete("/api/generaciones/analizar/:jobId", (req, res) => {
  const job = analysisJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error:"Trabajo no encontrado" });
  job.cancelado = true; job.fase = "Cancelación solicitada";
  res.json({ cancelacion_solicitada:true });
});

async function procesarTrabajoGeneracion(jobId, body, files) {
  const job = generationJobs.get(jobId);
  try {
    job.estado="procesando"; job.porcentaje=5; job.fase="Validando expediente y datos confirmados";
    const pendiente = body.expediente_id === "__pendiente__";
    let expediente = pendiente ? {
      id: null, numero: "PENDIENTE DE ASIGNACIÓN JUDICIAL", tipo_juicio: body.tipo_escrito === "Demanda" ? "Por determinar" : "",
      actor: String(body.actor_pendiente || "").trim(), demandado: String(body.demandado_pendiente || "").trim(),
      juzgado: String(body.juzgado_pendiente || "").trim(), asunto: String(body.asunto_pendiente || "").trim(),
      estado_procesal: "Preparación de demanda", notas: "Número de expediente pendiente de asignación"
    } : db.prepare("SELECT * FROM expedientes WHERE id=?").get(body.expediente_id);
    if (!expediente) throw new Error("Expediente no encontrado");
    if (pendiente && !expediente.actor && !expediente.demandado && !expediente.asunto) throw new Error("Capture actor, demandado o asunto para abrir el expediente provisional");
    if (job.cancelado) throw new Error("Generación cancelada por el usuario");
    job.porcentaje=15; job.fase="Recuperando razonamientos del Tesauro";
    const terminos = String(body.terminos || body.tipo_escrito || "").split(/\s+/).filter(x => x.length > 3).slice(0, 6);
    const fuentes = [], seen = new Set();
    for (const termino of terminos) {
      for (const f of db.prepare("SELECT * FROM tesauro_documentos WHERE estado='validado' AND (titulo LIKE ? OR texto LIKE ?) LIMIT 3").all(`%${termino}%`, `%${termino}%`)) {
        if (!seen.has(f.id)) { fuentes.push(f); seen.add(f.id); }
      }
    }
    job.porcentaje=25; job.fase="Cargando el análisis documental confirmado";
    let anexos = [];
    if (body.analisis_id) {
      const analisis = db.prepare("SELECT * FROM analisis_documentales WHERE id=?").get(body.analisis_id);
      if (!analisis) throw new Error("El análisis documental no fue encontrado; vuelva a analizar los anexos");
      anexos = JSON.parse(analisis.anexos_texto);
    }
    for (const file of files || []) {
      const extraido = await extraerTexto(file);
      anexos.push({ nombre: file.originalname, texto: extraido.texto, metodo: extraido.metodo });
      await fs.unlink(file.path).catch(() => {});
    }
    const datosForenses = {
      proemio_institucional: {
        domicilio_procesal: "Calle Náinari número 1518 Poniente, entre Aguascalientes y Bacatete, colonia Cuauhtémoc, de Ciudad Obregón, Sonora",
        correo_notificaciones: "notificacionesjudicialesjaol@gmail.com",
        abogados_patronos: "José Alonso Ortiz Luna, cédula profesional 4951089, registro RUETYCP/3584; Jorge Alberto Vargas Juárez, cédula profesional 12891857",
        personas_autorizadas: "Aldo Gerson Rascón Iribarren; María del Rosario Campoy Díaz; Karla Fabiola Gálvez Higuera",
        alcance: "En los más amplios términos de los artículos 71, 72 y 174 del Código de Procedimientos Civiles para el Estado de Sonora, sujeto a verificación de vigencia"
      },
      personas_adicionales: body.personas_adicionales || "",
      datos_extraidos_confirmados: {
        nombre_actor: body.nombre_actor || "", numero_credito: body.numero_credito || "",
        escritura_numero: body.escritura_numero || "", volumen: body.volumen || "", fecha_escritura: body.fecha_escritura || "", notario: body.notario || "",
        descripcion_inmueble: body.descripcion_inmueble || "", clave_catastral: body.clave_catastral || "", folio_real: body.folio_real || "",
        inscripcion: body.inscripcion || "", libro: body.libro || "", seccion: body.seccion || "", fecha_registro: body.fecha_registro || "",
        ultimo_pago: body.ultimo_pago || "", otros_datos: body.otros_datos || ""
      },
      observaciones_extraccion: "Los datos_extraidos_confirmados fueron revisados por el usuario y deben prevalecer. Para el proemio y las notificaciones se utiliza exclusivamente el domicilio procesal institucional; el domicilio particular de la parte no se solicita ni se considera faltante."
    };
    if (job.cancelado) throw new Error("Generación cancelada por el usuario");
    job.porcentaje=45; job.fase="Elaborando la demanda con el motor jurídico";
    const generado = await generarEscrito({ expediente, tipoEscrito:body.tipo_escrito, instrucciones:body.instrucciones || "", fuentes:fuentes.slice(0,6), datosForenses, anexos, signal:job.controller.signal });
    if (job.cancelado) throw new Error("Generación cancelada por el usuario");
    job.porcentaje=88; job.fase="Validando y separando el control interno";
    if (pendiente) {
      const t = now();
      const referencia = `PENDIENTE-${t.slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-6)}`;
      const creado = db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,demandado,juzgado,distrito_judicial,ciudad,estado_procesal,notas,asunto,estado_expediente,calidad_datos,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(referencia, expediente.tipo_juicio, expediente.actor, expediente.demandado, expediente.juzgado, "", "", expediente.estado_procesal, expediente.notas, expediente.asunto, "pendiente_numero", "provisional", t, t);
      expediente = db.prepare("SELECT * FROM expedientes WHERE id=?").get(creado.lastInsertRowid);
      audit("expediente", expediente.id, "crear_provisional", { referencia, origen: "generador", pendiente_numero: true });
    }
    job.porcentaje=95; job.fase="Guardando el borrador y su trazabilidad";
    const r = db.prepare("INSERT INTO generaciones(expediente_id,tipo_escrito,instrucciones,resultado,modelo,fuentes,control_calidad,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(expediente.id, body.tipo_escrito, body.instrucciones || "", generado.texto, generado.modelo, JSON.stringify(fuentes.map(f => ({ id: f.id, titulo: f.titulo }))), generado.controlCalidad, now());
    audit("generacion", r.lastInsertRowid, "crear", { expediente_id: expediente.id, modelo: generado.modelo, response_id: generado.responseId, anexos: anexos.map(a => a.nombre) });
    job.estado="completado"; job.porcentaje=100; job.fase="Borrador terminado";
    job.resultado={ id:Number(r.lastInsertRowid), resultado:generado.texto, control_calidad:generado.controlCalidad, modelo:generado.modelo, fuentes:fuentes.map(f=>({id:f.id,titulo:f.titulo})), expediente:{ id:expediente.id, numero:expediente.numero, pendiente_numero:expediente.estado_expediente === "pendiente_numero" } };
  } catch(error) {
    job.estado=job.cancelado ? "cancelado" : "error"; job.error=job.cancelado ? "Generación cancelada por el usuario" : error.message; job.fase=job.error;
  } finally {
    for (const file of files || []) await fs.unlink(file.path).catch(() => {});
    setTimeout(() => generationJobs.delete(jobId), 60*60*1000);
  }
}

app.post("/api/generaciones", upload.array("anexos", 10), (req, res) => {
  const jobId=crypto.randomUUID();
  generationJobs.set(jobId,{ id:jobId, estado:"en_cola", porcentaje:0, fase:"Solicitud recibida", cancelado:false, controller:new AbortController() });
  res.status(202).json({ job_id:jobId });
  setImmediate(() => procesarTrabajoGeneracion(jobId, req.body, req.files || []));
});

app.get("/api/generaciones/proceso/:jobId", (req,res) => {
  const job=generationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error:"Proceso de generación no encontrado o vencido" });
  res.json({ estado:job.estado, porcentaje:job.porcentaje, fase:job.fase, resultado:job.resultado, error:job.error });
});

app.delete("/api/generaciones/proceso/:jobId", (req,res) => {
  const job=generationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error:"Proceso de generación no encontrado" });
  job.cancelado=true; job.fase="Deteniendo generación…"; job.controller.abort();
  res.json({ cancelacion_solicitada:true });
});

app.get("/api/generaciones", (_req, res) => {
  res.json(db.prepare(`SELECT g.id,g.expediente_id,g.tipo_escrito,g.modelo,g.created_at,g.aprobado_at,g.aprobado_por,e.numero expediente_numero,e.actor,e.cliente
    FROM generaciones g LEFT JOIN expedientes e ON e.id=g.expediente_id ORDER BY g.id DESC LIMIT 100`).all());
});

app.get("/api/generaciones/:id", (req, res) => {
  const row = db.prepare(`SELECT g.*,e.numero expediente_numero,e.actor,e.cliente FROM generaciones g LEFT JOIN expedientes e ON e.id=g.expediente_id WHERE g.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Borrador no encontrado" });
  res.json(row);
});

app.put("/api/generaciones/:id/borrador", (req, res) => {
  const generacion = db.prepare("SELECT * FROM generaciones WHERE id=?").get(req.params.id);
  if (!generacion) return res.status(404).json({ error: "Borrador no encontrado" });
  const texto = String(req.body.texto || "").trim();
  if (texto.length < 50) return res.status(400).json({ error: "El borrador parece incompleto" });
  db.prepare("UPDATE generaciones SET resultado=?,aprobado_at=NULL,aprobado_por='' WHERE id=?").run(texto, req.params.id);
  audit("generacion", Number(req.params.id), "guardar_borrador", { caracteres: texto.length, autorizacion_invalidada: Boolean(generacion.aprobado_at) });
  res.json({ id:Number(req.params.id), guardado:true, aprobado_at:null });
});

app.put("/api/generaciones/:id/aprobar", (req, res) => {
  const generacion = db.prepare("SELECT * FROM generaciones WHERE id=?").get(req.params.id);
  if (!generacion) return res.status(404).json({ error: "Borrador no encontrado" });
  const texto = String(req.body.texto || "").trim();
  const aprobadoPor = String(req.body.aprobado_por || "").trim();
  if (texto.length < 200) return res.status(400).json({ error: "El escrito final parece incompleto" });
  if (!aprobadoPor) return res.status(400).json({ error: "Indique quién autoriza el documento final" });
  const aprobadoAt = now();
  db.prepare("UPDATE generaciones SET resultado=?,aprobado_at=?,aprobado_por=? WHERE id=?").run(texto, aprobadoAt, aprobadoPor, req.params.id);
  audit("generacion", Number(req.params.id), "aprobar_final", { aprobado_por: aprobadoPor, aprobado_at: aprobadoAt });
  res.json({ id: Number(req.params.id), aprobado_at: aprobadoAt, aprobado_por: aprobadoPor });
});

app.get("/api/generaciones/:id/exportar/:formato", async (req, res, next) => {
  try {
    const generacion = db.prepare("SELECT g.*,e.numero FROM generaciones g LEFT JOIN expedientes e ON e.id=g.expediente_id WHERE g.id=?").get(req.params.id);
    if (!generacion) return res.status(404).json({ error: "Documento no encontrado" });
    if (!generacion.aprobado_at) return res.status(403).json({ error: "El documento requiere autorización humana final" });
    const base = `SIJOL-${generacion.tipo_escrito}-${generacion.numero || generacion.id}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
    if (req.params.formato === "docx") {
      const buffer = await crearDocx(generacion.resultado);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.docx"`);
      return res.send(buffer);
    }
    if (req.params.formato === "pdf") return enviarPdf(res, generacion.resultado, base);
    res.status(400).json({ error: "Formato no soportado" });
  } catch (error) { next(error); }
});

app.get("/api/auditoria", (_req, res) => res.json(db.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT 100").all()));
app.get("/api/respaldos", async (_req,res,next)=>{try{res.json(await listarRespaldos());}catch(error){next(error);}});
app.post("/api/respaldos",async(req,res,next)=>{try{const result=await crearRespaldo(String(req.body.password||""),appVersion);audit("respaldo",null,"crear",{nombre:result.nombre,tamano:result.tamano,archivos:result.archivos});res.status(201).json(result);}catch(error){next(error);}});
app.get("/api/respaldos/:nombre/descargar",(req,res)=>{const file=rutaRespaldo(req.params.nombre);if(!file)return res.status(400).json({error:"Nombre de respaldo inválido"});res.download(file,req.params.nombre,error=>{if(error&&!res.headersSent)res.status(404).json({error:"Respaldo no encontrado"});});});
app.post("/api/respaldos/verificar",backupUpload.single("respaldo"),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({error:"Seleccione un respaldo .sijolbak"});const result=await verificarRespaldo(req.file.path,String(req.body.password||""));audit("respaldo",null,"verificar",{archivo:req.file.originalname,valido:true,archivos:result.archivos});res.json(result);}catch(error){next(error);}finally{if(req.file)await fs.unlink(req.file.path).catch(()=>{});}});
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `El archivo supera el límite permitido (${err.field === "respaldo" ? maxBackupMb : maxUploadMb} MB)` });
  if (err?.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: "Puede adjuntar como máximo 10 archivos por generación" });
  res.status(500).json({ error: err.message || "Error interno" });
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`SIJ-OL disponible en http://${host}:${port}${securityStatus.remoteMode ? " · acceso autenticado" : " · solo local"}`));
