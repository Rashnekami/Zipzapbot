import {spawn} from "node:child_process";
import {mkdir,readFile,rm,stat} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import YTDlpWrapModule from "yt-dlp-wrap";
import {config} from "./config.js";

async function run(command:string,args:string[]){await new Promise<void>((resolve,reject)=>{const p=spawn(command,args,{stdio:["ignore","ignore","pipe"]});let err="";p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error(err.slice(-500)||`${command} falhou (${c})`)))})}
async function temp(ext:string){const dir=join(config.DATA_DIR,"tmp");await mkdir(dir,{recursive:true});return join(dir,`${randomUUID()}.${ext}`)}
export async function toSticker(input:Buffer){const src=await temp("bin"),out=await temp("webp");await BunLike.write(src,input);try{await run("ffmpeg",["-y","-i",src,"-vf","scale=512:512:force_original_aspect_ratio=decrease,fps=15","-loop","0","-an",out]);return await readFile(out)}finally{await Promise.allSettled([rm(src),rm(out)])}}
export async function toMp3(input:Buffer){const src=await temp("bin"),out=await temp("mp3");await BunLike.write(src,input);try{await run("ffmpeg",["-y","-i",src,"-vn","-codec:a","libmp3lame","-q:a","4",out]);return await readFile(out)}finally{await Promise.allSettled([rm(src),rm(out)])}}
const BunLike={write:async(path:string,data:Buffer)=>{const {writeFile}=await import("node:fs/promises");await writeFile(path,data)}};
const YTDlpWrap:any=(YTDlpWrapModule as any).default??YTDlpWrapModule;
let ytdlp:string|undefined;
async function binary(){if(config.YTDLP_PATH)return config.YTDLP_PATH;if(ytdlp)return ytdlp;const path=join(config.DATA_DIR,"yt-dlp");try{await stat(path)}catch{await mkdir(config.DATA_DIR,{recursive:true});await YTDlpWrap.downloadFromGithub(path)}ytdlp=path;return path}
export async function downloadUrl(url:string,audio:boolean){const ext=audio?"mp3":"mp4",out=await temp(ext);const tool=new YTDlpWrap(await binary());const args=audio?[url,"-x","--audio-format","mp3","--audio-quality","5","-o",out,"--no-playlist"]:[url,"-f","bv*[height<=720]+ba/b[height<=720]","--merge-output-format","mp4","-o",out,"--no-playlist"];await tool.execPromise(args);const s=await stat(out);if(s.size>config.MAX_MEDIA_MB*1024*1024){await rm(out);throw new Error(`Arquivo excede ${config.MAX_MEDIA_MB} MB`)}const data=await readFile(out);await rm(out);return data}
export async function lyrics(query:string){const r=await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,{headers:{"user-agent":"ZipZapBot/2.0"},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error("Letra não encontrada");const d=await r.json() as any[];const text=d?.[0]?.plainLyrics;if(!text)throw new Error("Letra não encontrada");return String(text).slice(0,12000)}
