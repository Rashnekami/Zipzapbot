import { describe, expect, it } from 'vitest';
import {
  decidePacing,
  effectiveDailyCap,
  isQuietHour,
  DEFAULT_PACING,
  DEFAULT_WARMUP_CAPS,
  type PacingConfig,
  type PacingInput,
  type PacingState,
} from './pacing.js';

const HORA = 3_600_000;
const DIA = 86_400_000;

/** Relogio simples: instante 0 e meia-noite; hora local = ms / 1h mod 24. */
const hourOf = (t: number): number => Math.floor(t / HORA) % 24;

const estadoLimpo: PacingState = {
  sentTodayToDestination: 0,
  sentTodayGlobal: 0,
};

function decidir(over: Partial<PacingInput> = {}) {
  return decidePacing({
    config: DEFAULT_PACING,
    state: estadoLimpo,
    now: 12 * HORA, // meio-dia, fora do silencio
    hourOf,
    random: () => 0.5,
    ...over,
  });
}

describe('isQuietHour', () => {
  it('trata janela que cruza a meia-noite, que e o caso normal', () => {
    const noite = { startHour: 23, endHour: 7 };
    expect(isQuietHour(23, noite)).toBe(true);
    expect(isQuietHour(3, noite)).toBe(true);
    expect(isQuietHour(6, noite)).toBe(true);
    expect(isQuietHour(7, noite)).toBe(false);
    expect(isQuietHour(12, noite)).toBe(false);
    expect(isQuietHour(22, noite)).toBe(false);
  });

  it('trata janela dentro do mesmo dia', () => {
    const almoco = { startHour: 12, endHour: 14 };
    expect(isQuietHour(13, almoco)).toBe(true);
    expect(isQuietHour(14, almoco)).toBe(false);
    expect(isQuietHour(11, almoco)).toBe(false);
  });

  it('janela de tamanho zero nao silencia nada', () => {
    expect(isQuietHour(5, { startHour: 5, endHour: 5 })).toBe(false);
  });
});

describe('effectiveDailyCap — aquecimento do numero', () => {
  const comRampa: PacingConfig = {
    ...DEFAULT_PACING,
    dailyCapGlobal: 120,
    warmup: { dailyCaps: DEFAULT_WARMUP_CAPS, startedAt: 0 },
  };

  it('primeiro dia e bem restrito', () => {
    expect(effectiveDailyCap(comRampa, 0)).toBe(5);
    expect(effectiveDailyCap(comRampa, 12 * HORA)).toBe(5);
  });

  it('cresce dia a dia', () => {
    const dias = [0, 1, 2, 3, 4].map((d) => effectiveDailyCap(comRampa, d * DIA));
    for (let i = 1; i < dias.length; i++) {
      expect(dias[i]!).toBeGreaterThan(dias[i - 1]!);
    }
  });

  it('estabiliza no ultimo degrau depois que a rampa acaba', () => {
    expect(effectiveDailyCap(comRampa, 90 * DIA)).toBe(120);
  });

  it('a rampa so limita, nunca autoriza acima do teto configurado', () => {
    const tetoBaixo: PacingConfig = {
      ...comRampa,
      dailyCapGlobal: 10,
    };
    // Rampa madura pediria 120; o teto do operador manda.
    expect(effectiveDailyCap(tetoBaixo, 90 * DIA)).toBe(10);
  });

  it('sem rampa configurada, usa o teto direto', () => {
    expect(effectiveDailyCap(DEFAULT_PACING, 0)).toBe(DEFAULT_PACING.dailyCapGlobal);
  });
});

