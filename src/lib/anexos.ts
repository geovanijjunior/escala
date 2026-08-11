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
 * Teto de 2 MB por arquivo.
 *
 * O anexo vive no banco, não no Storage — ver o comentário da migration 0011.
 * O teto é o que mantém essa escolha honesta: foto de aviso e PDF de uma ou
 * duas páginas cabem; um manual escaneado de 40 MB, não.
 */
export const LIMITE_BYTES = 2 * 1024 * 1024;
