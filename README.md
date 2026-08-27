# ZipZapBot 2

Bot de WhatsApp para Node.js 22, TypeScript e Baileys. Inclui painel protegido para QR Code, figurinhas, conversão de mídia, download via yt-dlp, letras, transcrição de áudio, humor persistente por participante e gateway próprio com fallback entre OpenAI, Gemini, Groq e OpenRouter.

## Instalação no servidor

1. Instale Node.js 22 e FFmpeg.
2. Copie `.env.example` para `.env` e altere usuário, senha e chaves.
3. Execute `npm ci && npm start` (o build é executado automaticamente).
4. Abra `http://IP-OU-DOMINIO:8123`, faça login e escaneie o QR.
5. Preserve a pasta `data/` entre reinicializações.

Também pode ser iniciado com `docker compose up -d --build`.

## Comandos

- `!ajuda`
- `!fig` respondendo imagem ou vídeo
- `!audio` respondendo vídeo/áudio
- `!video URL`
- `!mp3 URL`
- `!letra música e artista`
- `!ia` respondendo um áudio para transcrever e responder
- `!pesquisar assunto` para pesquisar na internet com Gemini/Google e fallback OpenAI
- `!humor` para consultar a irritação do bot com você
- `!reset`

A IA só responde em grupos quando for marcada ou quando alguém responder uma mensagem do bot. No privado, também é necessário marcar ou responder; comandos continuam funcionando normalmente.
