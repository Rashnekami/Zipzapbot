import type {ChatMessage} from "./gateway.js";
import {config} from "../config.js";
const histories=new Map<string,ChatMessage[]>();
export function addHistory(id:string,m:ChatMessage){const l=histories.get(id)||[];l.push(m);histories.set(id,l.slice(-config.AI_MAX_HISTORY))}
export function getHistory(id:string){return histories.get(id)||[]}
export function clearHistory(id:string){histories.delete(id)}
