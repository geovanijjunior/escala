/**
 * CPF: normalização e conferência dos dígitos verificadores.
 *
 * Conferir só o tamanho aceitaria `11111111111` e qualquer sequência de onze
 * dígitos digitada de qualquer jeito — e um CPF errado só aparece muito depois,
 * quando alguém tenta cruzar a base com a folha e não encontra a pessoa. O
 * cálculo abaixo é o do próprio documento, então o erro é pego na digitação.
 */

/** Só os dígitos, que é como o CPF é guardado. */
export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Confere os dois dígitos verificadores.
 *
 * Cada um é a soma dos anteriores com pesos decrescentes, módulo 11; resto
 * menor que 2 vira zero. Os repetidos (`000…`, `111…`) passam nessa conta por
 * acidente aritmético e são recusados à parte — são a forma mais comum de
 * alguém "preencher" um campo obrigatório que não quer preencher.
 */
export function cpfValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** `12345678909` → `123.456.789-09`, para mostrar. */
export function formatarCpf(valor: string): string {
  const d = soDigitos(valor);
  if (d.length !== 11) return valor;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Telefone brasileiro com DDD: dez dígitos (fixo) ou onze (celular).
 *
 * Sem validar operadora nem o nono dígito: número de contato é para alguém
 * ligar, e recusar um que a pessoa de fato usa por causa de uma regra de
 * numeração seria trocar um problema pequeno por um maior.
 */
export function telefoneValido(valor: string): boolean {
  const d = soDigitos(valor);
  return d.length === 10 || d.length === 11;
}

/** `11987654321` → `(11) 98765-4321`. */
export function formatarTelefone(valor: string): string {
  const d = soDigitos(valor);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor;
}
