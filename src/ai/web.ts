import {config} from "../config.js";
import {logger} from "../logger.js";

type Source={title:string;url:string};
async function detail(response:Response){const raw=await response.text();try{return (JSON.parse(raw) as any)?.error?.message||raw}catch{return raw}}
function withSources(text:string,sources:Source[]){
 const unique=sources.filter((source,index,list)=>source.url&&list.findIndex(item=>item.url===source.url)===index).slice(0,config.WEB_SEARCH_MAX_RESULTS);
 if(!unique.length)return text.trim();
 return `${text.trim()}\n\n*Fontes:*\n${unique.map(source=>`• ${source.title||"Fonte"}: ${source.url}`).join("\n")}`;
}

async function geminiSearch(query:string){
 if(!config.GEMINI_API_KEY)throw new Error("Gemini não configurado");
 const models=[config.GEMINI_MODEL,"gemini-2.5-flash"].filter((model,index,list)=>list.indexOf(model)===index);
 const failures:string[]=[];
 for(const model of models){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;
  const body={contents:[{role:"user",parts:[{text:`Pesquise na internet e responda em português brasileiro com informações atuais e objetivas. Pergunta: ${query}`}]}],tools:[{googleSearch:{}}],generationConfig:{temperature:.3,maxOutputTokens:1200}};
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(75_000)});
  if(!response.ok){failures.push(`${model}: HTTP ${response.status} — ${await detail(response)}`);continue}
  const data=await response.json() as any,candidate=data?.candidates?.[0];
  const text=candidate?.content?.parts?.map((part:any)=>part.text).join("");
  if(!text){failures.push(`${model}: resposta vazia`);continue}
  const sources:Source[]=(candidate?.groundingMetadata?.groundingChunks||[]).map((chunk:any)=>({title:chunk?.web?.title||"Fonte",url:chunk?.web?.uri||""}));
  return withSources(String(text),sources);
 }
 throw new Error(`Gemini pesquisa: ${failures.join(" | ")}`);
}

async function openAISearch(query:string){
 if(!config.OPENAI_API_KEY)throw new Error("OpenAI não configurada");
 const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${config.OPENAI_API_KEY}`},body:JSON.stringify({model:config.OPENAI_MODEL,instructions:"Pesquise na internet e responda em português brasileiro, de forma objetiva, citando fontes confiáveis e atuais.",input:query,tools:[{type:"web_search"}],reasoning:{effort:"none"},max_output_tokens:1200}),signal:AbortSignal.timeout(90_000)});
 if(!response.ok)throw new Error(`OpenAI pesquisa HTTP ${response.status} — ${await detail(response)}`);
 const data=await response.json() as any;
 const parts=(data?.output||[]).flatMap((item:any)=>item?.content||[]),text=data?.output_text||parts.filter((part:any)=>part?.type==="output_text").map((part:any)=>part.text).join("");
 if(!text)throw new Error("OpenAI retornou pesquisa vazia");
 const sources:Source[]=parts.flatMap((part:any)=>part?.annotations||[]).filter((a:any)=>a?.type==="url_citation"&&a?.url).map((a:any)=>({title:a.title||"Fonte",url:a.url}));
 return withSources(String(text),sources);
}

export async function searchWeb(query:string){
 if(!config.WEB_SEARCH_ENABLED)throw new Error("Pesquisa na internet desativada");
 try{const answer=await geminiSearch(query);logger.info("🌐 Pesquisa respondida usando Gemini/Google");return answer}catch(error){logger.warn("⚠️ Pesquisa Gemini falhou — tentando OpenAI");logger.debug(error instanceof Error?error.message:String(error))}
 const answer=await openAISearch(query);logger.info("🌐 Pesquisa respondida usando OpenAI");return answer;
}
