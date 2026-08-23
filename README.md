# Zipzapbot

Bot de WhatsApp para grupos, em Node.js + TypeScript + [Baileys](https://github.com/WhiskeySockets/Baileys).

Dois modos **estritamente separados**:

- **Modo tradicional** — comandos, downloads, conversões, figurinhas, letras, jogos
  e administração. Não usa IA em nenhuma hipótese.
- **Modo IA** — só é acionado por **menção real** ao perfil do bot ou por
  **resposta direta** a uma mensagem que o bot enviou. Mensagem comum nunca gera
  resposta. A IA não participa espontaneamente da conversa.

## Estado atual

| Etapa           | Escopo                                                | Situação                                        |
| --------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Desenho         | Arquitetura, banco, fluxo, riscos                     | ✅ concluído — veja [`docs/`](./docs/README.md) |
| Etapa 1 · M1    | Fundação: monorepo, TS estrito, config, log, CI       | ✅ concluído                                    |
| Etapa 1 · M2–M8 | Banco, conexão, comandos, YouTube, conversões, letras | ⏳ em andamento                                 |
| Etapa 2         | Gateway de IA próprio, memória, personalidade         | ⏸️ depois da Etapa 1                            |
| Etapas 3–4      | Histórico importado, administração, jogos             | ⏸️ planejadas                                   |

O bot **já conecta ao WhatsApp e gera QR Code**. Ele ainda não responde a nada:
o pipeline de comandos chega no M4. Esse silêncio é o comportamento correto —
é o critério de aceite 1.

## Requisitos

- Node.js 22 LTS
- pnpm 10
- PostgreSQL 16 e Redis 7 (a partir do M2)
- FFmpeg, FFprobe e yt-dlp (a partir do M5 — já vêm na imagem Docker)

## Instalação

```bash
git clone https://github.com/Rashnekami/Zipzapbot.git
cd Zipzapbot
pnpm install

cp .env.example .env
# Gere a chave de cifra e coloque em ENCRYPTION_KEY:
openssl rand -hex 32
```

O processo valida o ambiente inteiro no boot e **não sobe** com variável faltando
ou fora de faixa — ele lista de uma vez tudo que precisa ser corrigido.

## Verificação

```bash
pnpm run verify            # typecheck estrito + lint + testes
pnpm run test:unit         # testes que não precisam de banco nem Redis
pnpm run test:integration  # testes contra Postgres e Redis reais
pnpm run typecheck
pnpm run lint
pnpm run format
```

Os testes de integração são **pulados** quando `TEST_DATABASE_URL` e
`TEST_REDIS_URL` não estão definidas, para que a suíte unitária rode sem
infraestrutura:

```bash
export TEST_DATABASE_URL=postgres://zipzap:zipzap@localhost:5432/zipzap_test
export TEST_REDIS_URL=redis://localhost:6379
pnpm run test:integration
```

## Conectando pela primeira vez

```bash
pnpm run build
pnpm run db:migrate
pnpm --filter @zipzap/bot start
```

O QR Code aparece no terminal. No celular: **WhatsApp → Configurações →
Aparelhos conectados → Conectar um aparelho**. O código expira em cerca de um
minuto e é substituído automaticamente; basta ler o mais recente.

Conectou uma vez, não precisa repetir: a sessão fica em `SESSION_DIR`,
**cifrada com AES-256-GCM**, e o próximo boot reconecta sozinho.

Sobre esses arquivos de sessão:

- Eles equivalem a **acesso total à conta** — quem os copia entra sem QR e sem
  aviso. Por isso são cifrados, gravados com permissão `0600` e ficam fora do
  repositório e da imagem Docker.
- Perder `ENCRYPTION_KEY` torna a sessão irrecuperável, e aí é ler o QR de novo.
- Trocar de chave, apagar a pasta ou o WhatsApp encerrar a sessão levam ao mesmo
  lugar: o bot pede um QR novo em vez de entrar em ciclo de erro.

Use um número dedicado. Baileys é biblioteca não oficial, e o WhatsApp pode
bloquear contas que considere automatizadas.

## Banco de dados

```bash
pnpm run build        # o CLI de migrations roda a partir do dist
pnpm run db:status    # o que está aplicado e o que falta
pnpm run db:migrate   # aplica as pendentes
```

Cada migration roda na própria transação, protegida por um advisory lock — duas
réplicas subindo ao mesmo tempo não se atropelam. Migration já aplicada que teve
o arquivo alterado faz o runner **recusar** a subida, em vez de deixar ambientes
divergirem em silêncio. Não há `down`: a correção é uma migration nova, revisada
como qualquer outra mudança.

## Estrutura

```
apps/       bot · api · worker-media · worker-ai · gateway
packages/   core · db · queue · ai · media · lyrics · history · config · logger · shared
docs/       arquitetura, banco, fluxo de mensagens, riscos, plano, segurança
tests/      aceite e integração
```

Detalhes em [`docs/02-estrutura-de-diretorios.md`](./docs/02-estrutura-de-diretorios.md).

## Documentação

| Documento                                                               | Conteúdo                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| [Arquitetura](./docs/01-arquitetura.md)                                 | Serviços, camadas e decisões registradas       |
| [Estrutura](./docs/02-estrutura-de-diretorios.md)                       | Monorepo e convenções                          |
| [Banco](./docs/03-modelo-de-dados.md)                                   | Tabelas, DDL validado, retenção e cifra        |
| [Fluxo de mensagens](./docs/04-fluxo-de-mensagens.md)                   | Pipeline e o gate da IA                        |
| [Gateway de IA](./docs/05-contrato-gateway-ia.md)                       | Nosso gateway: rota, provedores, failover      |
| [Riscos](./docs/06-riscos-e-dependencias.md)                            | Riscos técnicos, legais e plano de atualização |
| [Plano da Etapa 1](./docs/07-plano-etapa-1.md)                          | Marcos e critérios de aceite                   |
| [Segurança e privacidade](./docs/08-checklist-seguranca-privacidade.md) | Checklist obrigatório                          |

## Uso responsável

O bot só baixa conteúdo **público** das plataformas suportadas. Ele não baixa
conteúdo privado, protegido por DRM, nem nada que exija contornar autenticação.
Quem usa a função é responsável por aplicá-la apenas a conteúdo próprio,
autorizado ou permitido pela plataforma e pela legislação aplicável.

O bot é sempre identificado como bot, inclusive quando configurado para imitar um
estilo de escrita. Perfil inspirado em um participante exige autorização
registrada e confirmada, e pode ser revogado a qualquer momento.

Baileys é uma biblioteca não oficial. Use um número dedicado, nunca o pessoal.

## Licença

GPL-3.0 — veja [LICENSE](./LICENSE).
