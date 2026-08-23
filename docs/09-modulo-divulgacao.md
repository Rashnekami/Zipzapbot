# 9. Módulo de divulgação de ofertas

> **Decisão de 2026-08-23 (ADR-08).** Um comerciante pediu algo próximo do
> [DivulgaNinja](https://www.divulganinja.com.br/): descoberta e publicação
> automática de ofertas de afiliados em WhatsApp e Telegram. A decisão foi
> **manter os dois produtos sobre a mesma base**, e **começar pelo WhatsApp**.
> Este documento descreve o módulo novo e, principalmente, as travas que o
> tornam viável.

## 9.1 O que é, e o que não é

O Zipzapbot original é um **assistente de grupo**: reage quando chamado.
Este módulo é o oposto — ele **emite** conteúdo comercial de forma programada.
São dois produtos com naturezas opostas dividindo infraestrutura.

|                 | Assistente (Etapas 1–4)   | Divulgação (este módulo)     |
| --------------- | ------------------------- | ---------------------------- |
| Iniciativa      | Sempre do participante    | Do operador, programada      |
| Gatilho         | Comando, menção, resposta | Agenda e catálogo de ofertas |
| Volume          | Baixo, sob demanda        | Alto e recorrente            |
| Risco principal | Resposta indevida         | **Banimento do número**      |

Eles compartilham conexão, filas, banco, log e configuração. Não compartilham
regras de comportamento: o pipeline de intents do assistente continua valendo
para mensagens recebidas, e o módulo de divulgação não passa por ele.

## 9.2 Inversão explícita de uma regra anterior

O briefing original, §12, listava "disparos em massa" entre o que **não** deveria
ser implementado, e o projeto foi construído com essa trava.

Esta decisão a reverte de forma consciente e **limitada**:

- Emitimos apenas para **destinos que o operador administra** — grupos e canais
  próprios, cujos membros entraram por vontade própria.
- **Nunca** mensagem não solicitada para número que não pediu contato.
- **Nunca** lista de números importada, comprada ou raspada.
- **Nunca** mensagem direta automática para quem não iniciou a conversa.
- Todo destino tem **origem registrada** e pode ser desligado num comando.

A diferença entre "publicar no meu canal de ofertas" e "disparo em massa" é essa,
e ela é aplicada em código: um destino só existe se o bot for participante dele,
e não há caminho no sistema que aceite uma lista de telefones.

## 9.3 O risco do WhatsApp, e por que ele não tem saída oficial

Verificado em 2026-08-23: a Cloud API oficial **passou a ter** uma Groups API,
mas com **limite de 8 participantes por grupo**, exigência de Official Business
Account e sem endpoint para adicionar participante
([Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/)).
Para grupo de ofertas com centenas de membros, é inútil.

Ou seja: **para WhatsApp, só existe Baileys**, que é não oficial. Publicação
promocional em volume é um dos padrões que mais rapidamente levam ao bloqueio do
número.

Isso não é motivo para não fazer — é motivo para o **ritmo de envio** ser a peça
central do módulo, e não um detalhe de configuração. O Telegram entra depois,
como canal sem esse risco.

## 9.4 Ritmo de envio: a peça que protege o número

Implementado em `packages/core/src/domain/pacing.ts` como **função pura**, com
relógio injetado. É lógica pura de propósito: dá para testar cada regra sem
socket, sem rede e sem arriscar uma conta.

Regras aplicadas, em ordem:

| Regra                                                          | Por quê                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Aquecimento** — teto diário cresce por dia de vida do número | Número novo que dispara 200 mensagens no primeiro dia é o padrão mais óbvio de automação |
| **Horário de silêncio**                                        | Publicar às 4h não gera venda e destoa de comportamento humano                           |
| **Teto diário global e por destino**                           | Limita o estrago de uma configuração errada                                              |
| **Intervalo mínimo por destino**                               | Impede repetir no mesmo grupo em sequência                                               |
| **Ritmo global (mensagens por minuto)**                        | Espaça a saída entre todos os destinos                                                   |
| **Jitter**                                                     | Envio em intervalo exato é assinatura de robô; o jitter quebra a regularidade            |
| **Envio estritamente sequencial**                              | O socket é recurso único; paralelizar embaralha ordem e concentra rajada                 |

Mais duas, que **só apareceram medindo** — os testes de regra passavam sem elas:

| Regra                            | Por quê                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rotação justa entre destinos** | Com ordem fixa e cota global esgotando antes da lista, os últimos destinos recebem **zero, todo dia**. Medido com 20 grupos: nove ficavam sem nada |
| **Espalhamento pelo dia**        | Sem ele, a cota inteira sai nas primeiras horas depois do silêncio. Medido: 120 mensagens todas entre 7h e 9h                                      |

O padrão é deliberadamente conservador. Aumentar é decisão consciente do
operador, com o risco explicado.

### Comportamento medido

Simulação de 24 horas, minuto a minuto, com a configuração padrão:

| Idade do número | Destinos | Publicações/dia | Por destino | Sem receber | Janela | Pico/hora |
| --------------- | -------- | --------------- | ----------- | ----------- | ------ | --------- |
| 1º dia          | 3        | 5               | 1–2         | 0           | 7h–16h | 2         |
| 3 dias          | 3        | 18              | 6           | 0           | 7h–21h | 2         |
| maduro          | 3        | 36              | 12          | 0           | 7h–22h | 3         |
| maduro          | 10       | 120             | 12          | 0           | 7h–22h | 8         |
| maduro          | 20       | 120             | 6           | 0           | 7h–22h | 8         |

Antes das correções, a última linha era **120 publicações concentradas entre 7h e
9h, com 9 dos 20 grupos recebendo zero**.

Vale registrar o método: as três correções vieram de _medir a vazão_, não de
rodar os testes. Um teste que afirma "não passou do teto" continua verde enquanto
metade dos grupos não recebe nada e o resto leva rajada de manhã.

## 9.5 Modelo de dados (migration 0002)

```
affiliate_accounts   credenciais por rede, cifradas; tag de afiliado
offers               oferta: título, preço, preço antigo, imagem, URL, hash
destinations         grupo ou canal de destino, com tetos próprios
campaigns            o que publicar, onde, com que modelo e agenda
broadcasts           uma linha por (oferta, destino): agendado, enviado, falhou
short_links          código curto por (oferta, destino), para atribuir clique
click_events         clique registrado, sem dado pessoal identificável
```

Duas decisões que valem explicação:

- `broadcasts` tem **unicidade por (campanha, oferta, destino)**. É o que impede
  a mesma oferta de sair duas vezes no mesmo grupo quando um job repete.
- `click_events` guarda **hash** de IP e user agent, nunca o valor. Serve para
  contar visitante distinto sem virar base de dado pessoal.

## 9.6 O que entra por etapa

**D1 — Núcleo seguro (agora).** Ritmo de envio, modelo de dados, destinos
registrados, fila de publicação sequencial. Sem integração com rede nenhuma.

**D2 — Oferta manual.** O operador cola o link do produto, o sistema converte
para link de afiliado com a tag dele, monta o post com imagem e preço, agenda e
publica. **Entrega valor sem depender de aprovação de nenhuma rede** — Amazon,
Shopee e afins exigem cadastro aprovado, e isso costuma travar semanas.

**D3 — Redes de afiliados.** Um adaptador por rede, atrás de uma porta comum.
Depende de saber em quais o comerciante já tem conta aprovada.

**D4 — Descoberta automática e relatórios.** Catálogo de ofertas, ranking,
rotação de conteúdo, encurtador com rastreio de clique, painel.

**D5 — Telegram.** Mesmo módulo, adaptador novo. Sem risco de banimento.

## 9.7 O que ainda não sei

Para o D3 preciso saber **em quais redes o comerciante já tem conta aprovada** —
cada uma tem API, autenticação e formato de deeplink próprios, e construir para a
rede errada é trabalho jogado fora. O D1 e o D2 não dependem disso.
