import { describe, expect, it } from 'vitest';
import {
  selectNextDestination,
  sortByStarvation,
  type RotationCandidate,
} from './destination-rotation.js';

const AGORA = 1_000_000;

describe('sortByStarvation', () => {
  it('poe primeiro quem recebeu menos hoje', () => {
    const ordem = sortByStarvation(
      [
        { id: 'a', sentToday: 5, lastSentAt: AGORA - 1000 },
        { id: 'b', sentToday: 1, lastSentAt: AGORA - 1000 },
        { id: 'c', sentToday: 3, lastSentAt: AGORA - 1000 },
      ],
      AGORA,
    );
    expect(ordem.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('quem nunca recebeu vem antes de quem ja recebeu ha muito tempo', () => {
    const ordem = sortByStarvation(
      [
        { id: 'antigo', sentToday: 0, lastSentAt: AGORA - 10 * 86_400_000 },
        { id: 'novo', sentToday: 0 },
      ],
      AGORA,
    );
    expect(ordem[0]?.id).toBe('novo');
  });

  it('desempata pelo que esta ha mais tempo sem receber', () => {
    const ordem = sortByStarvation(
      [
        { id: 'recente', sentToday: 2, lastSentAt: AGORA - 60_000 },
        { id: 'antigo', sentToday: 2, lastSentAt: AGORA - 600_000 },
      ],
      AGORA,
    );
    expect(ordem[0]?.id).toBe('antigo');
  });

  it('respeita peso: destino de peso 2 tolera o dobro antes de perder a vez', () => {
    const ordem = sortByStarvation(
      [
        { id: 'grande', sentToday: 3, weight: 2, lastSentAt: AGORA },
        { id: 'pequeno', sentToday: 2, weight: 1, lastSentAt: AGORA },
      ],
      AGORA,
    );
    // carga: grande = 1.5, pequeno = 2.0
    expect(ordem[0]?.id).toBe('grande');
  });

  it('ignora destino desativado', () => {
    const ordem = sortByStarvation(
      [
        { id: 'desligado', sentToday: 0, isActive: false },
        { id: 'ligado', sentToday: 9 },
      ],
      AGORA,
    );
    expect(ordem.map((d) => d.id)).toEqual(['ligado']);
  });

  it('e deterministico com empate total', () => {
    const iguais: RotationCandidate[] = [
      { id: 'c', sentToday: 0 },
      { id: 'a', sentToday: 0 },
      { id: 'b', sentToday: 0 },
    ];
    expect(sortByStarvation(iguais, AGORA).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('nao altera a lista recebida', () => {
    const original: RotationCandidate[] = [
      { id: 'a', sentToday: 5 },
      { id: 'b', sentToday: 1 },
    ];
    sortByStarvation(original, AGORA);
    expect(original.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('lista vazia nao quebra', () => {
    expect(sortByStarvation([], AGORA)).toEqual([]);
    expect(selectNextDestination([], AGORA)).toBeUndefined();
  });

  it('peso zero ou negativo nao causa divisao por zero', () => {
    const ordem = sortByStarvation(
      [
        { id: 'zero', sentToday: 1, weight: 0 },
        { id: 'normal', sentToday: 1, weight: 1 },
      ],
      AGORA,
    );
    expect(ordem).toHaveLength(2);
    expect(ordem.every((d) => Number.isFinite(d.sentToday))).toBe(true);
  });
});

describe('rotacao ao longo de um dia — o problema que motivou este arquivo', () => {
  it('distribui a cota entre todos os destinos, sem deixar nenhum a zero', () => {
    const N_DESTINOS = 20;
    const COTA = 120;

    const estado = new Map(
      Array.from({ length: N_DESTINOS }, (_, i) => [
        `g${String(i).padStart(2, '0')}`,
        { sentToday: 0, lastSentAt: undefined as number | undefined },
      ]),
    );

    for (let enviado = 0; enviado < COTA; enviado++) {
      const candidatos: RotationCandidate[] = [...estado].map(([id, e]) => ({
        id,
        sentToday: e.sentToday,
        lastSentAt: e.lastSentAt,
      }));

      const escolhido = selectNextDestination(candidatos, AGORA + enviado * 60_000);
      expect(escolhido).toBeDefined();

      const e = estado.get(escolhido!.id)!;
      e.sentToday += 1;
      e.lastSentAt = AGORA + enviado * 60_000;
    }

    const totais = [...estado.values()].map((e) => e.sentToday);

    // Nenhum destino fica de fora. Era exatamente o que acontecia com ordem fixa.
    expect(Math.min(...totais), `distribuicao: ${totais.join(',')}`).toBeGreaterThan(0);
    // E a distribuicao e equilibrada: no maximo um de diferenca.
    expect(Math.max(...totais) - Math.min(...totais)).toBeLessThanOrEqual(1);
    expect(totais.reduce((a, b) => a + b, 0)).toBe(COTA);
  });

  it('destino novo no meio do dia entra na frente e alcança os demais', () => {
    const estado = new Map<string, { sentToday: number; lastSentAt?: number }>([
      ['antigo1', { sentToday: 6, lastSentAt: AGORA }],
      ['antigo2', { sentToday: 6, lastSentAt: AGORA }],
    ]);
    estado.set('novo', { sentToday: 0 });

    for (let i = 0; i < 6; i++) {
      const escolhido = selectNextDestination(
        [...estado].map(([id, e]) => ({
          id,
          sentToday: e.sentToday,
          lastSentAt: e.lastSentAt,
        })),
        AGORA + i * 60_000,
      );
      const e = estado.get(escolhido!.id)!;
      e.sentToday += 1;
      e.lastSentAt = AGORA + i * 60_000;
    }

    // Todas as seis vagas foram para o recem-chegado, ate empatar.
    expect(estado.get('novo')?.sentToday).toBe(6);
  });
});
