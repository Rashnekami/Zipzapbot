/**
 * Escolha de qual destino publicar em seguida.
 *
 * Separado de `decidePacing` porque resolve outro problema. O ritmo responde
 * "posso enviar agora?"; a rotacao responde "para quem?".
 *
 * O motivo de existir apareceu medindo: com a cota global esgotando antes de a
 * lista acabar, percorrer os destinos em ordem fixa faz os primeiros receberem
 * tudo e os ultimos, nada. Numa simulacao de 24 horas com 20 grupos e cota de
 * 120, os nove ultimos ficaram com **zero** mensagens — todos os dias, para
 * sempre, porque a ordem nunca muda.
 *
 * Para quem opera divulgacao, isso e pior do que enviar menos: metade dos
 * grupos simplesmente nunca ve oferta nenhuma, e nada no sistema avisa.
 */

export interface RotationCandidate {
  readonly id: string;
  /** Ultimo envio para este destino, em ms. Ausente se nunca recebeu. */
  readonly lastSentAt?: number | undefined;
  /** Quantos ja saíram hoje para este destino. */
  readonly sentToday: number;
  /**
   * Peso relativo. Um destino com peso 2 recebe cerca do dobro de outro com
   * peso 1, quando ha cota sobrando.
   */
  readonly weight?: number | undefined;
  readonly isActive?: boolean | undefined;
}

/**
 * Ordena os destinos por prioridade de atendimento.
 *
 * Criterio, em ordem:
 *
 * 1. **Quem recebeu menos hoje**, ajustado pelo peso. E o que garante que
 *    nenhum destino fique de fora quando a cota acaba.
 * 2. **Quem esta ha mais tempo sem receber.** Desempata e evita que dois
 *    destinos empatados em zero se revezem sempre na mesma ordem.
 * 3. **Id**, so para a ordenacao ser deterministica e testavel.
 *
 * Destino que nunca recebeu vem antes de qualquer um que ja recebeu: entrou na
 * rotacao agora, e esperar o proximo ciclo inteiro seria injusto.
 */
export function sortByStarvation(
  candidates: readonly RotationCandidate[],
  now: number,
): RotationCandidate[] {
  return [...candidates]
    .filter((c) => c.isActive !== false)
    .sort((a, b) => {
      const cargaA = a.sentToday / Math.max(a.weight ?? 1, 0.01);
      const cargaB = b.sentToday / Math.max(b.weight ?? 1, 0.01);
      if (cargaA !== cargaB) return cargaA - cargaB;

      // Nunca recebeu conta como espera infinita.
      const esperaA = a.lastSentAt === undefined ? Infinity : now - a.lastSentAt;
      const esperaB = b.lastSentAt === undefined ? Infinity : now - b.lastSentAt;
      if (esperaA !== esperaB) return esperaB - esperaA;

      return a.id.localeCompare(b.id);
    });
}

/**
 * Proximo destino a tentar, ou `undefined` se nao ha nenhum ativo.
 *
 * Devolver o mais faminto nao garante que ele possa receber agora — quem decide
 * isso e `decidePacing`. Quem chama deve percorrer a lista ordenada ate achar um
 * que o ritmo libere, e parar no primeiro `hold` de teto global, porque nesse
 * caso nenhum outro vai passar.
 */
export function selectNextDestination(
  candidates: readonly RotationCandidate[],
  now: number,
): RotationCandidate | undefined {
  return sortByStarvation(candidates, now)[0];
}