describe('decidePacing', () => {
  it('libera o primeiro envio do dia', () => {
    const d = decidir();
    expect(d.action).toBe('send');
  });

  describe('horario de silencio', () => {
    it('adia envio de madrugada', () => {
      const d = decidir({ now: 3 * HORA });
      expect(d.action).toBe('defer');
      if (d.action === 'defer') expect(d.reason).toBe('quiet_hours');
    });

    it('adia para o fim do silencio, nao para daqui a pouco', () => {
      const d = decidir({ now: 3 * HORA });
      if (d.action !== 'defer') throw new Error('esperava defer');
      expect(hourOf(d.retryAtMs)).toBe(7);
    });

    it('adia tambem no comeco da janela, antes da meia-noite', () => {
      const d = decidir({ now: 23 * HORA + 30 * 60_000 });
      expect(d.action).toBe('defer');
      if (d.action === 'defer') expect(hourOf(d.retryAtMs)).toBe(7);
    });

    it('libera assim que o silencio termina', () => {
      expect(decidir({ now: 7 * HORA }).action).toBe('send');
    });
  });

  describe('tetos diarios', () => {
    it('segura quando o teto global do dia foi atingido', () => {
      const d = decidir({
        state: { ...estadoLimpo, sentTodayGlobal: DEFAULT_PACING.dailyCapGlobal },
      });
      expect(d.action).toBe('hold');
      if (d.action === 'hold') expect(d.reason).toBe('daily_cap_global');
    });

    it('segura ate a virada do dia, nao ate daqui a uma hora', () => {
      const d = decidir({
        now: 14 * HORA,
        state: { ...estadoLimpo, sentTodayGlobal: DEFAULT_PACING.dailyCapGlobal },
      });
      if (d.action !== 'hold') throw new Error('esperava hold');
      expect(d.retryAtMs).toBe(24 * HORA);
    });

    it('segura quando o destino ja recebeu o maximo do dia', () => {
      const d = decidir({
        state: {
          ...estadoLimpo,
          sentTodayToDestination: DEFAULT_PACING.dailyCapPerDestination,
        },
      });
      expect(d.action).toBe('hold');
      if (d.action === 'hold') expect(d.reason).toBe('daily_cap_destination');
    });

    it('teto de aquecimento aparece com motivo proprio, nao como teto global', () => {
      const config: PacingConfig = {
        ...DEFAULT_PACING,
        warmup: { dailyCaps: DEFAULT_WARMUP_CAPS, startedAt: 0 },
      };
      // Primeiro dia: rampa permite 5.
      const d = decidePacing({
        config,
        state: { ...estadoLimpo, sentTodayGlobal: 5 },
        now: 12 * HORA,
        hourOf,
        random: () => 0.5,
      });

      expect(d.action).toBe('hold');
      if (d.action === 'hold') expect(d.reason).toBe('warmup_cap');
    });

    it('numero novo nao consegue disparar volume alto no primeiro dia', () => {
      const config: PacingConfig = {
        ...DEFAULT_PACING,
        warmup: { dailyCaps: DEFAULT_WARMUP_CAPS, startedAt: 0 },
      };

      let enviados = 0;
      for (let tentativa = 0; tentativa < 200; tentativa++) {
        const d = decidePacing({
          config,
          state: {
            sentTodayGlobal: enviados,
            sentTodayToDestination: 0,
            // sem restricao de intervalo, para isolar o teto
            lastSentAnywhereAt: undefined,
            lastSentToDestinationAt: undefined,
          },
          now: 12 * HORA,
          hourOf,
          random: () => 0.5,
        });
        if (d.action !== 'send') break;
        enviados += 1;
      }

      expect(enviados).toBe(5);
    });
  });

  describe('intervalo por destino', () => {
    it('adia quando o mesmo grupo recebeu ha pouco', () => {
      const agora = 12 * HORA;
      const d = decidir({
        now: agora,
        state: { ...estadoLimpo, lastSentToDestinationAt: agora - 60_000 },
      });

      expect(d.action).toBe('defer');
      if (d.action === 'defer') {
        expect(d.reason).toBe('destination_interval');
        expect(d.retryAtMs).toBe(agora - 60_000 + DEFAULT_PACING.minIntervalPerDestinationMs);
      }
    });

    it('libera depois do intervalo', () => {
      const agora = 12 * HORA;
      const d = decidir({
        now: agora,
        state: {
          ...estadoLimpo,
          lastSentToDestinationAt: agora - DEFAULT_PACING.minIntervalPerDestinationMs - 1,
        },
      });
      expect(d.action).toBe('send');
    });
  });

  describe('ritmo global e jitter', () => {
    it('adia quando o envio anterior foi ha instantes', () => {
      const agora = 12 * HORA;
      const d = decidir({
        now: agora,
        state: { ...estadoLimpo, lastSentAnywhereAt: agora - 100 },
      });

      expect(d.action).toBe('defer');
    });

    it('sem espalhamento, o motivo e o ritmo global', () => {
      const agora = 12 * HORA;
      const d = decidePacing({
        config: { ...DEFAULT_PACING, spreadAcrossDay: false },
        state: { ...estadoLimpo, lastSentAnywhereAt: agora - 100 },
        now: agora,
        hourOf,
        random: () => 0.5,
      });

      expect(d.action).toBe('defer');
      if (d.action === 'defer') expect(d.reason).toBe('global_rate');
    });

    it('com espalhamento, o motivo e a distribuicao pelo dia', () => {
      const agora = 12 * HORA;
      const d = decidir({
        now: agora,
        state: { ...estadoLimpo, lastSentAnywhereAt: agora - 100 },
      });

      // Ao meio-dia, com 120 de cota e 11 horas ate o silencio, o intervalo que
      // distribui (cerca de 5 min) e muito maior que o do ritmo (15 s).
      if (d.action !== 'defer') throw new Error('esperava defer');
      expect(d.reason).toBe('day_spread');
    });

    it('o jitter nunca encurta o intervalo abaixo do limite', () => {
      const agora = 12 * HORA;
      const intervaloBase = 60_000 / DEFAULT_PACING.maxPerMinute;

      // Com random = 0, o jitter e zero e o intervalo e exatamente o base.
      const semJitter = decidePacing({
        config: DEFAULT_PACING,
        state: { ...estadoLimpo, lastSentAnywhereAt: agora - intervaloBase + 1 },
        now: agora,
        hourOf,
        random: () => 0,
      });
      expect(semJitter.action).toBe('defer');

      // Com random = 1, espera ainda mais. Nunca menos.
      const comJitter = decidePacing({
        config: DEFAULT_PACING,
        state: { ...estadoLimpo, lastSentAnywhereAt: agora - intervaloBase },
        now: agora,
        hourOf,
        random: () => 1,
      });
      expect(comJitter.action).toBe('defer');
    });

    it('dois envios seguidos nao saem no mesmo intervalo exato', () => {
      const agora = 12 * HORA;
      const esperas = [0.1, 0.9].map((r) => {
        const d = decidePacing({
          config: DEFAULT_PACING,
          state: { ...estadoLimpo, lastSentAnywhereAt: agora - 1_000 },
          now: agora,
          hourOf,
          random: () => r,
        });
        return d.action === 'defer' ? d.retryAtMs : -1;
      });

      // Intervalo identico a cada envio e assinatura de robo.
      expect(esperas[0]).not.toBe(esperas[1]);
    });

    it('mesmo liberado, espalha um pouco em vez de sair no instante exato', () => {
      const d = decidir({ random: () => 1 });
      if (d.action !== 'send') throw new Error('esperava send');
      expect(d.waitMs).toBeGreaterThan(0);
    });
  });

  describe('ordem das regras', () => {
    it('teto diario ganha do intervalo curto: hold nao vira defer', () => {
      const agora = 12 * HORA;
      const d = decidir({
        now: agora,
        state: {
          sentTodayGlobal: DEFAULT_PACING.dailyCapGlobal,
          sentTodayToDestination: 0,
          lastSentAnywhereAt: agora - 100,
          lastSentToDestinationAt: agora - 100,
        },
      });

      // Se o intervalo curto respondesse primeiro, o chamador tentaria de novo
      // em segundos e ficaria em laco ate a meia-noite.
      expect(d.action).toBe('hold');
      if (d.action === 'hold') expect(d.reason).toBe('daily_cap_global');
    });

    it('silencio ganha de tudo: nao publica de madrugada nem com cota livre', () => {
      const d = decidir({ now: 4 * HORA, state: estadoLimpo });
      expect(d.action).toBe('defer');
      if (d.action === 'defer') expect(d.reason).toBe('quiet_hours');
    });
  });

  describe('padrao conservador', () => {
    it('o padrao nao permite mais de 4 mensagens por minuto', () => {
      expect(DEFAULT_PACING.maxPerMinute).toBeLessThanOrEqual(4);
    });

    it('o padrao nao repete no mesmo grupo em menos de 10 minutos', () => {
      expect(DEFAULT_PACING.minIntervalPerDestinationMs).toBeGreaterThanOrEqual(10 * 60_000);
    });

    it('o padrao tem horario de silencio ligado', () => {
      expect(DEFAULT_PACING.quietHours).toBeDefined();
    });
  });
});

