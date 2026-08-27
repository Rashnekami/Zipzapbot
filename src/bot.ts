import makeWASocket,{DisconnectReason,downloadContentFromMessage,getContentType,useMultiFileAuthState,type WAMessage,type WASocket} from "@whiskeysockets/baileys";
import {Boom} from "@hapi/boom";
import {mkdir} from "node:fs/promises";
import {config} from "./config.js";
import {baileysLogger,logger} from "./logger.js";
import {updatePanel} from "./panel.js";
import {askAI} from "./ai/gateway.js";
import {addHistory,clearHistory,getHistory} from "./ai/history.js";
import {systemPrompt} from "./ai/persona.js";
import {moodStatus,processMood} from "./ai/mood.js";
import {transcribeAudio} from "./ai/transcription.js";
import {downloadUrl,lyrics,toMp3,toSticker} from "./media.js";
import qrcodeTerminal from "qrcode-terminal";
let lastQrPrintedAt=0;

function body(m:WAMessage){const x=m.message;if(!x)return "";return x.conversation||x.extendedTextMessage?.text||x.imageMessage?.caption||x.videoMessage?.caption||""}
function context(m:WAMessage){const x=m.message;return x?.extendedTextMessage?.contextInfo||x?.imageMessage?.contextInfo||x?.videoMessage?.contextInfo||x?.audioMessage?.contextInfo}
function mediaNode(m:WAMessage):any{const x=m.message as any;if(!x)return;const direct=[x.imageMessage,x.videoMessage,x.audioMessage,x.stickerMessage].find(Boolean);if(direct)return direct;const q=context(m)?.quotedMessage as any;return q&&[q.imageMessage,q.videoMessage,q.audioMessage,q.stickerMessage].find(Boolean)}
async function mediaBuffer(m:WAMessage){const node=mediaNode(m);if(!node)throw new Error("Responda a uma imagem, vídeo ou áudio");const kind=node.mimetype?.startsWith("image")?"image":node.mimetype?.startsWith("video")?"video":node.mimetype?.startsWith("audio")?"audio":"sticker";const stream=await downloadContentFromMessage(node,kind as any);const chunks:Buffer[]=[];for await(const c of stream)chunks.push(Buffer.from(c));return Buffer.concat(chunks)}
async function react(sock:WASocket,m:WAMessage,text:string){await sock.sendMessage(m.key.remoteJid!,{react:{text,key:m.key}})}
async function reply(sock:WASocket,m:WAMessage,text:string){await sock.sendMessage(m.key.remoteJid!,{text},{quoted:m})}
function myIds(sock:WASocket):string[]{const user=sock.user as any;return [user?.id,user?.lid].filter(Boolean).flatMap((id:string)=>[id,id.split(":")[0],id.split("@")[0]]).filter((id):id is string=>Boolean(id))}
function mentioned(m:WAMessage,sock:WASocket){const ids=myIds(sock);return Boolean(context(m)?.mentionedJid?.some(j=>ids.some(id=>j.startsWith(id))))}
function repliesToMe(m:WAMessage,sock:WASocket){const participant=context(m)?.participant||"";return myIds(sock).some(id=>participant.startsWith(id))}
function senderId(m:WAMessage):string{return String(m.key.participant||m.key.remoteJid||"desconhecido").split(":")[0]||"desconhecido"}
function senderName(m:WAMessage):string{return m.pushName||"Participante"}
function hasDirectAudio(m:WAMessage){return Boolean(m.message?.audioMessage)}
function hasAudio(m:WAMessage){const node=mediaNode(m);return Boolean(node&&(node.mimetype?.startsWith("audio/")||node.ptt))}
async function audioText(m:WAMessage){if(!hasAudio(m))throw new Error("Responda a um áudio com !ia");const mp3=await toMp3(await mediaBuffer(m));return transcribeAudio(mp3)}
async function answerAI(sock:WASocket,m:WAMessage,text:string){
 const jid=m.key.remoteJid!,name=senderName(m),mood=await processMood(senderId(m),name,text);
 if(mood.action==="ignore"){await react(sock,m,"😒");return}
 if(mood.reply)return reply(sock,m,mood.reply);
 addHistory(jid,{role:"user",content:jid.endsWith("@g.us")?`${name}: ${text}`:text});
 const prompt=mood.prompt?`${systemPrompt()}\n\nEstado atual:\n${mood.prompt}`:systemPrompt();
 const answer=await askAI([{role:"system",content:prompt},...getHistory(jid)]);
 addHistory(jid,{role:"assistant",content:answer});return reply(sock,m,answer);
}

