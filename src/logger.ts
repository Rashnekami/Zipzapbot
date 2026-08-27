import pino from "pino";
const pretty=pino.transport({target:"pino-pretty",options:{colorize:true,translateTime:"HH:MM:ss",ignore:"pid,hostname",singleLine:true,messageFormat:"{msg}"}});
export const logger=pino({level:process.env.LOG_LEVEL||"info",base:undefined},pretty);
export const baileysLogger=pino({level:process.env.LOG_LEVEL==="debug"?"debug":"silent"});
export function printBanner(){console.log("\x1b[36m"+String.raw`
███████╗██╗██████╗ ███████╗ █████╗ ██████╗ 
╚══███╔╝██║██╔══██╗╚══███╔╝██╔══██╗██╔══██╗
  ███╔╝ ██║██████╔╝  ███╔╝ ███████║██████╔╝
 ███╔╝  ██║██╔═══╝  ███╔╝  ██╔══██║██╔═══╝ 
███████╗██║██║     ███████╗██║  ██║██║     
╚══════╝╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     `+"\x1b[0m");console.log("\x1b[35m        WhatsApp Bot • Node.js 22 • Baileys\x1b[0m");console.log("\x1b[90m────────────────────────────────────────────────────\x1b[0m");console.log("\x1b[33m⚡ Iniciando o ZipZapBot...\x1b[0m\n")}
