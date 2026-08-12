/**
 * Regras dos anexos do mural.
 *
 * Vive fora do arquivo de Server Actions porque o formulário (cliente) também
 * precisa das duas constantes — e um arquivo `'use server'` só pode exportar
 * função assíncrona.
 */

/** Tipos aceitos como anexo. A mesma lista está no CHECK da tabela. */
export const TIPOS_ANEXO = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

/**
 * Teto de 5 MB por arquivo.
 *
 * O anexo vive no banco, não no Storage — ver o comentário da migration 0011.
 * O teto é o que mantém essa escolha honesta: foto de aviso, circular assinada
 * e PDF escaneado de algumas páginas cabem; um manual de 40 MB, não.
 *
 * O mesmo número está no CHECK da tabela (migration 0013). Mudar aqui sem mudar
 * lá troca uma mensagem clara por um erro de restrição do Postgres.
 */
export const LIMITE_BYTES = 5 * 1024 * 1024;

/** O teto em texto, para as mensagens não repetirem a conta. */
export const LIMITE_ROTULO = `${LIMITE_BYTES / 1024 / 1024} MB`;
