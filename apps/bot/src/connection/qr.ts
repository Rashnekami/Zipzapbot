import qrcode from 'qrcode-terminal';
import type { Logger } from '@zipzap/logger';

/**
 * Apresentacao do QR Code de pareamento.
 *
 * Guarda o codigo mais recente para que a API possa servi-lo (`GET /qr`), o que
 * cobre o caso de quem sobe o bot em servidor sem acesso ao terminal.
 *
 * O QR do WhatsApp expira em poucos segundos e e substituido por outro
 * automaticamente. Por isso guardamos o instante de emissao: servir um codigo
 * vencido faz a pessoa tentar ler algo que nunca vai funcionar, sem entender por
 * que.
 */
export class QrPresenter {
  private atual: string | undefined;
  private emitidoEm = 0;

  constructor(
    private readonly logger: Logger,
    private readonly validadeMs = 60_000,
    private readonly agora: () => number = Date.now,
  ) {}

  present(qr: string): void {
    this.atual = qr;
    this.emitidoEm = this.agora();

    // O proprio QR nao e segredo persistente: expira em segundos e so serve
    // para parear. Ainda assim nao vai para o log estruturado, so para a saida
    // do terminal, para nao acabar num agregador de logs.
    qrcode.generate(qr, { small: true }, (desenho: string) => {
      process.stdout.write(`\n${desenho}\n`);
    });

    this.logger.info(
      { validadeSegundos: Math.round(this.validadeMs / 1000) },
      'QR Code gerado: leia em Aparelhos conectados no WhatsApp',
    );
  }

  /** QR valido, ou `undefined` se nao ha nenhum ou o ultimo ja venceu. */
  get current(): string | undefined {
    if (this.atual === undefined) return undefined;
    return this.agora() - this.emitidoEm <= this.validadeMs ? this.atual : undefined;
  }

  clear(): void {
    this.atual = undefined;
    this.emitidoEm = 0;
  }
}
