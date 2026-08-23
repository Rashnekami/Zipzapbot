/**
 * Ritmo de envio da divulgacao.
 *
 * Esta e a peca que decide se o numero sobrevive. O WhatsApp nao publica os
 * criterios que usa para bloquear conta, mas os padroes que mais se parecem com
 * automacao sao conhecidos: volume alto logo apos o primeiro pareamento,
 * intervalo exato entre mensagens, rajada concentrada e envio de madrugada.
 * Cada regra abaixo existe para desfazer um desses padroes.
 *
 * E funcao pura, com relogio injetado, de proposito: cada regra pode ser
 * testada isoladamente, sem socket e sem arriscar uma conta de verdade.
 */

export interface QuietHours {
  /** Hora local em que o silencio comeca, 0-23. */
  readonly startHour: number;
  /** Hora local em que o silencio termina, 0-23. */
  readonly endHour: number;
}

export interface WarmupConfig {
  /**
   * Teto de envios por dia de vida do numero, do primeiro dia em diante.
   *
   * Numero recem-pareado que dispara duzentas mensagens no primeiro dia e o
   * padrao mais obvio de automacao que existe. A rampa faz o volume crescer
   * como cresceria o de um canal real ganhando publico.
   */
  readonly dailyCaps: readonly number[];
  /** Quando o numero foi pareado, em ms. */
  readonly startedAt: number;
}

export interface PacingConfig {
  /** Teto de mensagens por minuto somando todos os destinos. */
  readonly maxPerMinute: number;
  /** Intervalo minimo entre dois envios para o mesmo destino. */
  readonly minIntervalPerDestinationMs: number;
  /** Teto diario por destino. */
  readonly dailyCapPerDestination: number;
  /** Teto diario global, antes do aquecimento. */
  readonly dailyCapGlobal: number;
  /**
   * Fracao do intervalo usada como variacao aleatoria, de 0 a 1.
   *
   * Enviar exatamente a cada 30 segundos e assinatura de robo. Com 0.4, o
   * intervalo real varia entre 30 e 42 segundos.
   */
  readonly jitterRatio: number;
  readonly quietHours?: QuietHours;
  readonly warmup?: WarmupConfig;
  /**
   * Espalha a cota do dia pela janela ativa, em vez de gastar tudo de manha.
   *
   * Sem isso, o limitador so impoe teto: a cota inteira sai nas primeiras horas
   * depois que o silencio termina e o resto do dia fica mudo. Medido: com o
   * padrao e numero maduro, 120 mensagens saiam todas entre 7h e 9h. Isso e
   * ruim de duas maneiras — rajada concentrada parece automacao, e o publico do
   * grupo nao esta olhando o celular todo as 7h.
   */
  readonly spreadAcrossDay?: boolean;
}

/**
 * Padrao deliberadamente conservador.
 *
 * Aumentar e decisao consciente do operador. Comecar frouxo e apertar depois nao
 * funciona: quando o bloqueio chega, o numero ja se foi.
 */
export const DEFAULT_PACING: PacingConfig = {
  maxPerMinute: 4,
  minIntervalPerDestinationMs: 10 * 60_000,
  dailyCapPerDestination: 12,
  dailyCapGlobal: 120,
  jitterRatio: 0.4,
  quietHours: { startHour: 23, endHour: 7 },
  spreadAcrossDay: true,
};

/** Rampa padrao: sobe ao longo de duas semanas ate o teto configurado. */
export const DEFAULT_WARMUP_CAPS: readonly number[] = [
  5, 8, 12, 18, 25, 35, 45, 60, 75, 90, 105, 120,
];

