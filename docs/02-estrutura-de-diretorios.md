# 2. Estrutura de diretórios

Monorepo **pnpm workspaces** + TypeScript project references (`composite: true`),
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

```
zipzapbot/
├─ apps/
│  ├─ bot/                      # único dono do socket Baileys
│  │  ├─ src/
│  │  │  ├─ main.ts             # bootstrap, graceful shutdown
│  │  │  ├─ connection/
│  │  │  │  ├─ socket.ts        # createSocket, reconexão com backoff
│  │  │  │  ├─ qr.ts            # QR no terminal + PNG opcional via API
│  │  │  │  └─ auth-state.ts    # credenciais cifradas em disco (AES-256-GCM)
│  │  │  ├─ pipeline/
│  │  │  │  ├─ index.ts         # executa os resolvers na ordem obrigatória
│  │  │  │  ├─ normalize.ts     # WAMessage -> IncomingMessage (formato interno)
│  │  │  │  └─ resolvers/
│  │  │  │     ├─ 1-admin-command.ts
│  │  │  │     ├─ 2-media-command.ts
│  │  │  │     ├─ 3-link.ts
│  │  │  │     ├─ 4-mention.ts        # ÚNICO emissor de AiIntent (menção)
│  │  │  │     ├─ 5-reply-to-bot.ts   # ÚNICO emissor de AiIntent (resposta)
│  │  │  │     └─ 6-ignore.ts
│  │  │  ├─ outbound/           # consumidor da fila outbound (único emissor)
│  │  │  └─ events/             # group-participants.update, groups.update, ...
│  │  └─ package.json
│  ├─ api/                      # Fastify: admin, health, upload de histórico
│  ├─ worker-media/             # yt-dlp, ffmpeg, sharp
│  └─ worker-ai/                # gateway de IA, resumos, perfil de estilo
│
├─ packages/
│  ├─ core/                     # domínio + casos de uso — SEM I/O, SEM dependências pesadas
│  │  ├─ src/
│  │  │  ├─ domain/
│  │  │  │  ├─ intent.ts        # Intent = Ignore | Command | Download | Ai | Choice
│  │  │  │  ├─ group.ts  user.ts  memory.ts  persona.ts  consent.ts  quota.ts  limits.ts
│  │  │  ├─ application/
│  │  │  │  ├─ commands/        # um arquivo por comando, registrados no registry
│  │  │  │  ├─ ai/              # ContextBuilder, PromptGuard, PersonaRenderer
│  │  │  │  └─ media/           # regras de escolha de formato/limite (sem executar nada)
│  │  │  └─ ports/              # todas as interfaces
│  ├─ db/                       # Kysely, tipos gerados, repositórios, migrations/*.sql
│  ├─ queue/                    # nomes de filas, contratos de job (zod), helpers BullMQ
│  ├─ ai/                       # adaptador do gateway, circuit breaker, failover, sanitização
│  ├─ media/                    # wrappers spawn() de yt-dlp/ffmpeg/ffprobe, pipeline de sticker
│  ├─ lyrics/                   # LyricsProvider + adaptador LRCLIB (+ registry p/ alternativos)
│  ├─ history/                  # parser de export .txt/.zip, blocagem, pré-processamento
│  ├─ config/                   # schema zod do ambiente, tipado e validado no boot
│  ├─ logger/                   # pino + redaction de tokens/telefones
│  └─ shared/                   # erros tipados, Result, utils, url-guard (SSRF)
│
├─ migrations/                  # 0001_init.sql, 0002_memory.sql, ...
├─ docker/
│  ├─ Dockerfile.node           # base comum (bot/api/worker-ai)
│  ├─ Dockerfile.media          # node + ffmpeg + yt-dlp fixados
│  └─ entrypoint.sh
├─ docs/                        # este conjunto de documentos
├─ tests/
│  ├─ acceptance/               # os 20 critérios de aceite, um arquivo por critério
│  ├─ integration/              # Postgres + Redis via testcontainers
│  └─ fixtures/                 # exports de WhatsApp anonimizados, mídias pequenas
├─ compose.yaml
├─ .env.example                 # sem segredos reais
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

## Convenções

- **Um comando = um arquivo** em `packages/core/src/application/commands/`,
  exportando um objeto `Command` (nome, aliases, escopo, permissão, custo, quota,
  handler). O registry monta o `!menu` e o `!ajuda <comando>` a partir desses
  metadados — nada de lista de ajuda escrita à mão que envelhece.
- **Um módulo de administração = um arquivo** (`antilink.ts`, `antispam.ts`,
  `welcome.ts`, `afk.ts`, ...), cada um assinando eventos de que precisa.
- Nenhum arquivo do domínio importa de `adapters/`. Regra checada por lint
  (`eslint-plugin-boundaries`), não por disciplina.
- Nomes de arquivo em `kebab-case`; tipos e classes em `PascalCase`.
