# 5. Contrato do gateway de IA

> **Atenção:** o contrato HTTP real do gateway do WebiCheck **não foi inventado
> aqui**. A §5.2 é a *porta interna* do bot, que é decisão nossa e não depende do
> WebiCheck. A §5.3 é uma **proposta de mapeamento HTTP** que só será
> implementada como adaptador definitivo depois que você enviar a rota real
> (§5.6). Enquanto isso, a Etapa 1 usa `NullAiGateway` — que recusa toda chamada —
> e a Etapa 2 começa pelo adaptador de verdade.

## 5.1 Princípio

O core **não conhece provedor**. Ele conhece uma interface. Trocar WebiCheck por
outro gateway, ou acrescentar um caminho direto a um provedor, é escrever um
adaptador novo — sem tocar em caso de uso, memória ou personalidade.

## 5.2 Porta interna (decisão nossa, estável)

```ts
// packages/core/src/ports/ai-gateway.ts
export interface AiGateway {
  complete(req: AiRequest, opts: AiCallOptions): Promise<AiResult>;
}

export interface AiRequest {
  purpose: 'chat' | 'summary' | 'transcript' | 'persona';
  system: string;                 // instruções montadas pelo PromptGuard
  messages: AiMessage[];          // já sanitizadas e delimitadas
  capability: 'fast' | 'balanced' | 'deep';   // capacidade, não nome de modelo
  maxOutputTokens: number;
  temperature?: number;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  trusted: boolean;               // false para tudo que veio do grupo
}

export interface AiCallOptions {
  requestId: string;              // idempotência e correlação de log
  timeoutMs: number;              // padrão 30000
  maxProviders: 1 | 2 | 3;        // teto do briefing: 3
  preferredProviders?: string[];  // prioridade separada da do WebiCheck
}

export type AiResult =
  | { ok: true;  text: string; provider: string; model: string;
      usage: { promptTokens?: number; completionTokens?: number };
      latencyMs: number; attempts: AiAttempt[] }
  | { ok: false; reason: AiFailure; attempts: AiAttempt[] };

export type AiFailure =
  | 'quota_exceeded'      // cota nossa (grupo/usuário), não do provedor
  | 'all_providers_failed'
  | 'circuit_open'
  | 'timeout'
  | 'invalid_response'
  | 'refused';

export interface AiAttempt {
  provider: string; model?: string; ok: boolean;
  httpStatus?: number; errorCode?: string; latencyMs: number;
}
```

`attempts[]` existe para tornar o critério de aceite 11 observável: o teste
verifica que, com o primeiro provedor devolvendo 429, o resultado traz dois
attempts e `ok: true` no segundo.

## 5.3 Mapeamento HTTP **proposto** (a confirmar)

```http
POST {AI_GATEWAY_URL}/v1/chat/completions
X-App-Name: whatsapp-bot
X-Service-Token: {AI_GATEWAY_TOKEN}
X-Request-Id: {uuid}
Idempotency-Key: {uuid}
Content-Type: application/json

{
  "capability": "balanced",
  "messages": [{ "role": "system", "content": "..." },
               { "role": "user",   "content": "..." }],
  "max_tokens": 800,
  "temperature": 0.8,
  "timeout_ms": 30000,
  "provider_priority": ["groq", "gemini", "openai"],
  "max_providers": 3
}
```

Resposta esperada (normalizada pelo adaptador para `AiResult`):

```json
{
  "text": "...",
  "provider": "groq",
  "model": "...",
  "usage": { "prompt_tokens": 812, "completion_tokens": 96 },
  "attempts": [{ "provider": "openai", "ok": false, "http_status": 429, "latency_ms": 320 },
               { "provider": "groq",   "ok": true,  "latency_ms": 780 }]
}
```

Se o formato real divergir, muda **apenas** `packages/ai/src/webicheck/mapper.ts`.

## 5.4 Failover e circuit breaker

