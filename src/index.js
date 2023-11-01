const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const moment = require("moment-timezone");
const colors = require("colors");
const fs = require("fs");
const express = require("express");
const app = express();
const port = 7860;
const gpt = require("./gpt/gpt.js");
const ffmpegPath = process.platform === "win32" ? "./ffmpeg.exe" : "ffmpeg";
let qrCodeDataURL = "";
require("dotenv").config();

app.get("/", (req, res) => {
	res.send(`<img src="${qrCodeDataURL}" alt="QR Code" />`);
});

app.listen(port, () => {
	console.log(`App listening at http://localhost:${port}`);
});

const client = new Client({
	restartOnAuthFail: true,
	puppeteer: {
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	},
	ffmpeg: ffmpegPath,
	authStrategy: new LocalAuth({ clientId: "client" }),
});

async function generateQRCode(qr) {
	qrCodeDataURL = await qrcode.toDataURL(qr);
}

client.on("qr", async (qr) => {
	console.log(`[${moment().tz(process.env.TIMEZONE).format("HH:mm:ss")}] Scan the QR below : `);
	qrcodeTerminal.generate(qr, { small: true });
	generateQRCode(qr);
});

client.on("ready", () => {
	console.clear();
	const consoleText = "./console.txt";
	fs.readFile(consoleText, "utf-8", (err, data) => {
		if (err) {
			console.log(
				`[${moment().tz(process.env.TIMEZONE).format("HH:mm:ss")}] Console Text not found!`.yellow
			);
			console.log(
				`[${moment().tz(process.env.TIMEZONE).format("HH:mm:ss")}] ${process.env.BOT_NAME} is Already!`.green
			);
		} else {
			console.log(data.green);
			console.log(
				`[${moment().tz(process.env.TIMEZONE).format("HH:mm:ss")}] ${process.env.BOT_NAME} is Already!`.green
			);
		}
	});
});

const handleMessage = async (message) => {
	const contact = await message.getContact();
	const isGroups = message.from.endsWith("@g.us") ? true : false;
	if ((isGroups && process.env.GROUPS) || !isGroups) {
		await handleCommands(message, contact);
	}
};

const handleCommands = async (message, contact) => {
	const commandPrefix = `${process.env.PREFIX}`;
	const messageBody = message.body;

	const commands = {
		fig: handleImageToSticker,
		img: handleStickerToImage,
		escreva: handleTranscribeAudio,
		reset: handleReset,
	};

	const command = Object.keys(commands).find((cmd) => messageBody.startsWith(`${commandPrefix}${cmd}`));

	if (command) {
		await commands[command](message, contact);
	} else if (process.env.GPT) {
		await handleGPT(message);
	}
};

const handleImageToSticker = async (message, contact) => {
	message.react("⏳");

	const mediaMessage = message.hasQuotedMsg ? await message.getQuotedMessage() : message;

	if (mediaMessage.hasMedia) {
		try {
			const media = await mediaMessage.downloadMedia();
			await client.sendMessage(message.from, media, {
				sendMediaAsSticker: true,
				stickerName: `Criada por ${contact.pushname}`,
				stickerAuthor: `Bot by ${process.env.AUTHOR}`,
			});
			indicateSuccess(message);
		} catch {
			indicateError(message);
		}
	} else {
		indicateError(message, "❌ Não é uma imagem.");
	}
};

const handleStickerToImage = async (message) => {
	const quotedMsg = await message.getQuotedMessage();

	if (message.hasQuotedMsg && quotedMsg.hasMedia) {
		message.react("⏳");
		try {
			const media = await quotedMsg.downloadMedia();
			await client.sendMessage(message.from, media);
			indicateSuccess(message);
		} catch {
			indicateError(message);
		}
	} else {
		indicateError(message, "❌ Não é uma figurinha.");
	}
};

const handleTranscribeAudio = async (message) => {
	const quotedMsg = await message.getQuotedMessage();
	const chat = await message.getChat();

	if (message.hasQuotedMsg && quotedMsg.hasMedia) {
		message.react("⏳");
		try {
			const media = await quotedMsg.downloadMedia();
			chat.sendStateTyping();

			gpt.transcribeAudio(media.data)
				.then((res) => {
					const response = `No áudio foi dito: \n\n${res}`;
					quotedMsg.reply(response);
					indicateSuccess(message);
				})
				.catch((error) => {
					console.error(error);
					indicateError(message);
				})
				.finally(() => {
					chat.clearState();
				});
		} catch {
			indicateError(message);
		}
	} else {
		indicateError(message, "❌ Não é um audio.");
	}
};

const handleReset = async (message) => {
	// Clears the chat history.
	const chat = await message.getChat();

	if (chat) {
		chat.clearMessages()
			.then(() => {
				chat.sendMessage("Resetado ✅");
			})
			.catch(() => {
				indicateError(message);
			});
	}
};

async function isMessageForMe(message) {
	const myId = client.info.wid._serialized;
	if (message.mentionedIds.includes(myId)) return true;
	if (message.body.toLowerCase().includes(process.env.BOT_NAME.toLowerCase())) return true;
	if (message.hasQuotedMsg) {
		const quotedMsg = await message.getQuotedMessage();
		return quotedMsg && quotedMsg.fromMe;
	}
	return false;
}

const appendMessageToHistory = (history, message) => {
	// Ensures that the incoming message will be the last in the history and interpreted correctly by GPT.
	const filteredHist = history.filter((msg) => msg.id._serialized !== message.id._serialized);
	return filteredHist.concat(message);
};

const handleGPT = async (message) => {
	// Handles the interaction with GPT for a given message.
	const chat = await message.getChat();

	if (chat.isGroup && !(await isMessageForMe(message))) return;

	const hist = await chat.fetchMessages({ limit: 15 });
	const messages = appendMessageToHistory(hist, message);

	const prompt = await gpt.transformChatForGPT(messages);
	if (prompt) processGPTChat(chat, message, prompt);
};

const processGPTChat = (chat, message, prompt) => {
	// Processes the GPT chat, sends the prompt to GPT, and handles the response.
	chat.sendStateTyping();
	gpt.chat(prompt)
		.then(async (response) => {
			if (await isMessageRevoked(message)) return;
			message.reply(response);
		})
		.catch((error) => {
			console.error(error);
			indicateError(message);
		})
		.finally(() => {
			chat.clearState();
		});
};

const isMessageRevoked = async (message) => {
	// Checks if a message has been revoked.
	const chat = await client.getChatById(message.from);
	const chatMessages = await chat.fetchMessages({});

	return !chatMessages.find((m) => m.id._serialized === message.id._serialized);
};

const indicateSuccess = async (message) => {
	if (await isMessageRevoked(message)) return;

	message.react("✅");
};

const indicateError = async (message, errorText = null) => {
	if (await isMessageRevoked(message)) return;

	if (errorText) message.reply(errorText);
	message.react("❌");
};

client.on("message", handleMessage);

client.initialize();
