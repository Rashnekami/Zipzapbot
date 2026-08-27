# ZipZapBot 2

Bot de WhatsApp para Node.js 22, TypeScript e Baileys. Inclui painel protegido para QR Code, figurinhas, conversão de mídia, download via yt-dlp, letras e gateway próprio com fallback entre Groq, Gemini e OpenRouter.

## Instalação no servidor

1. Instale Node.js 22 e FFmpeg.
2. Copie `.env.example` para `.env` e altere usuário, senha e chaves.
3. Execute `npm ci && npm run build && npm start`.
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
- `!reset`

A IA só responde em grupos quando for marcada ou quando alguém responder uma mensagem do bot. No privado, também é necessário marcar ou responder; comandos continuam funcionando normalmente.