export interface PacingState {
  /** Ultimo envio para este destino, em ms. Ausente se nunca enviamos. */
  readonly lastSentToDestinationAt?: number | undefined;
  /** Ultimo envio para qualquer destino, em ms. */
  readonly lastSentAnywhereAt?: number | undefined;
  /** Quantos ja saíram hoje para este destino. */
  readonly sentTodayToDestination: number;
  /** Quantos ja saíram hoje no total. */
  readonly sentTodayGlobal: number;
  /**
   * Quantas publicacoes ainda cabem hoje, somando o que cada destino aceita.
   *
   * Informado pelo agendador, que conhece todos os destinos; `decidePacing` so
   * enxerga um por vez. Sem esta dica, o espalhamento divide a janela do dia
   * pela cota global e termina cedo demais quando o teto por destino e o
   * limitante de verdade. Medido: com 3 grupos e cota global de 120, as 36
   * publicacoes possiveis saíam todas ate as 11h e o resto do dia ficava mudo.
   */
  readonly plannedRemainingToday?: number | undefined;
}

export type PacingDecision =
  /** Pode enviar agora, apos esperar `waitMs`. */
  | { readonly action: 'send'; readonly waitMs: number }
  /** Adie e tente de novo em `retryAtMs`. */
  | { readonly action: 'defer'; readonly retryAtMs: number; readonly reason: PacingReason }
  /** Nao envie hoje. */
  | { readonly action: 'hold'; readonly retryAtMs: number; readonly reason: PacingReason };

export type PacingReason =
  | 'quiet_hours'
  | 'warmup_cap'
  | 'daily_cap_global'
  | 'daily_cap_destination'
  | 'destination_interval'
  | 'global_rate'
  | 'day_spread';

const UM_DIA_MS = 86_400_000;

/** Teto diario efetivo, considerando o aquecimento do numero. */
export function effectiveDailyCap(config: PacingConfig, now: number): number {
  const { warmup, dailyCapGlobal } = config;
  if (warmup === undefined || warmup.dailyCaps.length === 0) return dailyCapGlobal;

  const diasDeVida = Math.max(0, Math.floor((now - warmup.startedAt) / UM_DIA_MS));
  const ultimo = warmup.dailyCaps[warmup.dailyCaps.length - 1] ?? dailyCapGlobal;
  const daRampa = warmup.dailyCaps[diasDeVida] ?? ultimo;

  // A rampa so limita; nunca autoriza mais do que o teto configurado.
  return Math.min(daRampa, dailyCapGlobal);
}

/**
 * Estamos dentro do horario de silencio?
 *
 * Trata janela que cruza a meia-noite, que e o caso normal (23h as 7h).
 */
