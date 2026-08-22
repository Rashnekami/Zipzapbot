/**
 * Result explícito para operações que falham por motivo previsto.
 *
 * A regra do projeto: `throw` fica reservado para defeito de programação
 * (invariante quebrada, estado impossível). Falha esperada — link inválido,
 * cota estourada, provedor fora do ar — é valor de retorno, porque o chamador
 * precisa tratá-la e o compilador precisa cobrar isso dele.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Aplica `fn` ao valor de sucesso, propagando o erro intacto. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Encadeia operações que também podem falhar, sem aninhar `if`. */
export function andThen<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/** Extrai o valor ou devolve o padrão. Nunca lança. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
