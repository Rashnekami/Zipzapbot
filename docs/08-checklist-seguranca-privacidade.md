# 8. Checklist de segurança e privacidade

Estado: `[ ]` a implementar · `[x]` implementado · `[—]` não se aplica à etapa.
Todos começam em `[ ]` porque a implementação ainda não foi iniciada.

## 8.1 Entrada e rede

- [ ] Somente esquemas `http` e `https` aceitos; qualquer outro rejeitado
- [ ] Allowlist de domínios (YouTube, Instagram, TikTok, Facebook, X, Kwai, SoundCloud)
- [ ] Anti-SSRF: resolver DNS antes de conectar e bloquear `127.0.0.0/8`, `10/8`,
      `172.16/12`, `192.168/16`, `169.254/16` (metadata), `::1`, ULA, multicast
- [ ] Redirecionamento não pode sair da allowlist; limite de saltos
- [ ] Timeout e tamanho máximo em toda requisição de saída

## 8.2 Execução de processos

- [ ] `spawn(bin, [args])` sempre com array; **nunca** `exec`/`shell: true`
- [ ] Nenhuma entrada de usuário concatenada em linha de comando
- [ ] Binários referenciados por caminho absoluto configurado, não por `PATH`
- [ ] Timeout com `SIGTERM` e `SIGKILL` de garantia em todo processo externo
- [ ] Limites de duração, resolução e tamanho aplicados como argumento, não só
      verificados depois

## 8.3 Arquivos

- [ ] Diretório temporário por job, nome gerado aleatoriamente
- [ ] Nome de arquivo nunca derivado de entrada do usuário
- [ ] Caminho canonicalizado e validado dentro da raiz permitida (anti path traversal)
- [ ] Limpeza em `finally`, cobrindo sucesso, erro e timeout
- [ ] Varredura periódica de temporários órfãos
- [ ] Cache de mídia expira em 24 h e é removido do disco junto com a linha

## 8.4 Segredos

- [ ] Segredo só em variável de ambiente; `.env` no `.gitignore`
- [ ] `.env.example` sem valor real
- [ ] Credenciais da sessão Baileys cifradas em repouso, em volume dedicado
- [ ] `redact` no pino para token, `Authorization`, `X-Service-Token`, telefone e JID
- [ ] Nenhum token em mensagem de erro enviada ao WhatsApp
- [ ] Varredura de segredo no CI, falhando o build
- [ ] Rotação documentada para `AI_GATEWAY_TOKEN` e `ENCRYPTION_KEY`

## 8.5 Autorização e abuso

- [ ] Permissão por função (participante, admin do grupo, dono do bot)
- [ ] Comandos de memória, personalidade, limites e configuração só para admin autorizado
- [ ] Rate limit por usuário e por grupo
- [ ] Um job ativo por usuário; dois downloads simultâneos por servidor
- [ ] Cota diária de mídia e cota diária de IA, contadas separadamente
- [ ] Toda ação administrativa registrada em `audit_log`

## 8.6 IA

- [ ] Conteúdo do grupo entra como dado delimitado e rotulado, nunca como instrução
- [ ] Delimitadores removidos do conteúdo antes da inserção
- [ ] Instruções de sistema antes e depois dos dados
- [ ] Filtro de saída contra vazamento de prompt e contra afirmação de identidade humana
- [ ] Teto de 3 provedores por solicitação; circuit breaker por provedor
- [ ] Idempotência por `requestId`, sem resposta duplicada
- [ ] IA jamais acionada sem menção real ou resposta a mensagem do bot

## 8.7 Dados pessoais (LGPD)

- [ ] Enum fechado de categorias de memória, sem categoria sensível
- [ ] Descarte, no pré-processamento, de trechos com cara de documento, cartão,
      senha, endereço ou dado de saúde — antes de qualquer envio a provedor
- [ ] Sem inferência sobre saúde, religião, orientação sexual, política ou finanças
- [ ] `!memoria status`, `!memoria apagar`, `!esquecer @participante` funcionando
- [ ] Reprocessamento do resumo após `!esquecer`, para que o texto consolidado
      também deixe de citar a pessoa
- [ ] Arquivo bruto do histórico apagado após a geração do resumo
- [ ] Consentimento registrado e confirmado pelo titular antes de ativar persona
      inspirada em colega; revogação disponível
- [ ] Bot sempre identificado como bot

## 8.8 Não será implementado (decisão de projeto)

Consulta de CPF, telefone, endereço ou placa · obtenção indevida de dado pessoal ·
travamento, exploit ou mensagem maliciosa · disparo em massa · monitoramento
oculto · mensagem falsa atribuída a terceiro · download de conteúdo privado, com
DRM ou que dependa de contornar autenticação · clonagem de voz ou imagem sem
autorização específica.

Esses itens não têm ponto de extensão no código: não existe módulo, comando nem
porta que os acomode.
