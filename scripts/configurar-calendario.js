import fs from "node:fs";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const file=".env.local",rl=readline.createInterface({input,output}),clientId=(await rl.question("Google OAuth Client ID: ")).trim(),clientSecret=(await rl.question("Google OAuth Client Secret: ")).trim();
rl.close();
if(!clientId.endsWith(".apps.googleusercontent.com")||clientSecret.length<10){console.error("Credenciales incompletas. No se modificó .env.local.");process.exit(1);}
const existing=fs.existsSync(file)?fs.readFileSync(file,"utf8"):"",values=new Map(existing.split(/\r?\n/).filter(line=>line&&!line.trim().startsWith("#")&&line.includes("=")).map(line=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1)];}));
values.set("GOOGLE_CALENDAR_CLIENT_ID",clientId);
values.set("GOOGLE_CALENDAR_CLIENT_SECRET",clientSecret);
if(!values.get("GOOGLE_TOKEN_ENCRYPTION_KEY"))values.set("GOOGLE_TOKEN_ENCRYPTION_KEY",crypto.randomBytes(32).toString("hex"));
values.set("GOOGLE_CALENDAR_REDIRECT_URI","http://127.0.0.1:3000/api/integraciones/google/callback");
values.set("GOOGLE_CALENDAR_ID",values.get("GOOGLE_CALENDAR_ID")||"primary");
values.set("GOOGLE_CALENDAR_PRIVACY",values.get("GOOGLE_CALENDAR_PRIVACY")||"minima");
fs.writeFileSync(file,[...values].map(([key,value])=>`${key}=${value}`).join("\n")+"\n",{mode:0o600});
fs.chmodSync(file,0o600);
console.log("Google Calendar quedó configurado. Reinicie SIJ-OL y pulse Conectar Google Calendar en Tareas.");
