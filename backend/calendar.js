import crypto from "node:crypto";
import db, { audit, now } from "./db.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const states = new Map();

const clientId = () => String(process.env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
const clientSecret = () => String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
const redirectUri = () => String(process.env.GOOGLE_CALENDAR_REDIRECT_URI || "http://127.0.0.1:3000/api/integraciones/google/callback").trim();
const calendarId = () => String(process.env.GOOGLE_CALENDAR_ID || "primary").trim();
const encryptionKey = () => crypto.createHash("sha256").update(String(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.SIJOL_SESSION_SECRET || "")).digest();
const canEncrypt = () => Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.SIJOL_SESSION_SECRET);

function encrypt(value) {
  if (!canEncrypt()) throw new Error("Falta GOOGLE_TOKEN_ENCRYPTION_KEY para proteger la autorización");
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey(),iv),body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
  return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),body.toString("base64url")].join(".");
}
function decrypt(value) {
  const [iv,tag,body]=String(value||"").split(".");
  if(!iv||!tag||!body) return null;
  const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8"));
}
function integration() { return db.prepare("SELECT * FROM integraciones WHERE proveedor='google_calendar'").get(); }
function saveTokens(tokens) {
  const current=integration(),stamp=now(),merged={...(current?.datos_cifrados?decrypt(current.datos_cifrados):{}),...tokens};
  db.prepare(`INSERT INTO integraciones(proveedor,estado,datos_cifrados,configuracion,ultimo_error,created_at,updated_at) VALUES('google_calendar','conectado',?,'{}','',?,?)
    ON CONFLICT(proveedor) DO UPDATE SET estado='conectado',datos_cifrados=excluded.datos_cifrados,ultimo_error='',updated_at=excluded.updated_at`).run(encrypt(merged),stamp,stamp);
}
function setError(message){const stamp=now();db.prepare(`INSERT INTO integraciones(proveedor,estado,ultimo_error,created_at,updated_at) VALUES('google_calendar','error',?,?,?) ON CONFLICT(proveedor) DO UPDATE SET estado='error',ultimo_error=excluded.ultimo_error,updated_at=excluded.updated_at`).run(String(message),stamp,stamp);}
async function tokenRequest(params){const response=await fetch(GOOGLE_TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)}),data=await response.json();if(!response.ok)throw new Error(data.error_description||data.error||"Google rechazó la autorización");return data;}
async function accessToken(){const row=integration();if(!row?.datos_cifrados)throw new Error("Google Calendar no está conectado");const tokens=decrypt(row.datos_cifrados);if(tokens.access_token&&Number(tokens.expires_at||0)>Date.now()+60_000)return tokens.access_token;if(!tokens.refresh_token)throw new Error("Google no entregó autorización renovable; vuelva a conectar");const fresh=await tokenRequest({client_id:clientId(),client_secret:clientSecret(),refresh_token:tokens.refresh_token,grant_type:"refresh_token"});fresh.expires_at=Date.now()+Number(fresh.expires_in||3600)*1000;saveTokens(fresh);return fresh.access_token;}
async function google(path,options={}){const response=await fetch(`${GOOGLE_API}${path}`,{...options,headers:{Authorization:`Bearer ${await accessToken()}`,"Content-Type":"application/json",...(options.headers||{})}}),data=response.status===204?{}:await response.json();if(!response.ok)throw new Error(data.error?.message||"No fue posible sincronizar con Google Calendar");return data;}

export function googleStatus(){const row=integration();return {configured:Boolean(clientId()&&clientSecret()&&canEncrypt()),connected:row?.estado==="conectado",estado:row?.estado||"desconectado",ultimo_error:row?.ultimo_error||"",redirect_uri:redirectUri(),calendar_id:calendarId(),privacy:process.env.GOOGLE_CALENDAR_PRIVACY==="completa"?"completa":"minima"};}
export function googleAuthorizationUrl(){if(!clientId()||!clientSecret())throw new Error("Configure GOOGLE_CALENDAR_CLIENT_ID y GOOGLE_CALENDAR_CLIENT_SECRET");if(!canEncrypt())throw new Error("Configure GOOGLE_TOKEN_ENCRYPTION_KEY");const state=crypto.randomBytes(24).toString("base64url");states.set(state,Date.now()+10*60_000);return `${GOOGLE_AUTH}?${new URLSearchParams({client_id:clientId(),redirect_uri:redirectUri(),response_type:"code",scope:SCOPES,access_type:"offline",prompt:"consent",state}).toString()}`;}
export async function googleCallback(code,state){const expires=states.get(String(state));states.delete(String(state));if(!expires||expires<Date.now())throw new Error("La autorización venció o no fue iniciada desde SIJ-OL");const tokens=await tokenRequest({client_id:clientId(),client_secret:clientSecret(),code:String(code||""),grant_type:"authorization_code",redirect_uri:redirectUri()});tokens.expires_at=Date.now()+Number(tokens.expires_in||3600)*1000;saveTokens(tokens);audit("integracion",null,"conectar_google_calendar",{calendar_id:calendarId()});}
export function disconnectGoogle(){db.prepare("DELETE FROM integraciones WHERE proveedor='google_calendar'").run();db.prepare("UPDATE tareas SET google_sync_estado='sin_sincronizar',google_sync_error='' ").run();audit("integracion",null,"desconectar_google_calendar",{});}

