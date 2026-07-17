import crypto from "node:crypto";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin,stdout } from "node:process";
const rl=readline.createInterface({input:stdin,output:stdout});
const user=(await rl.question("Nombre del usuario administrador: ")).trim()||"Administrador";
rl.close();
async function hiddenQuestion(prompt){
  if(!stdin.isTTY) throw new Error("La contraseña debe configurarse desde una Terminal interactiva");
  stdout.write(prompt); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  return await new Promise((resolve,reject)=>{let value="";const onData=key=>{if(key==="\u0003"){cleanup();reject(new Error("Configuración cancelada"));}else if(key==="\r"||key==="\n"){cleanup();stdout.write("\n");resolve(value);}else if(key==="\u007f"){if(value){value=value.slice(0,-1);stdout.write("\b \b");}}else if(key>=" "){value+=key;stdout.write("•");}};function cleanup(){stdin.off("data",onData);stdin.setRawMode(false);stdin.pause();}stdin.on("data",onData);});
}
const password=await hiddenQuestion("Contraseña (mínimo 14 caracteres): ");
if(password.length<14){console.error("La contraseña debe tener al menos 14 caracteres.");process.exit(1);}
const salt=crypto.randomBytes(16).toString("hex"),hash=crypto.scryptSync(password,salt,64).toString("hex"),secret=crypto.randomBytes(48).toString("base64url");
await fs.writeFile(".env.security",`SIJOL_REMOTE_ACCESS=true\nSIJOL_USER=${user.replace(/[\r\n=]/g," ")}\nSIJOL_PASSWORD_HASH=scrypt$${salt}$${hash}\nSIJOL_SESSION_SECRET=${secret}\nSIJOL_SESSION_HOURS=8\nHOST=127.0.0.1\n`,{mode:0o600});
console.log("\nAcceso seguro configurado. No comparta ni suba .env.security a GitHub.");
