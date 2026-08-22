# 7. Plano detalhado da Etapa 1 — Base funcional

**Objetivo:** bot conectado por QR Code, com comandos, downloads de YouTube
(MP3/MP4), conversão de vídeo em áudio, imagem e vídeo curto em figurinha, letras,
filas e limites — **sem uma única chamada de IA**. O `AiGateway` existe como porta
e recebe `NullAiGateway`, que recusa qualquer chamada. Isso permite validar 13 dos
20 critérios de aceite antes de a Etapa 2 começar.

## 7.1 Marcos

### M1 — Fundação do repositório
- Remover o código legado (`src/gpt/gpt.js`, `src/index.js`, `whatsapp-web.js`,
  `openai@3`, `puppeteer`) e o `package.json` antigo; preservar `LICENSE` e o
  banner de `console.txt`.
- pnpm workspaces, `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), ESLint com `eslint-plugin-boundaries`, Prettier,
  Vitest, `commitlint`.
- `packages/config` (schema zod do `.env`, validado no boot — o processo não sobe
  com variável faltando ou inválida), `packages/logger` (pino com `redact` para
  token, telefone, JID em nível de log público), `packages/shared` (Result, erros
  tipados).
- CI: typecheck, lint, testes, build da imagem.

### M2 — Banco e filas
- `migrations/0001_init.sql` — tabelas do §3.2, §3.3 e a parte de mídia/auditoria
  do §3.6. As tabelas de IA/memória entram na Etapa 2, mas `bot_messages` entra
  **agora**: é ela que registra tudo que enviamos.
- Runner de migrations (`pnpm db:migrate`, `db:rollback`, `db:status`).
- Repositórios Kysely tipados + testes de integração com testcontainers.
- `packages/queue`: filas `media`, `outbound`, `maintenance`; contratos de job com
  zod; política de retry (3 tentativas, backoff exponencial) e DLQ.

### M3 — Conexão WhatsApp
- Adaptador Baileys atrás de `WhatsAppGateway`, `baileys@6.7.24` exato.
- QR no terminal (`qrcode-terminal`) e endpoint `GET /qr` na `api` protegido por
  token, para conectar sem acesso ao console.
- `auth-state` cifrado em disco (AES-256-GCM), volume dedicado, no `.gitignore`.
- Reconexão com backoff exponencial; distinção entre logout (exige novo QR) e
  queda temporária.
- `SelfIdentity` (JID + LID) resolvida na conexão, com teste (§4.2).
- Toda mensagem enviada grava em `bot_messages` — no adaptador de saída, para que
  seja impossível esquecer.

### M4 — Pipeline e registry de comandos
- Normalização `WAMessage → IncomingMessage`.
- Os 6 resolvers na ordem obrigatória. Os resolvers 4 e 5 já existem e já
  **detectam** menção e resposta; como o gateway é nulo, respondem uma mensagem
  fixa de "IA ainda não configurada". A detecção fica testada desde a Etapa 1.
- Registry de comandos com metadados (`usesAi`, `scope`, `permission`, `cost`).
- `!menu`, `!ping`, `!status`, `!ajuda <comando>` gerados do registry.
- Permissões por função + `audit_log` para ação administrativa (aceite 19).
- Rate limit por usuário e por grupo (Redis, janela deslizante).

### M5 — worker-media: YouTube
- `packages/media/src/ytdlp.ts` — `spawn('yt-dlp', [...])`, nunca string.
- Metadados por `--dump-single-json` **sem baixar**; bloqueio de playlist grande.
- MP3: melhor fonte de áudio → `ffmpeg` → `loudnorm` (normalização sem distorção,
  two-pass) → tags (título, artista) e capa → envio como áudio → temporário apagado.
- MP4: seleção de resolução dentro do limite, merge A/V, remux para MP4 compatível
  (`faststart`), redução automática de qualidade se passar de ~45 MB, opção de
  envio como documento.
- `!play`, `!mp3`, `!mp4` aceitando link **ou** busca; `!ytsearch`.
- Menu numerado + `PendingChoice` com TTL (aceite 5).
- Cache de 24 h por `cache_key`; concorrência global 2; um job ativo por usuário.

### M6 — Conversões de mídia do grupo
- `resolveTargetMedia` (legenda **ou** resposta) — §4.7.
- Vídeo → áudio: aliases `converter`, `audio`, `mp3`, `!converter`, `!tomp3`
  (aceite 7). Download por streaming, extração com `ffmpeg`, envio, limpeza no
  `finally`.
- Imagem → figurinha: aliases `figurinha`, `fig`, `sticker`, `!figurinha`,
  `!sticker`. WebP 512×512, proporção preservada, `contain` com fundo
  transparente, sem esticar (aceite 8).
- Vídeo curto → figurinha animada, com teto de duração e de tamanho (aceite 9).
- `!toimg`, `!togif`, `!rename Pacote | Autor` (reescreve o EXIF do WebP).
- `!attp` (texto colorido → figurinha animada) via `@napi-rs/canvas`.
- `!transcrever` e `!resumir` ficam **registrados e desabilitados** na Etapa 1 —
  dependem de IA; respondem "disponível na próxima etapa".

### M7 — Letras
- Porta `LyricsProvider` + adaptador **LRCLIB** (com `User-Agent` identificando a
  aplicação) e registry para provedores alternativos.
- `!letra <música>`, `!letra <artista> - <música>`, e `!letra` respondendo a um
  MP3 enviado pelo bot (usa os metadados que nós mesmos gravamos).
- Resultado: música, artista, álbum quando houver, letra normal e sincronizada.
- Múltiplos resultados → menu numerado (aceite 10).
- Excedeu o tamanho seguro → divisão ordenada ou `.txt`.
- Cache em `lyrics_cache`.

### M8 — Segurança, empacotamento e aceite
- `url-guard`: só `http`/`https`, allowlist de domínios, resolução de DNS com
  bloqueio de IP privado/loopback/link-local/metadata (anti-SSRF), sem seguir
  redirecionamento para fora da allowlist.
- Diretório temporário por job com nome aleatório; sem `..`; sem nome vindo do
  usuário (anti path traversal).
- `compose.yaml` com `bot`, `api`, `worker-media`, `postgres`, `redis`, volumes e
  healthchecks; `Dockerfile.media` com `ffmpeg` e `yt-dlp` fixados.
- `.env.example` sem segredo; teste de CI que falha se algo com cara de segredo
  entrar no repositório (aceite 17).
- README: instalação, QR Code, comandos, limites, aviso de uso responsável.
- `docs/08-checklist-seguranca-privacidade.md` preenchido.

## 7.2 Critérios de aceite cobertos na Etapa 1

| # | Critério | Como é testado |
|---|---|---|
| 1 | Mensagem comum não recebe resposta | Unidade: pipeline devolve `Ignore` e nenhum efeito colateral registrado |
| 5 | Link do YouTube apresenta MP3/MP4 | Integração com `yt-dlp` falso; verifica menu numerado e `PendingChoice` |
| 6 | MP3 convertido e enviado | Integração: `ffprobe` confirma MP3 válido, com tags e dentro do limite |
| 7 | Vídeo + `converter` → áudio | Integração com fixture de vídeo curto |
| 8 | Foto + `figurinha` → WebP válido | Integração: assinatura `RIFF/WEBP`, 512×512, alfa preservado, sem distorção |
| 9 | Vídeo curto + `figurinha` → animada | Integração: WebP animado, duração dentro do teto |
| 10 | `!letra` acerta ou oferece opções | Integração com LRCLIB falso |
| 16 | Temporários apagados | Teste força erro e timeout e verifica diretório vazio |
| 17 | Nenhuma credencial em log/repo | Teste de redaction do pino + varredura de segredo no CI |
| 18 | Downloads simultâneos respeitam a fila | Integração: 5 jobs, concorrência 2, ordem e limite verificados |
| 19 | Comando administrativo rejeita sem permissão | Unidade por comando + registro em `audit_log` |
| 20 | Bot continua identificado como bot | `!menu`/`!status` exibem identificação; teste de snapshot |
| 4 | IA nunca responde espontaneamente | Teste de arquitetura: só 2 resolvers emitem `AiIntent`; `NullAiGateway` prova que nada mais chama IA |

Ficam para a Etapa 2 os critérios 2, 3, 11, 12, 14 (e 13, 15 para a Etapa 3) — a
**detecção** de menção e de resposta já fica pronta e testada aqui; falta apenas
ligar o gateway real.

## 7.3 Ordem de entrega

Um PR por marco, cada um com CI verde e testes próprios — nada de PR gigante.

```
PR1  M1 fundação            PR5  M5 YouTube
PR2  M2 banco e filas       PR6  M6 conversões
PR3  M3 conexão + QR        PR7  M7 letras
PR4  M4 pipeline+comandos   PR8  M8 segurança, Docker, README, aceite
```

## 7.4 Fora do escopo da Etapa 1

Qualquer chamada de IA, memória, personalidade, importação de histórico,
administração avançada (antilink, antispam, boas-vindas, ranking), jogos e
economia. Estão nas Etapas 2 a 4 e não serão antecipados — o valor de fechar a
Etapa 1 é ter uma base testada antes de acrescentar as partes que dependem de
fornecedor externo.