function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function eventFor(row){const number=row.expediente_numero||row.expediente_referencia||"Sin expediente",minimal=process.env.GOOGLE_CALENDAR_PRIVACY!=="completa";const summary=`${row.estado==="cumplido"?"✓ ":""}SIJ-OL · ${number} · ${row.titulo}`;const description=minimal?`Tarea jurídica administrada por SIJ-OL. Expediente: ${number}.`:[`Expediente: ${number}`,row.juzgado?`Órgano: ${row.juzgado}`:"",row.actor?`Actor/promovente: ${row.actor}`:"",row.demandado?`Contraparte: ${row.demandado}`:"",row.notas?`Notas: ${row.notas}`:""].filter(Boolean).join("\n");const event={summary,description,status:"confirmed",reminders:{useDefault:false,overrides:[{method:"popup",minutes:1440},{method:"popup",minutes:60}]},extendedProperties:{private:{sijol_tarea_id:String(row.id)}}};if(row.hora){const start=new Date(`${row.fecha_vencimiento}T${row.hora}:00-07:00`),end=new Date(start.getTime()+30*60_000);event.start={dateTime:start.toISOString(),timeZone:"America/Hermosillo"};event.end={dateTime:end.toISOString(),timeZone:"America/Hermosillo"};}else{event.start={date:row.fecha_vencimiento};event.end={date:addDays(row.fecha_vencimiento,1)};}return event;}
function task(id){return db.prepare(`SELECT t.*,e.numero expediente_numero,e.juzgado,e.actor,e.demandado FROM tareas t LEFT JOIN expedientes e ON e.id=t.expediente_id WHERE t.id=?`).get(id);}
export async function syncTask(id){const row=task(id);if(!row)throw new Error("Tarea no encontrada");if(!/^\d{4}-\d{2}-\d{2}$/.test(row.fecha_vencimiento))throw new Error("La tarea necesita una fecha válida para sincronizarse");try{const body=JSON.stringify(eventFor(row));let event;if(row.google_event_id){try{event=await google(`/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(row.google_event_id)}`,{method:"PUT",body});}catch(error){if(!/not found|deleted/i.test(error.message))throw error;event=null;}}if(!event)event=await google(`/calendars/${encodeURIComponent(calendarId())}/events`,{method:"POST",body});db.prepare("UPDATE tareas SET google_event_id=?,google_sync_estado='sincronizado',google_sync_at=?,google_sync_error='' WHERE id=?").run(event.id,now(),id);audit("tarea",Number(id),"sincronizar_google_calendar",{event_id:event.id});return task(id);}catch(error){db.prepare("UPDATE tareas SET google_sync_estado='error',google_sync_error=? WHERE id=?").run(error.message,id);setError(error.message);throw error;}}
export async function syncPending(){const rows=db.prepare("SELECT id FROM tareas WHERE estado='pendiente' AND fecha_vencimiento<>'' AND google_sync_estado<>'sincronizado' ORDER BY fecha_vencimiento LIMIT 300").all(),result={total:rows.length,ok:0,errores:[]};for(const row of rows){try{await syncTask(row.id);result.ok++;}catch(error){result.errores.push({id:row.id,error:error.message});}}return result;}
export function markTaskDirty(id){db.prepare("UPDATE tareas SET google_sync_estado=CASE WHEN google_event_id<>'' THEN 'pendiente_actualizacion' ELSE 'sin_sincronizar' END WHERE id=?").run(id);}

export function appleReminder(taskId){const row=task(taskId);if(!row)throw new Error("Tarea no encontrada");if(!/^\d{4}-\d{2}-\d{2}$/.test(row.fecha_vencimiento))throw new Error("La tarea necesita una fecha válida");const payload={titulo:`SIJ-OL · ${row.expediente_numero||row.expediente_referencia||"Sin expediente"} · ${row.titulo}`,fecha:row.fecha_vencimiento,hora:row.hora||"09:00",notas:`Expediente: ${row.expediente_numero||row.expediente_referencia||"Sin expediente"}${row.notas?`\n${row.notas}`:""}`};const input=encodeURIComponent(JSON.stringify(payload)),name=encodeURIComponent(process.env.APPLE_SHORTCUT_NAME||"SIJ-OL Recordatorio");return {payload,shortcut_url:`shortcuts://run-shortcut?name=${name}&input=text&text=${input}`,shortcut_name:process.env.APPLE_SHORTCUT_NAME||"SIJ-OL Recordatorio"};}