describe('simulacao de um dia inteiro', () => {
  it('respeita todos os limites ao longo de 24 horas', () => {
    const config: PacingConfig = {
      ...DEFAULT_PACING,
      warmup: { dailyCaps: DEFAULT_WARMUP_CAPS, startedAt: -30 * DIA }, // numero maduro
    };

    const destinos = ['g1', 'g2', 'g3'];
    const porDestino = new Map(
      destinos.map((d) => [d, { ultimo: undefined as number | undefined, hoje: 0 }]),
    );

    let global = 0;
    let ultimoGlobal: number | undefined;
    let agora = 0;
    const enviosEm: number[] = [];

    // Avanca minuto a minuto por 24 horas, tentando publicar em cada destino.
    while (agora < DIA) {
      for (const destino of destinos) {
        const estadoDestino = porDestino.get(destino)!;
        const d = decidePacing({
          config,
          state: {
            lastSentToDestinationAt: estadoDestino.ultimo,
            lastSentAnywhereAt: ultimoGlobal,
            sentTodayToDestination: estadoDestino.hoje,
            sentTodayGlobal: global,
          },
          now: agora,
          hourOf,
          random: () => 0.5,
        });

        if (d.action === 'send') {
          const instante = agora + d.waitMs;
          enviosEm.push(instante);
          estadoDestino.ultimo = instante;
          estadoDestino.hoje += 1;
          ultimoGlobal = instante;
          global += 1;
        }
      }
      agora += 60_000;
    }

    // Nunca publicou de madrugada.
    for (const t of enviosEm) {
      expect(isQuietHour(hourOf(t), config.quietHours!), `envio as ${hourOf(t)}h`).toBe(false);
    }

    // Nunca passou do teto diario nem do teto por destino.
    expect(global).toBeLessThanOrEqual(config.dailyCapGlobal);
    for (const [, e] of porDestino) {
      expect(e.hoje).toBeLessThanOrEqual(config.dailyCapPerDestination);
    }

    // E de fato publicou: um limitador que zera tudo nao serve de nada.
    expect(global).toBeGreaterThan(0);

    // Em nenhuma janela de 60 segundos saiu mais que o teto por minuto.
    for (let i = 0; i < enviosEm.length; i++) {
      const naJanela = enviosEm.filter((t) => t >= enviosEm[i]! && t < enviosEm[i]! + 60_000);
      expect(naJanela.length).toBeLessThanOrEqual(config.maxPerMinute);
    }
  });
});

