import makeWASocket,{DisconnectReason,downloadContentFromMessage,getContentType,useMultiFileAuthState,type WAMessage,type WASocket} from "@whiskeysockets/baileys";
import {Boom} from "@hapi/boom";
import {mkdir} from "node:fs/promises";
import {config} from "./config.js";
import {logger} from "./logger.js";
import {updatePanel} from "./panel.js";
import {askAI} from "./ai/gateway.js";
import {addHistory,clearHistory,getHistory} from "./ai/history.js";
import {downloadUrl,lyrics,toMp3,toSticker} from "./media.js";
import QRCode from "qrcode";

function body(m:WAMessage){const x=m.message;if(!x)return "";return x.conversation||x.extendedTextMessage?.text||x.imageMessage?.caption||x.videoMessage?.caption||""}
function context(m:WAMessage){const x=m.message;return x?.extendedTextMessage?.contextInfo||x?.imageMessage?.contextInfo||x?.videoMessage?.contextInfo}
function mediaNode(m:WAMessage):any{const x=m.message as any;if(!x)return;const direct=[x.imageMessage,x.videoMessage,x.audioMessage,x.stickerMessage].find(Boolean);if(direct)return direct;const q=context(m)?.quotedMessage as any;return q&&[q.imageMessage,q.videoMessage,q.audioMessage,q.stickerMessage].find(Boolean)}
async function mediaBuffer(m:WAMessage){const node=mediaNode(m);if(!node)throw new Error("Responda a uma imagem, vídeo ou áudio");const kind=node.mimetype?.startsWith("image")?"image":node.mimetype?.startsWith("video")?"video":node.mimetype?.startsWith("audio")?"audio":"sticker";const stream=await downloadContentFromMessage(node,kind as any);const chunks:Buffer[]=[];for await(const c of stream)chunks.push(Buffer.from(c));return Buffer.concat(chunks)}
async function react(sock:WASocket,m:WAMessage,text:string){await sock.sendMessage(m.key.remoteJid!,{react:{text,key:m.key}})}
async function reply(sock:WASocket,m:WAMessage,text:string){await sock.sendMessage(m.key.remoteJid!,{text},{quoted:m})}
function mentioned(m:WAMessage,sock:WASocket){const me=sock.user?.id?.split(":")[0];return Boolean(me&&context(m)?.mentionedJid?.some(j=>j.startsWith(me)))}
function repliesToMe(m:WAMessage,sock:WASocket){const me=sock.user?.id?.split(":")[0];return Boolean(me&&context(m)?.participant?.startsWith(me))}

async function command(sock:WASocket,m:WAMessage,text:string){const jid=m.key.remoteJid!;const [raw,...rest]=text.slice(config.PREFIX.length).trim().split(/\s+/);const cmd=raw?.toLowerCase(),arg=rest.join(" ");
 if(cmd==="ajuda"||cmd==="menu")return reply(sock,m,`*${config.BOT_NAME}*\n\n${config.PREFIX}fig — imagem/vídeo para figurinha\n${config.PREFIX}audio — vídeo/áudio para MP3\n${config.PREFIX}video URL — baixar vídeo\n${config.PREFIX}mp3 URL — baixar música\n${config.PREFIX}letra música/artista\n${config.PREFIX}reset — limpar memória da IA\n\nMarque o bot ou responda uma mensagem dele para conversar.`);
 if(cmd==="reset"){clearHistory(jid);return reply(sock,m,"Memória da IA limpa ✅")}
 if(cmd==="fig"){await react(sock,m,"⏳");const out=await toSticker(await mediaBuffer(m));await sock.sendMessage(jid,{sticker:out},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="audio"){await react(sock,m,"⏳");const out=await toMp3(await mediaBuffer(m));await sock.sendMessage(jid,{audio:out,mimetype:"audio/mpeg",ptt:false},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="mp3"||cmd==="video"){if(!/^https?:\/\//i.test(arg))throw new Error(`Use: ${config.PREFIX}${cmd} URL`);await react(sock,m,"⏳");const out=await downloadUrl(arg,cmd==="mp3");await sock.sendMessage(jid,cmd==="mp3"?{audio:out,mimetype:"audio/mpeg"}:{video:out,mimetype:"video/mp4"},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="letra"){if(!arg)throw new Error(`Use: ${config.PREFIX}letra música e artista`);return reply(sock,m,await lyrics(arg))}
 return reply(sock,m,`Comando desconhecido. Use ${config.PREFIX}ajuda.`)
}
async function onMessage(sock:WASocket,m:WAMessage){if(!m.message||m.key.fromMe||!m.key.remoteJid)return;const jid=m.key.remoteJid;const group=jid.endsWith("@g.us");if(group&&!config.GROUPS_ENABLED)return;const text=body(m).trim();try{if(text.startsWith(config.PREFIX))return await command(sock,m,text);if(group&&!mentioned(m,sock)&&!repliesToMe(m,sock))return;if(!group&&!repliesToMe(m,sock)&&!mentioned(m,sock))return;const clean=text.replace(/@\d+/g,"").trim();if(!clean)return;addHistory(jid,{role:"user",content:clean});const answer=await askAI([{role:"system",content:config.AI_SYSTEM_PROMPT},...getHistory(jid)]);addHistory(jid,{role:"assistant",content:answer});await reply(sock,m,answer)}catch(e){logger.error(e);await react(sock,m,"❌");await reply(sock,m,e instanceof Error?e.message:"Erro inesperado")}}
export async function startBot(){await mkdir(config.DATA_DIR,{recursive:true});const {state,saveCreds}=await useMultiFileAuthState(`${config.DATA_DIR}/auth`);const sock=makeWASocket({auth:state,logger:logger as any,printQRInTerminal:false,browser:[config.BOT_NAME,"Chrome","2.0.0"],syncFullHistory:false});sock.ev.on("creds.update",saveCreds);sock.ev.on("messages.upsert",({messages,type})=>{if(type==="notify")for(const m of messages)void onMessage(sock,m)});sock.ev.on("connection.update",u=>{if(u.qr){updatePanel({qr:u.qr,status:"aguardando leitura do QR"});QRCode.toString(u.qr,{type:"terminal",small:true} as any,(error,terminal)=>{if(error)logger.error(error);else console.log(`\nESCANEIE O QR CODE ABAIXO NO WHATSAPP:\n${terminal}`)})}if(u.connection==="open")updatePanel({qr:"",status:"conectado"});if(u.connection==="close"){const code=(u.lastDisconnect?.error as Boom)?.output?.statusCode;updatePanel({qr:"",status:"desconectado"});if(code!==DisconnectReason.loggedOut)setTimeout(()=>void startBot(),3000);else logger.error("Sessão desconectada; apague data/auth para gerar novo QR")}})}
