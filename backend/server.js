import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import db, { audit, now } from "./db.js";
import { estructurarExpediente, extraerTextoDocumento, generarEscrito } from "./ai.js";

const app = express();
const uploadDir = path.resolve("uploads");
await fs.mkdir(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 25 * 1024 * 1024 } });
const clases = new Set(["sentencia_primera_instancia", "convenio_cosa_juzgada", "sentencia_apelacion", "amparo_directo", "amparo_indirecto", "revision_amparo", "otro"]);

app.use(express.json({ limit: "2mb" }));
app.use(express.static("frontend"));
app.get("/api/health", (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));

app.get("/api/dashboard", (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) total FROM expedientes").get().total;
  const incompletos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE calidad_datos='incompleto' OR campos_faltantes<>''").get().total;
  const activos = db.prepare("SELECT COUNT(*) total FROM expedientes WHERE estado_expediente='activo'").get().total;
  const tesauro = db.prepare("SELECT COUNT(*) total FROM tesauro_documentos WHERE estado='validado'").get().total;
  const proximos = db.prepare("SELECT a.*, e.numero expediente_numero FROM agenda a LEFT JOIN expedientes e ON e.id=a.expediente_id WHERE a.estado='pendiente' AND a.fecha>=date('now','localtime') ORDER BY a.fecha,a.hora LIMIT 8").all();
  const estados = db.prepare("SELECT COALESCE(NULLIF(estado_procesal,''),'Sin clasificar') nombre, COUNT(*) total FROM expedientes GROUP BY nombre ORDER BY total DESC LIMIT 8").all();
  res.json({ total, activos, incompletos, tesauro, proximos, estados });
});

app.get("/api/clientes", (_req, res) => {
  const rows = db.prepare("SELECT * FROM expedientes ORDER BY cliente, actor, numero").all();
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
  res.status(201).json(db.prepare("SELECT * FROM agenda WHERE id=?").get(r.lastInsertRowid));
});
app.patch("/api/agenda/:id/estado", (req, res) => {
  const estado = req.body.estado;
  if (!['pendiente','cumplido','cancelado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  const anterior = db.prepare("SELECT * FROM agenda WHERE id=?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: 'Evento no encontrado' });
  db.prepare("UPDATE agenda SET estado=?,updated_at=? WHERE id=?").run(estado, now(), req.params.id);
  audit('agenda', Number(req.params.id), 'cambiar_estado', { anterior: anterior.estado, nuevo: estado });
  res.json(db.prepare("SELECT * FROM agenda WHERE id=?").get(req.params.id));
});

app.get("/api/expedientes", (_req, res) => res.json(db.prepare("SELECT * FROM expedientes ORDER BY updated_at DESC").all()));
app.post("/api/expedientes", (req, res) => {
  const e = req.body;
  if (!String(e.numero || "").trim()) return res.status(400).json({ error: "El numero de expediente es obligatorio" });
  const t = now();
  const r = db.prepare("INSERT INTO expedientes(numero,tipo_juicio,actor,demandado,juzgado,distrito_judicial,ciudad,estado_procesal,notas,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(e.numero.trim(), e.tipo_juicio || "", e.actor || "", e.demandado || "", e.juzgado || "", e.distrito_judicial || "", e.ciudad || "", e.estado_procesal || "", e.notas || "", t, t);
  audit("expediente", r.lastInsertRowid, "crear", e);
  res.status(201).json(db.prepare("SELECT * FROM expedientes WHERE id=?").get(r.lastInsertRowid));
});
app.put("/api/expedientes/:id", (req, res) => {
  const anterior = db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: "Expediente no encontrado" });
  const e = req.body;
  if (!String(e.numero || "").trim()) return res.status(400).json({ error: "El numero de expediente es obligatorio" });
  db.prepare("UPDATE expedientes SET numero=?,tipo_juicio=?,actor=?,demandado=?,juzgado=?,distrito_judicial=?,ciudad=?,estado_procesal=?,notas=?,updated_at=? WHERE id=?")
    .run(e.numero.trim(), e.tipo_juicio || "", e.actor || "", e.demandado || "", e.juzgado || "", e.distrito_judicial || "", e.ciudad || "", e.estado_procesal || "", e.notas || "", now(), req.params.id);
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

async function extraerTexto(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const data = await fs.readFile(file.path);
  if (ext === ".pdf") {
    const local = (await pdf(data)).text.trim();
    if (local.length >= 100) return { texto: local, metodo: "capa_texto_pdf" };
    const ocr = await extraerTextoDocumento({ buffer: data, filename: file.originalname, mimeType: file.mimetype || "application/pdf" });
    return { texto: ocr, metodo: "ocr_openai" };
  }
  if (ext === ".docx") return { texto: (await mammoth.extractRawText({ buffer: data })).value, metodo: "docx" };
  if ([".txt", ".md"].includes(ext)) return { texto: data.toString("utf8"), metodo: "texto_plano" };
  throw new Error("Formato no admitido. Use PDF, DOCX, TXT o MD");
}

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

app.post("/api/generaciones", async (req, res, next) => {
  try {
    const expediente = db.prepare("SELECT * FROM expedientes WHERE id=?").get(req.body.expediente_id);
    if (!expediente) return res.status(404).json({ error: "Expediente no encontrado" });
    const terminos = String(req.body.terminos || req.body.tipo_escrito || "").split(/\s+/).filter(x => x.length > 3).slice(0, 6);
    const fuentes = [], seen = new Set();
    for (const termino of terminos) {
      for (const f of db.prepare("SELECT * FROM tesauro_documentos WHERE estado='validado' AND (titulo LIKE ? OR texto LIKE ?) LIMIT 3").all(`%${termino}%`, `%${termino}%`)) {
        if (!seen.has(f.id)) { fuentes.push(f); seen.add(f.id); }
      }
    }
    const generado = await generarEscrito({ expediente, tipoEscrito: req.body.tipo_escrito, instrucciones: req.body.instrucciones || "", fuentes: fuentes.slice(0, 6) });
    const r = db.prepare("INSERT INTO generaciones(expediente_id,tipo_escrito,instrucciones,resultado,modelo,fuentes,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(expediente.id, req.body.tipo_escrito, req.body.instrucciones || "", generado.texto, generado.modelo, JSON.stringify(fuentes.map(f => ({ id: f.id, titulo: f.titulo }))), now());
    audit("generacion", r.lastInsertRowid, "crear", { expediente_id: expediente.id, modelo: generado.modelo, response_id: generado.responseId });
    res.status(201).json({ id: r.lastInsertRowid, resultado: generado.texto, modelo: generado.modelo, fuentes: fuentes.map(f => ({ id: f.id, titulo: f.titulo })) });
  } catch (e) { next(e); }
});

app.get("/api/auditoria", (_req, res) => res.json(db.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT 100").all()));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message || "Error interno" }); });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`SIJ-OL disponible en http://localhost:${port}`));