async function command(sock:WASocket,m:WAMessage,text:string){const jid=m.key.remoteJid!;const [raw,...rest]=text.slice(config.PREFIX.length).trim().split(/\s+/);const cmd=raw?.toLowerCase(),arg=rest.join(" ");
 if(cmd==="ajuda"||cmd==="menu")return reply(sock,m,`*${config.BOT_NAME}*\n\n${config.PREFIX}ia pergunta — conversar com a IA\n${config.PREFIX}ia — respondendo um áudio, transcreve e responde\n${config.PREFIX}humor — ver como o bot está com você\n${config.PREFIX}fig — imagem/vídeo para figurinha\n${config.PREFIX}audio — vídeo/áudio para MP3\n${config.PREFIX}video URL — baixar vídeo\n${config.PREFIX}mp3 URL — baixar música\n${config.PREFIX}letra música/artista\n${config.PREFIX}reset — limpar memória da IA\n\nNo grupo, você também pode marcar o bot ou responder uma mensagem dele.`);
 if(cmd==="ia"){let question=arg;if(!question&&hasAudio(m)){await react(sock,m,"⏳");question=`[Áudio transcrito]: ${await audioText(m)}`;await react(sock,m,"✅")}if(!question)return reply(sock,m,`Use: ${config.PREFIX}ia sua pergunta ou responda um áudio com ${config.PREFIX}ia`);return answerAI(sock,m,question)}
 if(cmd==="humor"){const mood=await moodStatus(senderId(m),senderName(m));return reply(sock,m,mood.blocked?`Tô de mal contigo por mais ou menos ${mood.minutes} min 😒`:`Minha irritação contigo tá em ${mood.irritation}/${config.BOT_IRRITATION_THRESHOLD}. Se comporta 😂`)}
 if(cmd==="reset"){clearHistory(jid);return reply(sock,m,"Memória da IA limpa ✅")}
 if(cmd==="fig"){await react(sock,m,"⏳");const out=await toSticker(await mediaBuffer(m));await sock.sendMessage(jid,{sticker:out},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="audio"){await react(sock,m,"⏳");const out=await toMp3(await mediaBuffer(m));await sock.sendMessage(jid,{audio:out,mimetype:"audio/mpeg",ptt:false},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="mp3"||cmd==="video"){if(!/^https?:\/\//i.test(arg))throw new Error(`Use: ${config.PREFIX}${cmd} URL`);await react(sock,m,"⏳");const out=await downloadUrl(arg,cmd==="mp3");await sock.sendMessage(jid,cmd==="mp3"?{audio:out,mimetype:"audio/mpeg"}:{video:out,mimetype:"video/mp4"},{quoted:m});return react(sock,m,"✅")}
 if(cmd==="letra"){if(!arg)throw new Error(`Use: ${config.PREFIX}letra música e artista`);return reply(sock,m,await lyrics(arg))}
 return reply(sock,m,`Comando desconhecido. Use ${config.PREFIX}ajuda.`)
}
async function onMessage(sock:WASocket,m:WAMessage){if(!m.message||m.key.fromMe||!m.key.remoteJid)return;const jid=m.key.remoteJid;const group=jid.endsWith("@g.us");const text=body(m).trim();logger.info(`💬 ${text.startsWith(config.PREFIX)?"Comando":"Mensagem"} recebido • ${group?"grupo":"privado"}`);if(group&&!config.GROUPS_ENABLED)return;try{if(text.startsWith(config.PREFIX))return await command(sock,m,text);if(hasDirectAudio(m)){if(group&&!mentioned(m,sock)&&!repliesToMe(m,sock))return;await react(sock,m,"⏳");const transcript=await audioText(m);await react(sock,m,"✅");return await answerAI(sock,m,`[Áudio transcrito]: ${transcript}`)}const clean=text.replace(/@\d+/g,"").trim();if(!clean)return;if(group&&!mentioned(m,sock)&&!repliesToMe(m,sock)){addHistory(jid,{role:"user",content:`${senderName(m)}: ${clean}`});return}await answerAI(sock,m,clean)}catch(e){logger.error(`❌ ${e instanceof Error?e.message:String(e)}`);await react(sock,m,"❌");await reply(sock,m,"A IA deu uma travada aqui 😵‍💫 Tenta de novo em instantes.")}}
export async function startBot(){await mkdir(config.DATA_DIR,{recursive:true});const {state,saveCreds}=await useMultiFileAuthState(`${config.DATA_DIR}/auth`);const sock=makeWASocket({auth:state,logger:baileysLogger as any,printQRInTerminal:false,browser:[config.BOT_NAME,"Chrome","2.0.0"],syncFullHistory:false});sock.ev.on("creds.update",saveCreds);sock.ev.on("messages.upsert",({messages,type})=>{if(process.env.LOG_LEVEL==="debug")logger.debug({type,count:messages.length},"Evento de mensagens");for(const m of messages)void onMessage(sock,m)});sock.ev.on("connection.update",u=>{if(u.qr){updatePanel({qr:u.qr,status:"aguardando leitura do QR"});if(Date.now()-lastQrPrintedAt>=45000){lastQrPrintedAt=Date.now();qrcodeTerminal.generate(u.qr,{small:true},terminal=>console.log(`\n\x1b[33m📱 ESCANEIE ESTE QR NO WHATSAPP (ele expira):\x1b[0m\n${terminal}`))}}if(u.connection==="open"){lastQrPrintedAt=0;updatePanel({qr:"",status:"conectado"});logger.info("✅ WhatsApp conectado — bot pronto para receber mensagens")}if(u.connection==="close"){const code=(u.lastDisconnect?.error as Boom)?.output?.statusCode;updatePanel({qr:"",status:"desconectado"});if(code!==DisconnectReason.loggedOut){logger.warn({code},"⚠️ Conexão interrompida — reconectando em 3 segundos");setTimeout(()=>void startBot(),3000)}else logger.error("❌ Sessão encerrada — apague data/auth para gerar novo QR")}})}
