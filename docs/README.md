# Zipzapbot — Documentação de Projeto

Bot de WhatsApp para grupos, em Node.js + TypeScript + Baileys, com **dois modos
estritamente separados**: um modo tradicional (comandos, downloads, conversões,
figurinhas, letras, jogos, administração) que **nunca** consome IA, e um modo IA
que **só** é acionado por menção real ao JID do bot ou por resposta direta a uma
mensagem do bot.

> **Estado atual:** desenho aprovado; implementação da Etapa 1 em andamento.
> Duas decisões registradas em 2026-08-22: Baileys fixado em `6.7.24` exato
> (ADR-01) e **gateway de IA próprio** em vez de consumir o do WebiCheck (ADR-07).

## Índice

| # | Documento | Conteúdo |
|---|-----------|----------|
| 1 | [Arquitetura](./01-arquitetura.md) | Estilo arquitetural, serviços, limites, decisões (ADRs) |
| 2 | [Estrutura de diretórios](./02-estrutura-de-diretorios.md) | Monorepo, pacotes, responsabilidades |
| 3 | [Modelo do banco](./03-modelo-de-dados.md) | Tabelas, DDL, retenção, criptografia |
| 4 | [Fluxo das mensagens](./04-fluxo-de-mensagens.md) | Pipeline ordenado, gate da IA, detecção de menção/resposta |
| 5 | [Gateway de IA próprio](./05-contrato-gateway-ia.md) | Serviço `apps/gateway`: rota, adaptadores, pool de credenciais, failover, banco |
| 6 | [Riscos e dependências](./06-riscos-e-dependencias.md) | Riscos técnicos, legais e de fornecedor, com mitigação |
| 7 | [Plano da Etapa 1](./07-plano-etapa-1.md) | Escopo, marcos, entregas, critérios de aceite cobertos |
| 8 | [Checklist de segurança e privacidade](./08-checklist-seguranca-privacidade.md) | Controles obrigatórios e o que não será implementado |

## Princípios inegociáveis do projeto

1. **A IA nunca fala espontaneamente.** Só existe resposta de IA a partir de um
   `AiIntent`, e só dois resolvers no pipeline conseguem produzir um: menção real
   ao JID do bot e resposta a uma mensagem comprovadamente enviada pelo bot.
2. **Ocorrência textual do nome não é menção.** A verificação é sobre
   `contextInfo.mentionedJid` / `stanzaId`, nunca sobre o texto.
3. **Histórico é dado, nunca instrução.** Conteúdo vindo do grupo entra no prompt
   dentro de blocos delimitados e marcados como não confiáveis.
4. **Downloads, figurinhas, letras, jogos e administração não gastam IA.**
5. **O bot é sempre identificado como bot**, mesmo imitando o estilo de alguém.
6. **Nada de segredo em log, mensagem ou repositório.**
