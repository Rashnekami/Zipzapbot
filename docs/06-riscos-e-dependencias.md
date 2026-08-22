# 6. Riscos e dependências

## 6.1 Baileys: não existe versão estável da linha 7.x — decisão necessária

Levantamento feito no npm em 2026-08-22:

```
baileys  dist-tags:  latest = 7.0.0-rc14   legacy = 6.7.24
último estável real: 6.7.24 (publicado 2026-07-29)
7.0.0-rc14 publicado em 2026-07-29 — ainda release candidate
@whiskeysockets/baileys espelha as mesmas versões
```

Além disso, existe a versão **`baileys@6.17.16`** (publicada em 2025-03-04),
`deprecated` no registro com o aviso:

> _This version is affected by a zero-day vulnerability that allows spoofing of
> messages, please update to the latest versions (6.7.22^ or 7.0.0-rc12^)!_
> — advisory **GHSA-qvv5-jq5g-4cgg**

Isso é uma armadilha real de semver: `6.17.16` é _maior_ que `6.7.24` pela
ordenação semver, então uma faixa `^6.7.24` poderia resolver para a versão
vulnerável. O npm atual evita isso porque desprioriza versões `deprecated` (foi
verificado: `npm install baileys@^6.7.24` resolve para `6.7.24`), mas essa
proteção é comportamento de gerenciador, não garantia do contrato — outro
gerenciador, ou um lockfile gerado em máquina antiga, pode resolver diferente.

**Decisão tomada:** fixar `"baileys": "6.7.24"` — versão exata, sem `^` e sem `~` —
commitar `pnpm-lock.yaml`, e ligar `pnpm audit` no CI. O briefing pede "versão
estável e fixada": `6.7.24` é a única que atende às duas condições hoje.

**Mitigação do acoplamento:** todo uso de Baileys fica atrás de `WhatsAppGateway`
(`connect`, `onMessage`, `sendText`, `sendMedia`, `groupMetadata`, `updateGroup`).
Quando 7.x sair de RC, a migração é reescrever um adaptador com a suíte de aceite
como rede de proteção, em vez de caçar chamadas espalhadas.

**Consequência de segurança que já muda o design:** havendo advisory de spoofing
de mensagens, campos de `contextInfo` controlados pelo remetente não servem como
autoridade. Por isso "resposta ao bot" é decidida por consulta a `bot_messages`
(§4.3), não por `contextInfo.participant`.

## 6.2 Riscos técnicos

| #   | Risco                                                                          | Impacto                                | Mitigação                                                                                                                                 |
| --- | ------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Baileys é biblioteca não oficial; mudança no protocolo derruba a conexão       | Bot fora do ar                         | Adaptador isolado, reconexão com backoff, alerta de saúde, plano de atualização (§6.5)                                                    |
| R2  | Banimento do número pelo WhatsApp                                              | Perda da conta                         | Sem disparo em massa, sem mensagem não solicitada, rate limit de saída, IA só sob acionamento explícito, número dedicado e "aquecido"     |
| R3  | `yt-dlp` quebra quando a plataforma muda                                       | Downloads falham                       | Versão fixada + bump semanal automatizado, smoke test por plataforma no CI, mensagem clara de "extrator indisponível"                     |
| R4  | Instagram/TikTok/Facebook/X passam a exigir autenticação para conteúdo público | Parte dos links deixa de funcionar     | **Não** contornaremos autenticação (§12 do briefing). Falha vira mensagem honesta de não suportado                                        |
| R5  | `ffmpeg` consumindo CPU/disco sem teto                                         | Servidor no chão                       | `spawn` com timeout, `-t` limitando duração, limite de resolução, concorrência global 2, cgroup/limite no Compose                         |
| R6  | Arquivo temporário abandonado                                                  | Disco cheio                            | Diretório por job com nome aleatório, `finally` que apaga em sucesso/erro/timeout, varredura periódica de órfãos, teste de aceite 16      |
| R7  | Credenciais da sessão Baileys vazadas (equivalem à conta)                      | Sequestro do WhatsApp                  | Volume dedicado, cifrado em repouso, fora da imagem, no `.gitignore`, nunca em log                                                        |
| R8  | Prompt injection vinda do histórico do grupo                                   | Bot manipulado                         | `PromptGuard` (§4.4), dados delimitados e rotulados, filtro de saída, nenhuma ação privilegiada acessível por texto                       |
| R9  | Redis como ponto único de falha                                                | Filas param                            | `appendonly yes`, healthcheck, jobs idempotentes, retry com backoff; comandos baratos continuam funcionando sem fila                      |
| R10 | Custo/limite de IA estourado por uso abusivo                                   | Conta suspensa                         | Cota diária por grupo e por participante (bot) + cota por aplicação (gateway), circuit breaker, teto de 3 provedores, IA nunca espontânea |
| R11 | Mensagem maior que o limite do WhatsApp (letra longa)                          | Envio falha                            | Divisão ordenada em partes ou envio como `.txt` (§4 do briefing)                                                                          |
| R12 | Migração de JID para LID quebra menção e permissão                             | IA nunca aciona; admin não reconhecido | `SelfIdentity` com as duas identidades, `users.lid`, teste dedicado (§4.2)                                                                |

## 6.3 Riscos legais e de privacidade

