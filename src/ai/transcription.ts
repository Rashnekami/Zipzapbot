import {config} from "../config.js";
import {logger} from "../logger.js";

async function detail(response:Response){const raw=await response.text();try{return (JSON.parse(raw) as any)?.error?.message||raw}catch{return raw}}
async function openAI(audio:Buffer){
 if(!config.OPENAI_API_KEY)throw new Error("OpenAI não configurada");
 const form=new FormData();form.append("model",config.OPENAI_TRANSCRIBE_MODEL);form.append("language","pt");form.append("file",new Blob([new Uint8Array(audio)],{type:"audio/mpeg"}),"audio.mp3");
 const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{authorization:`Bearer ${config.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(90_000)});
 if(!response.ok)throw new Error(`OpenAI transcrição HTTP ${response.status} — ${await detail(response)}`);
 const data=await response.json() as any;if(!data?.text)throw new Error("OpenAI retornou transcrição vazia");return String(data.text).trim();
}
async function gemini(audio:Buffer){
 if(!config.GEMINI_API_KEY)throw new Error("Gemini não configurado");
 const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;
 const body={contents:[{role:"user",parts:[{text:"Transcreva exatamente este áudio em português brasileiro. Retorne somente a transcrição, sem comentários."},{inlineData:{mimeType:"audio/mpeg",data:audio.toString("base64")}}]}]};
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000)});
 if(!response.ok)throw new Error(`Gemini transcrição HTTP ${response.status} — ${await detail(response)}`);
 const data=await response.json() as any;const text=data?.candidates?.[0]?.content?.parts?.map((part:any)=>part.text).join("");if(!text)throw new Error("Gemini retornou transcrição vazia");return String(text).trim();
}
export async function transcribeAudio(audio:Buffer){
 if(!config.AUDIO_TRANSCRIPTION_ENABLED)throw new Error("Transcrição de áudio desativada");
 if(audio.length>config.AUDIO_MAX_MB*1024*1024)throw new Error(`Áudio excede ${config.AUDIO_MAX_MB} MB`);
 try{const text=await openAI(audio);logger.info("🎙️ Áudio transcrito usando OpenAI");return text}catch(error){logger.warn(`⚠️ OpenAI não transcreveu — tentando Gemini`);logger.debug(error instanceof Error?error.message:String(error))}
 const text=await gemini(audio);logger.info("🎙️ Áudio transcrito usando Gemini");return text;
}