Duas topologias possíveis, e a escolha depende da resposta em §5.6:

- **`AI_GATEWAY_HANDLES_FAILOVER=true`** — o gateway faz o rodízio; o adaptador
  faz uma chamada, respeita `max_providers: 3` e apenas registra `attempts[]`.
- **`AI_GATEWAY_HANDLES_FAILOVER=false`** — o adaptador faz o rodízio, chamando o
  gateway uma vez por provedor, na ordem de prioridade.

Em ambos os casos, do lado do bot:

| Condição | Ação |
|---|---|
| `429`, `5xx`, timeout, indisponível, modelo fora do ar | próximo provedor |
| `4xx` que não seja 429 (payload inválido, token errado) | **não** tenta outro; falha e alerta |
| 3 provedores tentados | para; devolve `all_providers_failed` |

**Circuit breaker por provedor** (`ai_provider_health`): 5 falhas consecutivas
abrem o circuito por 60 s → `half_open` deixa passar 1 sondagem → sucesso fecha,
falha reabre com backoff exponencial até 15 min. Provedor com circuito aberto é
pulado na seleção, sem gastar timeout.

**Sem resposta duplicada:** `requestId` é a chave de idempotência; a resposta
enviada ao WhatsApp é registrada com aquele `requestId` e uma segunda entrega do
mesmo job (retry do BullMQ) encontra o registro e não reenvia.

**Cotas** (separadas do WebiCheck, contadas em `ai_usage`): limite diário por
grupo (`ai_daily_limit`) e por participante (`ai_user_daily_limit`). Estourou →
`quota_exceeded` e mensagem curta explicando, **sem** consumir provedor.

**O que nunca gasta IA:** downloads, figurinhas, conversões, letras, jogos,
administração, `!menu`, `!ping`, `!status`. Isso é atributo declarado no registry
de comandos (`usesAi: false`) e há teste que percorre o registry e falha se um
comando dessas famílias declarar `usesAi: true`.

## 5.5 Personalidade estável entre provedores (critério de aceite 12)

Como todo o contexto é remontado do Postgres a cada chamada e `system` é gerado
pelo mesmo `PersonaRenderer` independentemente do destino, a troca de provedor não
altera personalidade. O teste de aceite roda a mesma pergunta com dois adaptadores
falsos diferentes e compara o payload `system` + `messages` enviado: deve ser
idêntico byte a byte.

## 5.6 O que preciso do WebiCheck antes de escrever o adaptador definitivo

Sem isso, o adaptador seria adivinhação. Basta o que você tiver:

1. **A rota real** — método, caminho completo e um `curl` de exemplo com request e
   response reais (pode anonimizar o token).
2. **Autenticação** — os cabeçalhos `X-App-Name` e `X-Service-Token` estão
   corretos? Como emito um token exclusivo para `whatsapp-bot`, separado do
   checklist?
3. **Seleção de modelo** — o gateway aceita "capacidade" (`fast`/`balanced`/`deep`)
   ou exige nome de modelo? Que valores existem?
4. **Failover** — quem faz o rodízio, o gateway ou o cliente? Existe parâmetro de
   prioridade de provedores? O gateway devolve qual provedor atendeu?
5. **Erros** — formato do corpo de erro e códigos usados para limite/indisponível.
6. **Streaming** — existe SSE? (Para WhatsApp não é necessário; queremos saber se
   o endpoint muda com `stream: false`.)
7. **Limites** — rate limit, tamanho máximo de payload, timeout do lado do gateway.
8. **Idempotência** — `Idempotency-Key` é respeitado?
9. **Cota** — como separar cota/prioridade do bot da cota dos checklists, para não
   competir com a capacidade de análise técnica do WebiCheck.
10. **Ambiente de teste** — existe URL de homologação para os testes de integração?

Enquanto essas respostas não chegam, a Etapa 1 segue completa: nada nela usa IA.