| #   | Risco                                                  | Mitigação                                                                                                                                                                                                  |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | LGPD — tratar dado pessoal sensível vindo do histórico | Enum fechado de `memory_facts.kind` sem categoria sensível; filtro de descarte no pré-processamento; nada de inferência sobre saúde, religião, orientação sexual, política, finanças, documentos, endereço |
| L2  | Persona inspirada em pessoa real sem autorização       | `persona_consents` com confirmação do titular; ativação bloqueada por constraint + caso de uso + teste (aceite 15); direito de revogação                                                                   |
| L3  | Impersonação                                           | Bot sempre identificado como bot; proibido afirmar ser a pessoa; proibido inventar declarações em nome dela; sem clonagem de voz/imagem                                                                    |
| L4  | Direito autoral em downloads                           | Allowlist de plataformas, sem DRM, sem conteúdo privado, sem contornar autenticação; aviso de responsabilidade do usuário no `!menu` e no README                                                           |
| L5  | Termos das fontes de letras                            | LRCLIB como primeira fonte, com atribuição, cache respeitando TTL e `User-Agent` identificando a aplicação                                                                                                 |
| L6  | Retenção indefinida                                    | Rotinas de expiração (§3.7), `!memoria apagar`, `!esquecer`, exclusão do arquivo bruto após o resumo                                                                                                       |

## 6.4 Dependências

**Runtime:** Node.js 22 LTS · TypeScript 5 (strict) · `baileys@6.7.24` (exato) ·
PostgreSQL 16 · Redis 7 · BullMQ · Kysely + `pg` · Fastify · pino · zod ·
`sharp` (figurinha estática) · `@napi-rs/canvas` (`!attp`) · `ffmpeg`/`ffprobe` ·
`yt-dlp` **2026.8.19** (última no PyPI em 2026-08-22).

**Regra:** nada de `fluent-ffmpeg` nem de wrapper que monte linha de comando por
string. Todo processo externo é `spawn(bin, [args])` com array de argumentos —
requisito explícito de segurança do briefing e a defesa correta contra injeção de
shell.

**Verificado neste ambiente:** Node v22.22.2, npm 10.9.7, Docker 29.3.1,
PostgreSQL client 16.13, Python 3.11.15. **`ffmpeg`, `ffprobe` e `yt-dlp` não estão
instalados** — vêm na imagem `docker/Dockerfile.media`; para desenvolvimento fora
do Docker o README trará o passo de instalação.

## 6.5 Plano de atualização (entregável do §15)

| Componente       | Cadência                      | Procedimento                                                                                                                                                        |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yt-dlp`         | semanal (segunda)             | Job de CI abre PR com a versão nova; smoke test baixa um vídeo curto público de cada plataforma; merge só com verde                                                 |
| Baileys          | mensal + imediato em advisory | Ler CHANGELOG e advisories; subir versão exata em branch; rodar suíte de aceite contra número de teste; **quando 7.x sair de RC**, migrar o adaptador em PR isolado |
| Base Node/Alpine | mensal                        | Rebuild + `pnpm audit` + Trivy na imagem                                                                                                                            |
| Demais deps      | mensal (Dependabot agrupado)  | Patch/minor automático com CI verde; major manual                                                                                                                   |

Nenhuma atualização vai para produção sem aprovação explícita.

## 6.6 Riscos do gateway próprio

Construir o gateway em vez de consumir o do WebiCheck troca uma dependência
externa por responsabilidade nossa. O que isso traz:

| #   | Risco                                                           | Mitigação                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | O gateway vira ponto único de falha da IA                       | Circuit breaker interno, `GET /health`, e degradação honesta: sem gateway, o bot responde que a IA está indisponível — comandos, downloads e figurinhas seguem funcionando, porque nada disso usa IA                              |
| G2  | Chaves de vários provedores concentradas em um processo         | Cifradas em repouso com KEK fora do banco, serviço sem porta pública no Compose, `redact` no log, token de aplicação como hash argon2id                                                                                           |
| G3  | Nome de modelo e limite de camada gratuita mudam com frequência | Nada embutido no código: `providers` e `models` são tabelas; trocar modelo é `UPDATE`, não deploy                                                                                                                                 |
| G4  | Múltiplas contas por provedor podem esbarrar em termos de uso   | Conferir os termos de cada provedor ao cadastrar. Contas separadas por aplicação costumam ser aceitas; somar cota gratuita com várias contas nem sempre é. O gateway funciona com uma credencial por provedor — só com teto menor |
| G5  | Erro de cada provedor tem formato próprio                       | `classifyError` por adaptador, traduzindo para `retryable`/`fatal`/`rate_limited`; erro `fatal` não gasta o próximo provedor                                                                                                      |
| G6  | Custo silencioso se um provedor pago entrar no pool             | `usage_log` por aplicação, cota diária por app, e provedor pago desabilitado por padrão                                                                                                                                           |

## 6.7 Bloqueios atuais

1. **Número de WhatsApp para testes** — necessário para os critérios de aceite que
   exigem sessão real. Recomendo um chip dedicado, nunca o pessoal.
2. **Credenciais dos provedores** — a conta separada que você vai criar. Só é
   necessária no início da Etapa 2; a Etapa 1 inteira roda sem nenhuma chave de IA.
3. **Aprovação de deploy** — não haverá deploy em produção sem seu aval explícito.

O contrato do WebiCheck deixou de ser bloqueio: não vamos mais depender dele.
