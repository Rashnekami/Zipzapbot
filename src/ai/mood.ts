import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {config} from "../config.js";

type Mood={name:string;irritation:number;blockedUntil:number;updatedAt:number};
type MoodResult={action:"allow"|"ignore"|"forgiven"|"rejected"|"blocked";prompt:string;reply?:string};
const moods=new Map<string,Mood>();
let loaded=false;

function file(){return join(config.DATA_DIR,"mood.json")}
async function load(){if(loaded)return;loaded=true;try{const data=JSON.parse(await readFile(file(),"utf8")) as Record<string,Mood>;for(const [id,mood] of Object.entries(data))moods.set(id,mood)}catch{}}
async function save(){await mkdir(config.DATA_DIR,{recursive:true});const tmp=`${file()}.tmp`;await writeFile(tmp,JSON.stringify(Object.fromEntries(moods),null,2));await rename(tmp,file())}
function decay(mood:Mood){const steps=Math.floor((Date.now()-mood.updatedAt)/(30*60_000));if(steps>0){mood.irritation=Math.max(0,mood.irritation-steps);mood.updatedAt=Date.now()}if(mood.blockedUntil<=Date.now()&&mood.irritation>=config.BOT_IRRITATION_THRESHOLD)mood.irritation=config.BOT_IRRITATION_THRESHOLD-1}
const apology=/\b(desculpa|desculpe|foi mal|foi mau|mal aí|mals|perdão|perdoa|não fica bravo|nao fica bravo)\b/i;
const provocation=/\b(inútil|inutil|burro|bosta|merda|lixo|idiota|otário|otario|arrombado|desgraçado|desgracado|fdp|filho da puta|vai se foder|vai tomar no cu|seu cu|corno|viado|babaca|retardado)\b/i;
const strong=/\b(vai se foder|vai tomar no cu|filho da puta|arrombado|retardado)\b/i;
const blockedReplies=["Pronto, agora fiquei de mal. Se vira aí 😒","Chega. Com você eu não converso mais até aprender a pedir desculpa.","Falou demais. Entrou na lista do silêncio 🤐"];
const rejectedReplies=["Desculpa protocolada. Perdão negado por enquanto.","Não colou. Vai ter que caprichar mais nesse pedido 😂","Vou pensar no seu caso. Hoje ainda tô puto."];

export async function processMood(id:string,name:string,text:string):Promise<MoodResult>{
 if(!config.BOT_MOOD_ENABLED)return {action:"allow",prompt:""};
 await load();
 const mood=moods.get(id)||{name,irritation:0,blockedUntil:0,updatedAt:Date.now()};
 mood.name=name;
 decay(mood);
 if(mood.blockedUntil>Date.now()){
  if(apology.test(text)){
   if(Math.random()*100<config.BOT_FORGIVENESS_CHANCE){
    mood.irritation=Math.max(0,mood.irritation-4);
    mood.blockedUntil=0;
    mood.updatedAt=Date.now();
    moods.set(id,mood);
    await save();
    return {action:"forgiven",prompt:`${name} pediu desculpas e você decidiu perdoar, ainda que com uma provocação leve.`};
   }
   mood.blockedUntil=Date.now()+config.BOT_GRUDGE_MINUTES*60_000;
   mood.updatedAt=Date.now();
   moods.set(id,mood);
   await save();
   return {action:"rejected",prompt:"",reply:rejectedReplies[Math.floor(Math.random()*rejectedReplies.length)]};
  }
  moods.set(id,mood);
  await save();
  return {action:"ignore",prompt:""};
 }
 if(provocation.test(text))mood.irritation+=strong.test(text)?3:2;else if(/\b(chato|lerdo|fraco|ruim|vacilão|vacilao)\b/i.test(text))mood.irritation+=1;
 mood.updatedAt=Date.now();
 if(mood.irritation>=config.BOT_IRRITATION_THRESHOLD){
  mood.blockedUntil=Date.now()+config.BOT_GRUDGE_MINUTES*60_000;
  moods.set(id,mood);
  await save();
  return {action:"blocked",prompt:"",reply:blockedReplies[Math.floor(Math.random()*blockedReplies.length)]};
 }
 moods.set(id,mood);
 await save();
 const prompt=mood.irritation>0?`Estado emocional com ${name}: irritação ${mood.irritation}/${config.BOT_IRRITATION_THRESHOLD}. Responda mais impaciente e atravessado, mas mantenha a zoeira sem crueldade.`:"";
 return {action:"allow",prompt};
}

export async function moodStatus(id:string,name:string){await load();const mood=moods.get(id)||{name,irritation:0,blockedUntil:0,updatedAt:Date.now()};decay(mood);const minutes=Math.max(0,Math.ceil((mood.blockedUntil-Date.now())/60_000));return {irritation:mood.irritation,blocked:minutes>0,minutes}}
