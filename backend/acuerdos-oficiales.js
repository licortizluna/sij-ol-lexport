import crypto from "node:crypto";
import db, { audit, now } from "./db.js";

const PORTAL = "https://stjsonora.gob.mx";
const LISTA_URL = `${PORTAL}/Publicaciones/ListaAcuerdos`;
const API_URL = `${PORTAL}/api/ListaAcuerdos.php`;
const jobs = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hoySonora = () => {const p=Object.fromEntries(new Intl.DateTimeFormat("en",{timeZone:"America/Hermosillo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}`;};
const normalizar = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const stopWords = new Set("JUZGADO DE DEL LA LO LOS LAS PRIMERA INSTANCIA DISTRITO JUDICIAL CON COMPETENCIA EN MATERIA MATERIAS SONORA".split(" "));
const tokens = value => new Set(normalizar(value).split(" ").filter(word => word.length > 1 && !stopWords.has(word)));

function similitud(a, b) {
  const left=tokens(a),right=tokens(b); if(!left.size||!right.size)return 0;
  let comunes=0; for(const token of left)if(right.has(token))comunes++;
  return (2*comunes)/(left.size+right.size);
}
function decodeHtml(value) { return String(value||"").replace(/&Aacute;/gi,"Á").replace(/&Eacute;/gi,"É").replace(/&Iacute;/gi,"Í").replace(/&Oacute;/gi,"Ó").replace(/&Uacute;/gi,"Ú").replace(/&Ntilde;/gi,"Ñ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))); }
function numeroPartes(numero){const match=String(numero||"").match(/(\d+)\s*\/\s*(\d{4})/);return match?{asunto:match[1],anio:match[2],clave:`${Number(match[1])}/${match[2]}`}:null;}
function fechaIso(value){const text=String(value||"");if(/^\d{4}-\d{2}-\d{2}/.test(text))return text.slice(0,10);return "";}

async function catalogoUnidades(signal) {
  const response=await fetch(LISTA_URL,{signal,headers:{Accept:"text/html","User-Agent":"SIJ-OL/0.20 consulta de cartera"}});
  if(!response.ok)throw new Error(`El portal oficial respondió ${response.status}`);
  const html=await response.text(),rows=[];
  const regex=/<option\s+([^>]*)>([\s\S]*?)<\/option>/gi; let match;
  while((match=regex.exec(html))){const attrs=match[1],id=(attrs.match(/value=["'](\d+)["']/i)||[])[1],text=decodeHtml(match[2].replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();if(!id||!text)continue;rows.push({id,nombre:text,ramo:(attrs.match(/data-ramo=["'](\d+)["']/i)||[])[1]||""});}
  const cookie=typeof response.headers.getSetCookie==="function"?response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; "):(response.headers.get("set-cookie")||"").split(";")[0];
  return {rows,cookie};
}
const aliasStj = [
  [/PRIMERO MIXTO.*ORAL.*MERCANTIL|PRIMERO MIXTO.*ARRENDAMIENTO/,"278"],[/SEGUNDO MIXTO.*ORAL.*MERCANTIL|SEGUNDO MIXTO.*ARRENDAMIENTO/,"146"],
  [/CUARTO.*CIVIL.*CAJEME/,"138"],[/PRIMERO.*CIVIL.*CAJEME/,"135"],[/SEGUNDO.*CIVIL.*CAJEME/,"136"],[/TERCERO.*CIVIL.*CAJEME/,"137"],
  [/PRIMERO.*FAMILIAR.*CAJEME/,"139"],[/SEGUNDO.*FAMILIAR.*CAJEME/,"140"],[/TERCERO.*FAMILIAR.*CAJEME/,"141"],[/FAMILIAR.*COMPETENCIA ESPECIALIZADA.*CAJEME/,"901"],
  [/PRIMERO.*CIVIL.*HUATABAMPO/,"179"],[/PRIMERO.*CIVIL.*NAVOJOA/,"184"],[/SEGUNDO.*CIVIL.*HERMOSILLO/,"153"]
];
function esFuenteExterna(nombre){const value=normalizar(nombre);return /JUZGADO.*DISTRITO.*CIRCUITO|DISTRITO DEL QUINTO CIRCUITO|QUINCUAGESIMO.*CIVIL/.test(value);}
function unidadPorId(catalogo,id){return catalogo.find(item=>String(item.id)===String(id));}
function guardarHomologacion(expediente,unidad,tipo){db.prepare("UPDATE expedientes SET stj_unidad_id=?,stj_organo_oficial=?,stj_homologacion=? WHERE id=?").run(unidad.id,unidad.nombre,tipo,expediente.id);}
function unidadPara(expediente,catalogo){
  if(esFuenteExterna(expediente.juzgado))return {fueraFuente:true,mensaje:"Órgano ajeno al catálogo del Poder Judicial del Estado de Sonora"};
  if(expediente.stj_unidad_id){const guardada=unidadPorId(catalogo,expediente.stj_unidad_id);if(guardada)return {...guardada,score:1,homologacion:"persistida"};}
  const nombre=normalizar(expediente.juzgado),ubicacion=normalizar(`${expediente.distrito_judicial} ${expediente.ciudad}`);
  for(const [patron,id] of aliasStj){if(patron.test(`${nombre} ${ubicacion}`)){const unidad=unidadPorId(catalogo,id);if(unidad){guardarHomologacion(expediente,unidad,"alias_oficial");return {...unidad,score:1,homologacion:"alias_oficial"};}}}
  let mejor=null;for(const unidad of catalogo){let score=similitud(expediente.juzgado,unidad.nombre);const ciudad=normalizar(expediente.ciudad),distrito=normalizar(expediente.distrito_judicial);if(ciudad&&normalizar(unidad.nombre).includes(ciudad))score+=0.08;if(distrito&&normalizar(unidad.nombre).includes(distrito))score+=0.08;if(!mejor||score>mejor.score)mejor={...unidad,score};}
  if(mejor&&mejor.score>=0.50){guardarHomologacion(expediente,mejor,"coincidencia_automatica");return {...mejor,homologacion:"coincidencia_automatica"};}return null;
}

async function consultarHistorico(expediente,unidad,signal,cookie){
  const numero=numeroPartes(expediente.numero);if(!numero)throw new Error("Número sin formato número/año");
  const params=new URLSearchParams({IdUnidad:unidad.id,TipoConsulta:"Asunto",IdCatTipoAsunto:"1",Asunto:numero.asunto,Anio:numero.anio,Bis:"0",IdCatGrupoRamo:"1"});
  return solicitar(params,signal,cookie);
}
async function consultarDia(unidad,fecha,signal,cookie){return solicitar(new URLSearchParams({IdUnidad:unidad.id,TipoConsulta:"Fecha",Fecha:fecha}),signal,cookie);}
async function solicitar(params,signal,cookie){
  for(let intento=0;intento<3;intento++){
    const response=await fetch(`${API_URL}?${params}`,{signal,headers:{Accept:"application/json, text/plain, */*","Accept-Language":"es-MX,es;q=0.9","User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36","Referer":LISTA_URL,"X-Requested-With":"XMLHttpRequest",...(cookie?{Cookie:cookie}:{})}});
    if(response.ok){const data=await response.json();if(data.error)throw new Error(String(data.error));return {data,fuente:`${LISTA_URL}?${params}`};}
    if(![403,429,500,502,503,504].includes(response.status)||intento===2)throw new Error(`Portal oficial: ${response.status}`);
    await sleep(intento===0?1800:4500);
  }
}

function guardarPublicaciones(expediente,unidad,resultado){
  const rows=Array.isArray(resultado.data.resultado)?resultado.data.resultado:[];let nuevas=0,ultima="";
  const insert=db.prepare("INSERT OR IGNORE INTO acuerdos_expediente(expediente_id,fecha_publicacion,organo,secretaria,partes,tipo_asunto,numero_asunto,sintesis,texto,fuente_url,archivo_nombre,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const row of rows){const fecha=fechaIso(row.Fecha),secretaria=String(row.Secretaria||"").trim(),partes=String(row.Partes||"").trim(),sintesis=String(row.Sintesis||"").trim(),texto=[secretaria?`Secretaría: ${secretaria}`:"",partes?`Partes: ${partes}`:"",sintesis].filter(Boolean).join("\n"),hash=crypto.createHash("sha256").update([expediente.id,fecha,normalizar(sintesis)].join("|")).digest("hex"),repetido=db.prepare("SELECT id FROM acuerdos_expediente WHERE expediente_id=? AND fecha_publicacion=? AND UPPER(TRIM(sintesis))=UPPER(TRIM(?)) LIMIT 1").get(expediente.id,fecha,sintesis);if(!repetido){const r=insert.run(expediente.id,fecha,unidad.nombre,secretaria,partes,row.TipoAsunto||"EXPEDIENTE",`${row.Asunto||""}/${row.Anio||""}`,sintesis,texto,resultado.fuente,"",hash,now());if(r.changes)nuevas++;}else{db.prepare("UPDATE acuerdos_expediente SET organo=?,secretaria=CASE WHEN secretaria='' THEN ? ELSE secretaria END,partes=CASE WHEN partes='' THEN ? ELSE partes END WHERE id=?").run(unidad.nombre,secretaria,partes,repetido.id);}if(fecha>ultima)ultima=fecha;}
  if(rows.length){const latest=[...rows].sort((a,b)=>String(b.Fecha||"").localeCompare(String(a.Fecha||"")))[0],total=db.prepare("SELECT COUNT(*) total FROM acuerdos_expediente WHERE expediente_id=?").get(expediente.id).total,resumen=`Histórico de listas: ${total} publicación(es). Última actuación publicada: ${fechaIso(latest.Fecha)||"fecha no identificada"}. ${String(latest.Sintesis||"").trim()}`;db.prepare("UPDATE expedientes SET ultima_actuacion=CASE WHEN ? > COALESCE(ultima_actuacion,'') THEN ? ELSE ultima_actuacion END,resumen_acuerdos=?,updated_at=? WHERE id=?").run(ultima,ultima,resumen,now(),expediente.id);}
  return {publicaciones:rows.length,nuevas,ultima};
}
function registrarDetalle(id,expediente,estado,{publicaciones=0,nuevas=0,ultima="",mensaje=""}={}){db.prepare("INSERT INTO consulta_cartera_detalle(consulta_id,expediente_id,estado,publicaciones,nuevas,ultima_fecha,mensaje,created_at) VALUES(?,?,?,?,?,?,?,?)").run(id,expediente.id,estado,publicaciones,nuevas,ultima,mensaje,now());actualizarTotales(id);}
function actualizarTotales(id){db.prepare(`UPDATE consultas_cartera SET procesados=(SELECT COUNT(*) FROM consulta_cartera_detalle WHERE consulta_id=?), encontrados=(SELECT COUNT(*) FROM consulta_cartera_detalle WHERE consulta_id=? AND publicaciones>0), nuevas_publicaciones=(SELECT COALESCE(SUM(nuevas),0) FROM consulta_cartera_detalle WHERE consulta_id=?), sin_coincidencia=(SELECT COUNT(*) FROM consulta_cartera_detalle WHERE consulta_id=? AND estado='sin_coincidencia'), errores=(SELECT COUNT(*) FROM consulta_cartera_detalle WHERE consulta_id=? AND estado IN ('error','sin_configuracion')) WHERE id=?`).run(id,id,id,id,id,id);}
function finalizar(id,controller){const cancelado=controller.signal.aborted?1:0;db.prepare("UPDATE consultas_cartera SET estado=?,cancelado=?,finished_at=? WHERE id=?").run(cancelado?"detenida":"terminada",cancelado,now(),id);actualizarTotales(id);audit("consulta_cartera",id,cancelado?"detener":"terminar",{});}

async function ejecutarHistorico(id,expedientes,catalogo,controller,cookie){
  for(const expediente of expedientes){if(controller.signal.aborted)break;try{const unidad=unidadPara(expediente,catalogo);if(unidad?.fueraFuente){registrarDetalle(id,expediente,"fuera_fuente",{mensaje:unidad.mensaje});continue;}if(!unidad){registrarDetalle(id,expediente,"sin_configuracion",{mensaje:"No se pudo relacionar el juzgado con el catálogo oficial"});continue;}const resultado=await consultarHistorico(expediente,unidad,controller.signal,cookie),guardado=guardarPublicaciones(expediente,unidad,resultado);registrarDetalle(id,expediente,guardado.publicaciones?"encontrado":"sin_coincidencia",{...guardado,mensaje:guardado.publicaciones?`${unidad.nombre} · ${unidad.homologacion||"coincidencia"}`:"Sin publicaciones en el portal"});await sleep(700);}catch(error){if(controller.signal.aborted)break;registrarDetalle(id,expediente,"error",{mensaje:error.message});}}
}
async function ejecutarDiario(id,expedientes,catalogo,fecha,controller,cookie){
  const grupos=new Map();
  for(const expediente of expedientes){const unidad=unidadPara(expediente,catalogo),numero=numeroPartes(expediente.numero);if(unidad?.fueraFuente){registrarDetalle(id,expediente,"fuera_fuente",{mensaje:unidad.mensaje});continue;}if(!unidad){registrarDetalle(id,expediente,"sin_configuracion",{mensaje:"No se pudo relacionar el juzgado con el catálogo oficial"});continue;}if(!numero){registrarDetalle(id,expediente,"error",{mensaje:"Número sin formato número/año"});continue;}const key=unidad.id;if(!grupos.has(key))grupos.set(key,{unidad,expedientes:[]});grupos.get(key).expedientes.push({expediente,numero});}
  for(const grupo of grupos.values()){if(controller.signal.aborted)break;try{const resultado=await consultarDia(grupo.unidad,fecha,controller.signal,cookie),rows=Array.isArray(resultado.data.resultado)?resultado.data.resultado:[],porAsunto=new Map();for(const row of rows){const key=`${Number(row.Asunto||0)}/${row.Anio||""}`;if(!porAsunto.has(key))porAsunto.set(key,[]);porAsunto.get(key).push(row);}for(const item of grupo.expedientes){const propios=porAsunto.get(item.numero.clave)||[],guardado=guardarPublicaciones(item.expediente,grupo.unidad,{...resultado,data:{...resultado.data,resultado:propios}});registrarDetalle(id,item.expediente,guardado.publicaciones?"encontrado":"sin_coincidencia",{...guardado,mensaje:guardado.publicaciones?"Movimiento publicado hoy":"Sin movimiento publicado hoy"});}await sleep(900);}catch(error){if(controller.signal.aborted)break;for(const item of grupo.expedientes)registrarDetalle(id,item.expediente,"error",{mensaje:error.message});}}
}

export function iniciarConsultaCartera(){
  const activa=db.prepare("SELECT id FROM consultas_cartera WHERE estado='ejecutando' ORDER BY id DESC LIMIT 1").get();if(activa)return activa.id;
  const expedientes=db.prepare("SELECT * FROM expedientes WHERE estado_expediente='activo' ORDER BY id").all(),historicoCompleto=Boolean(db.prepare("SELECT 1 FROM consultas_cartera WHERE modo='historico' AND estado='terminada' LIMIT 1").get()),modo=historicoCompleto?"diario":"historico",fecha=modo==="diario"?hoySonora():"",r=db.prepare("INSERT INTO consultas_cartera(estado,total,started_at,modo,fecha_consulta) VALUES('ejecutando',?,?,?,?)").run(expedientes.length,now(),modo,fecha),id=Number(r.lastInsertRowid),controller=new AbortController();jobs.set(id,controller);
  setImmediate(async()=>{try{const catalogoOficial=await catalogoUnidades(controller.signal);if(modo==="historico")await ejecutarHistorico(id,expedientes,catalogoOficial.rows,controller,catalogoOficial.cookie);else await ejecutarDiario(id,expedientes,catalogoOficial.rows,fecha,controller,catalogoOficial.cookie);finalizar(id,controller);}catch(error){db.prepare("UPDATE consultas_cartera SET estado='error',finished_at=? WHERE id=?").run(now(),id);audit("consulta_cartera",id,"error",{mensaje:error.message});}finally{jobs.delete(id);}});
  audit("consulta_cartera",id,"iniciar",{total:expedientes.length,modo,fecha});return id;
}
export function detenerConsultaCartera(id){const job=jobs.get(Number(id));if(job){job.abort();return true;}return false;}
export function obtenerConsulta(id){const run=db.prepare("SELECT * FROM consultas_cartera WHERE id=?").get(id);if(!run)return null;const detalle=db.prepare("SELECT d.*,e.numero,e.actor,e.demandado,e.juzgado,e.stj_organo_oficial FROM consulta_cartera_detalle d JOIN expedientes e ON e.id=d.expediente_id WHERE d.consulta_id=? ORDER BY d.id DESC LIMIT 300").all(id);const movimientos=run.modo==="diario"?db.prepare(`SELECT a.id,a.expediente_id,a.fecha_publicacion,a.organo,a.secretaria,a.partes,a.tipo_asunto,a.numero_asunto,a.sintesis,a.fuente_url,e.numero,e.actor,e.demandado FROM acuerdos_expediente a JOIN expedientes e ON e.id=a.expediente_id WHERE a.fecha_publicacion=? AND EXISTS(SELECT 1 FROM consulta_cartera_detalle d WHERE d.consulta_id=? AND d.expediente_id=a.expediente_id AND d.publicaciones>0) ORDER BY a.organo,a.secretaria,CAST(substr(a.numero_asunto,1,instr(a.numero_asunto,'/')-1) AS INTEGER),a.id`).all(run.fecha_consulta,id):[];return {...run,detalle,movimientos};}
export function ultimaConsulta(){const row=db.prepare("SELECT id FROM consultas_cartera ORDER BY id DESC LIMIT 1").get();return row?obtenerConsulta(row.id):null;}