export function isQuietHour(hour: number, quiet: QuietHours): boolean {
  const { startHour, endHour } = quiet;
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/** Proximo instante em que o silencio termina. */
function fimDoSilencio(now: number, quiet: QuietHours, hourOf: (t: number) => number): number {
  let instante = now;
  // Avanca de hora em hora ate sair da janela. No maximo 24 passos.
  for (let i = 0; i < 24; i++) {
    instante = Math.ceil((instante + 1) / 3_600_000) * 3_600_000;
    if (!isQuietHour(hourOf(instante), quiet)) return instante;
  }
  return now + UM_DIA_MS;
}

/** Meia-noite seguinte, quando os contadores diarios zeram. */
function proximaVirada(now: number, hourOf: (t: number) => number): number {
  const hora = hourOf(now);
  const horasAteMeiaNoite = 24 - hora;
  return Math.ceil((now + horasAteMeiaNoite * 3_600_000) / 3_600_000) * 3_600_000;
}

/**
 * Quanto falta da janela ativa de hoje, em ms.
 *
 * Janela ativa e o tempo ate o silencio comecar. Sem silencio configurado, e o
 * que falta ate a virada do dia.
 */
export function remainingActiveMs(
  now: number,
  quiet: QuietHours | undefined,
  hourOf: (t: number) => number,
): number {
  const horaAtual = hourOf(now);
  const msNaHora = now - Math.floor(now / 3_600_000) * 3_600_000;

  const horaFim = quiet === undefined ? 24 : quiet.startHour;
  // Janela que cruza a meia-noite: o silencio comeca ainda hoje.
  const horasRestantes = horaFim > horaAtual ? horaFim - horaAtual : 24 - horaAtual + horaFim;

  return Math.max(horasRestantes * 3_600_000 - msNaHora, 0);
}

export interface PacingInput {
  readonly config: PacingConfig;
  readonly state: PacingState;
  readonly now: number;
  /** Hora local de um instante. Injetado para nao depender do fuso do processo. */
  readonly hourOf: (timestamp: number) => number;
  readonly random?: () => number;
}

/**
 * Decide se uma publicacao pode sair agora.
 *
 * A ordem das verificacoes importa: as que valem para o dia inteiro vem antes
 * das que valem para os proximos segundos, para que um `hold` de teto diario nao
 * seja mascarado por um `defer` de intervalo curto.
 */
export function decidePacing(input: PacingInput): PacingDecision {
  const { config, state, now, hourOf } = input;
  const random = input.random ?? Math.random;

  // 1. Horario de silencio.
  if (config.quietHours !== undefined && isQuietHour(hourOf(now), config.quietHours)) {
    return {
      action: 'defer',
      retryAtMs: fimDoSilencio(now, config.quietHours, hourOf),
      reason: 'quiet_hours',
    };
  }

  // 2. Aquecimento e teto diario global. Ambos so liberam na virada do dia.
  const tetoDiario = effectiveDailyCap(config, now);
  if (state.sentTodayGlobal >= tetoDiario) {
    const porAquecimento = tetoDiario < config.dailyCapGlobal;
    return {
      action: 'hold',
      retryAtMs: proximaVirada(now, hourOf),
      reason: porAquecimento ? 'warmup_cap' : 'daily_cap_global',
    };
  }

  // 3. Teto diario do destino.
  if (state.sentTodayToDestination >= config.dailyCapPerDestination) {
    return {
      action: 'hold',
      retryAtMs: proximaVirada(now, hourOf),
      reason: 'daily_cap_destination',
    };
  }

  // 4. Intervalo minimo para o mesmo destino.
  const ultimoNoDestino = state.lastSentToDestinationAt;
  if (ultimoNoDestino !== undefined) {
    const liberaEm = ultimoNoDestino + config.minIntervalPerDestinationMs;
    if (liberaEm > now) {
      return { action: 'defer', retryAtMs: liberaEm, reason: 'destination_interval' };
    }
  }

  // 5. Ritmo global, com jitter.
  //
  // O jitter e somado ao intervalo, nunca subtraido: encurtar o espacamento para
  // caber no ritmo derrotaria o proprio limite.
  const intervaloPorRitmo = 60_000 / Math.max(config.maxPerMinute, 1);

  // Intervalo que distribui o que resta da cota pelo que resta do dia ativo.
  // Se ficarmos para tras, ele encolhe sozinho e o ritmo se recupera.
  const intervaloPorEspalhamento = (() => {
    if (config.spreadAcrossDay !== true) return 0;
    const restantePelaCotaGlobal = tetoDiario - state.sentTodayGlobal;
    const restanteDaCota =
      state.plannedRemainingToday === undefined
        ? restantePelaCotaGlobal
        : Math.min(restantePelaCotaGlobal, state.plannedRemainingToday);
    if (restanteDaCota <= 1) return 0;
    const restanteDoDia = remainingActiveMs(now, config.quietHours, hourOf);
    return restanteDoDia / restanteDaCota;
  })();

  const intervaloBase = Math.max(intervaloPorRitmo, intervaloPorEspalhamento);
  const jitter = intervaloPorRitmo * config.jitterRatio * random();
  const ultimoGlobal = state.lastSentAnywhereAt;

  if (ultimoGlobal !== undefined) {
    const liberaEm = ultimoGlobal + intervaloBase + jitter;
    if (liberaEm > now) {
      return {
        action: 'defer',
        retryAtMs: Math.ceil(liberaEm),
        reason: intervaloPorEspalhamento > intervaloPorRitmo ? 'day_spread' : 'global_rate',
      };
    }
  }

  // Mesmo liberado, espalha um pouco: sair no instante exato em que o limite
  // vence, repetidamente, produz a regularidade que queremos evitar.
  return { action: 'send', waitMs: Math.round(jitter) };
}
