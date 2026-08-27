import {config} from "../config.js";
import {logger} from "../logger.js";

export type ChatMessage={role:"system"|"user"|"assistant";content:string};
type Provider={name:string;run(messages:ChatMessage[]):Promise<string>};

async function errorDetail(response:Response){
 const raw=await response.text();
 try{return (JSON.parse(raw) as any)?.error?.message||raw}catch{return raw}
}

async function compatible(name:string,base:string,key:string,model:string,messages:ChatMessage[]){
 const response=await fetch(`${base}/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify({model,messages,temperature:.7,max_tokens:800}),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`${name}: HTTP ${response.status} — ${await errorDetail(response)}`);
 const data=await response.json() as any;
 const text=data?.choices?.[0]?.message?.content;
 if(!text)throw new Error(`${name}: resposta vazia`);
 return String(text).trim();
}

async function openAI(messages:ChatMessage[]){
 const instructions=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
 const input=messages.filter(x=>x.role!=="system").map(x=>({role:x.role,content:x.content}));
 const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${config.OPENAI_API_KEY!}`},body:JSON.stringify({model:config.OPENAI_MODEL,instructions,input,reasoning:{effort:"none"},max_output_tokens:800}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`openai: HTTP ${response.status} — ${await errorDetail(response)}`);
 const data=await response.json() as any;
 const text=data?.output_text||data?.output?.flatMap((item:any)=>item?.content||[]).filter((part:any)=>part?.type==="output_text").map((part:any)=>part.text).join("");
 if(!text)throw new Error("openai: resposta vazia");
 return String(text).trim();
}

async function gemini(messages:ChatMessage[]){
 const system=messages.find(x=>x.role==="system")?.content;
 const contents=messages.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:x.content}]}));
 const models=[config.GEMINI_MODEL,"gemini-2.5-flash"].filter((model,index,list)=>list.indexOf(model)===index);
 const failures:string[]=[];
 for(const model of models){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY!)}`;
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({systemInstruction:system?{parts:[{text:system}]}:undefined,contents,generationConfig:{temperature:.8,maxOutputTokens:800}}),signal:AbortSignal.timeout(60000)});
  if(!response.ok){failures.push(`${model}: HTTP ${response.status} — ${await errorDetail(response)}`);continue}
  const data=await response.json() as any;
  const text=data?.candidates?.[0]?.content?.parts?.map((part:any)=>part.text).join("");
  if(text)return String(text).trim();
  failures.push(`${model}: resposta vazia`);
 }
 throw new Error(`gemini: ${failures.join(" | ")}`);
}

function list():Provider[]{
 const map:Record<string,Provider|undefined>={
  openai:config.OPENAI_API_KEY?{name:"openai",run:openAI}:undefined,
  gemini:config.GEMINI_API_KEY?{name:"gemini",run:gemini}:undefined,
  groq:config.GROQ_API_KEY?{name:"groq",run:m=>compatible("groq","https://api.groq.com/openai/v1",config.GROQ_API_KEY!,config.GROQ_MODEL,m)}:undefined,
  openrouter:config.OPENROUTER_API_KEY?{name:"openrouter",run:m=>compatible("openrouter","https://openrouter.ai/api/v1",config.OPENROUTER_API_KEY!,config.OPENROUTER_MODEL,m)}:undefined
 };
 return config.AI_PROVIDER_ORDER.split(",").map(x=>map[x.trim().toLowerCase()]).filter((x):x is Provider=>Boolean(x));
}

export async function askAI(messages:ChatMessage[]){
 const providers=list();
 if(!providers.length)throw new Error("Nenhuma API de IA configurada no .env");
 const errors:string[]=[];
 for(const provider of providers){
  try{const text=await provider.run(messages);logger.info(`🤖 IA respondeu usando ${provider.name}`);return text}
  catch(error){const message=error instanceof Error?error.message:String(error);errors.push(message);logger.warn(`⚠️ ${provider.name} falhou — tentando próximo provedor`);logger.debug(message)}
 }
 throw new Error(`Todos os provedores falharam: ${errors.join(" | ")}`);
}
