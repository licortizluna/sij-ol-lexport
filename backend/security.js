import crypto from "node:crypto";

const sessions = new Map();
const attempts = new Map();
const remoteMode = process.env.SIJOL_REMOTE_ACCESS === "true";
const passwordHash = process.env.SIJOL_PASSWORD_HASH || "";
const sessionSecret = process.env.SIJOL_SESSION_SECRET || "";
const sessionHours = Math.min(12, Math.max(1, Number(process.env.SIJOL_SESSION_HOURS || 8)));
const cookieName = "sijol_session";

if (remoteMode && (!/^scrypt\$/.test(passwordHash) || sessionSecret.length < 32)) throw new Error("Acceso remoto bloqueado: ejecute `npm run configurar:acceso`");
const parseCookies = (header="") => Object.fromEntries(header.split(";").map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf("=");return [v.slice(0,i),decodeURIComponent(v.slice(i+1))];}));
const sign = value => crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
function verifyPassword(password){const [,salt,expected]=passwordHash.split("$");if(!salt||!expected)return false;const actual=crypto.scryptSync(password,salt,64).toString("hex");const a=Buffer.from(actual,"hex"),b=Buffer.from(expected,"hex");return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function cookie(req,value,maxAge){const secure=req.secure||req.get("x-forwarded-proto")==="https";return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?"; Secure":""}`;}
function currentSession(req){if(!remoteMode)return {user:"local",csrf:"local",expiresAt:Infinity};const raw=parseCookies(req.headers.cookie)[cookieName]||"";const split=raw.lastIndexOf(".");if(split<1)return null;const id=raw.slice(0,split),signature=raw.slice(split+1),expected=sign(id);if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;const session=sessions.get(id);if(!session||session.expiresAt<=Date.now()){sessions.delete(id);return null;}return session;}

export function installSecurity(app){
  app.set("trust proxy","loopback"); app.disable("x-powered-by");
  app.use((req,res,next)=>{res.set({"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'","Cache-Control":req.path.startsWith("/api/")?"no-store":"no-cache"});next();});
  app.get("/api/session",(req,res)=>{const session=currentSession(req);if(!session)return res.status(401).json({error:"Autenticación requerida"});res.json({authenticated:true,user:session.user,csrf:session.csrf,remoteMode});});
  app.post("/api/login",(req,res)=>{if(!remoteMode)return res.json({authenticated:true,csrf:"local"});const key=String(req.ip||req.socket.remoteAddress||"desconocido"),state=attempts.get(key)||{failures:0,blockedUntil:0};if(state.blockedUntil>Date.now())return res.status(429).json({error:"Acceso bloqueado. Espere 15 minutos."});if(!verifyPassword(String(req.body?.password||""))){state.failures+=1;if(state.failures>=5){state.blockedUntil=Date.now()+15*60_000;state.failures=0;}attempts.set(key,state);return res.status(401).json({error:"Credenciales incorrectas"});}attempts.delete(key);const id=crypto.randomBytes(32).toString("base64url"),session={user:String(process.env.SIJOL_USER||"Administrador"),csrf:crypto.randomBytes(24).toString("base64url"),expiresAt:Date.now()+sessionHours*3600_000};sessions.set(id,session);res.setHeader("Set-Cookie",cookie(req,`${id}.${sign(id)}`,sessionHours*3600));res.json({authenticated:true,user:session.user,csrf:session.csrf});});
  app.post("/api/logout",(req,res)=>{const raw=parseCookies(req.headers.cookie)[cookieName]||"";sessions.delete(raw.split(".")[0]);res.setHeader("Set-Cookie",cookie(req,"",0));res.json({authenticated:false});});
  app.use((req,res,next)=>{if(!remoteMode){req.sijolUser="local";return next();}if(["/login.html","/login.js","/login.css","/styles.css","/api/integraciones/google/callback"].includes(req.path))return next();const session=currentSession(req);if(!session){if(req.path.startsWith("/api/"))return res.status(401).json({error:"Sesión vencida o no iniciada"});return res.redirect("/login.html");}if(!["GET","HEAD","OPTIONS"].includes(req.method)&&req.get("x-sijol-csrf")!==session.csrf)return res.status(403).json({error:"Validación de seguridad vencida; vuelva a iniciar sesión"});req.sijolUser=session.user;next();});
}
export const securityStatus={remoteMode,sessionHours};
