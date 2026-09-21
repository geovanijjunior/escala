import { randomInt } from 'node:crypto';

/**
 * A senha temporária que acompanha um acesso recém-criado.
 *
 * Mora aqui, e não junto da ação que cria um usuário de cada vez, porque agora
 * são dois os caminhos que precisam dela — o convite avulso e o convite em
 * lote — e duas cópias de um gerador de senha é exatamente o tipo de duplicação
 * que ninguém percebe divergir: a cópia esquecida continua gerando senhas mais
 * curtas ou mais pobres, e nada quebra.
 *
 * O alfabeto exclui O/0 e I/l/1 de propósito: esta senha é ditada por telefone
 * e copiada de uma planilha à mão, e o par que se confunde vira chamado de
 * suporte. As 54 letras restantes ainda dão ~71 bits em doze posições, o que é
 * muito acima do que uma senha de primeiro acesso precisa — ela existe para ser
 * trocada no primeiro login (`precisa_trocar_senha`).
 *
 * `randomInt` do Node, e não `Math.random()`: isto é credencial. `Math.random`
 * não é criptográfico e sua sequência é previsível a partir de saídas
 * anteriores — num lote de oitenta pessoas, quem receber a própria senha teria
 * material de sobra para atacar as outras. `randomInt` ainda resolve o viés de
 * módulo por rejeição, que um `% 54` traria de brinde.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function senhaTemporaria(tamanho = 12): string {
  return Array.from({ length: tamanho }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
}
