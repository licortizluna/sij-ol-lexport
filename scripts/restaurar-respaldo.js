import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin,stdout } from "node:process";

const file=process.argv[2];
if(!file){console.error("Uso: npm run restaurar -- /ruta/al/respaldo.sijolbak");process.exit(1);}
try{const response=await fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(800)});if(response.ok)throw new Error("Detenga SIJ-OL antes de restaurar");}catch(error){if(error.message==="Detenga SIJ-OL antes de restaurar")throw error;}
await fs.access(file);
const rl=readline.createInterface({input:stdin,output:stdout});
const confirmacion=await rl.question('Escriba RESTAURAR para sustituir la información actual: ');rl.close();
if(confirmacion!=="RESTAURAR"){console.log("Restauración cancelada");process.exit(0);}
async function hiddenQuestion(prompt){if(!stdin.isTTY)throw new Error("Ejecute la restauración desde una Terminal interactiva");stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding("utf8");return await new Promise((resolve,reject)=>{let value="";const onData=key=>{if(key==="\u0003"){cleanup();reject(new Error("Restauración cancelada"));}else if(key==="\r"||key==="\n"){cleanup();stdout.write("\n");resolve(value);}else if(key==="\u007f"){if(value){value=value.slice(0,-1);stdout.write("\b \b");}}else if(key>=" "){value+=key;stdout.write("•");}};function cleanup(){stdin.off("data",onData);stdin.setRawMode(false);stdin.pause();}stdin.on("data",onData);});}
const password=await hiddenQuestion("Contraseña del respaldo: ");
const { restaurarRespaldo }=await import("../backend/backup.js");
const packageJson=JSON.parse(await fs.readFile(new URL("../package.json",import.meta.url),"utf8"));
const result=await restaurarRespaldo(file,password,packageJson.version);
console.log(`Restauración terminada: ${result.archivos} archivo(s). Ya puede iniciar SIJ-OL.`);
