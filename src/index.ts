import {startPanel} from "./panel.js";
import {startBot} from "./bot.js";
startPanel();
startBot().catch(error=>{console.error(error);process.exitCode=1});
