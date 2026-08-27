import {startPanel} from "./panel.js";
import {startBot} from "./bot.js";
import {printBanner} from "./logger.js";
printBanner();
startPanel();
startBot().catch(error=>{console.error(error);process.exitCode=1});
