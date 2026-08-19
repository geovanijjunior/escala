/**
 * Regras dos anexos do mural.
 *
 * Vive fora do arquivo de Server Actions porque o formulário (cliente) também
 * precisa das constantes — e um arquivo `'use server'` só pode exportar função
 * assíncrona.
 */

/** Tipos aceitos como anexo. A mesma lista está no CHECK da tabela. */
export const TIPOS_ANEXO = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

/**
 * Teto de 20 MB por arquivo.
 *
 * O anexo vive no banco, não no Storage — ver o comentário da migration 0011.
 * O teto é o que mantém essa escolha honesta: foto de aviso, circular assinada
 * e PDF escaneado cabem; uma gravação de reunião, não.
 *
 * O mesmo número está no CHECK da tabela (migration 0017). Mudar aqui sem mudar
 * lá troca uma mensagem clara por um erro de restrição do Postgres.
 */
export const LIMITE_BYTES = 20 * 1024 * 1024;

/**
 * Teto da soma de todos os anexos de um comunicado.
 *
 * Existe porque o campo aceita vários arquivos e o limite que o Next impõe
 * (`serverActions.bodySizeLimit`) vale para a REQUISIÇÃO inteira, não por
 * arquivo. Sem este número, três anexos de 18 MB passariam nas duas validações
 * por arquivo e morreriam no corpo da requisição — e o erro de corpo grande
 * demais não chega ao formulário como mensagem, chega como falha de rede.
 *
 * `bodySizeLimit` fica um pouco acima disto, para o overhead que o
 * `multipart/form-data` acrescenta em fronteiras e cabeçalhos de cada parte.
 */
export const LIMITE_TOTAL_BYTES = 40 * 1024 * 1024;

const emMB = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

/** Os tetos em texto, para as mensagens não repetirem a conta. */
export const LIMITE_ROTULO = emMB(LIMITE_BYTES);
export const LIMITE_TOTAL_ROTULO = emMB(LIMITE_TOTAL_BYTES);