describe('espalhamento respeita o que e alcancavel, nao so a cota global', () => {
  it('com poucos destinos, distribui pelo dia em vez de terminar de manha', () => {
    const agora = 8 * HORA;

    // Cota global de 120, mas so 36 publicacoes cabem (3 destinos x 12).
    const semDica = decidePacing({
      config: DEFAULT_PACING,
      state: { ...estadoLimpo, lastSentAnywhereAt: agora - 1000 },
      now: agora,
      hourOf,
      random: () => 0,
    });

    const comDica = decidePacing({
      config: DEFAULT_PACING,
      state: { ...estadoLimpo, lastSentAnywhereAt: agora - 1000, plannedRemainingToday: 36 },
      now: agora,
      hourOf,
      random: () => 0,
    });

    if (semDica.action !== 'defer' || comDica.action !== 'defer') {
      throw new Error('esperava defer nos dois');
    }
    // Menos publicacoes para o mesmo dia significa intervalo maior entre elas.
    expect(comDica.retryAtMs).toBeGreaterThan(semDica.retryAtMs);
  });

  it('a dica nunca autoriza mais que a cota global', () => {
    const agora = 12 * HORA;
    const d = decidePacing({
      config: DEFAULT_PACING,
      state: {
        ...estadoLimpo,
        sentTodayGlobal: DEFAULT_PACING.dailyCapGlobal,
        plannedRemainingToday: 9999,
      },
      now: agora,
      hourOf,
      random: () => 0.5,
    });

    expect(d.action).toBe('hold');
  });
});
