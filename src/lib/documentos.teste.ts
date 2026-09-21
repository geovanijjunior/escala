/**
 * CPF e telefone: os dígitos verificadores e o que se aceita como contato.
 *
 * Roda sem banco e sem navegador — é conta, não consulta. Vale o mesmo que
 * vale para o motor: a regra que decide se um cadastro entra ou é recusado
 * precisa ter teste próprio, senão só se descobre que ela afrouxou quando
 * alguém já cadastrou errado.
 */
import { cpfValido, formatarCpf, formatarTelefone, soDigitos, telefoneValido } from './documentos';

let falhas = 0;
function conferir(ok: boolean, rotulo: string) {
  console.log(`  ${ok ? 'ok' : 'FALHOU'}: ${rotulo}`);
  if (!ok) falhas++;
}

console.log('CPF — válidos');
// Gerados pela própria regra dos dígitos verificadores, não copiados de
// pessoas reais: um CPF de verdade aqui viraria dado pessoal num repositório.
for (const cpf of ['529.982.247-25', '52998224725', '111.444.777-35', '11144477735']) {
  conferir(cpfValido(cpf), `${cpf} passa (com ou sem máscara)`);
}

console.log('\nCPF — recusados');
conferir(!cpfValido(''), 'vazio não é CPF');
conferir(!cpfValido('529.982.247-26'), 'último dígito trocado é recusado');
conferir(!cpfValido('529.982.247-2'), 'faltando um dígito é recusado');
conferir(!cpfValido('5299822472500'), 'com dígitos a mais é recusado');
conferir(!cpfValido('abcdefghijk'), 'letras são recusadas');
// Os repetidos passam na aritmética dos verificadores por acidente, e são a
// forma mais comum de "preencher" um campo obrigatório sem preencher nada.
for (const repetido of ['00000000000', '11111111111', '99999999999']) {
  conferir(!cpfValido(repetido), `${repetido} é recusado apesar de fechar a conta`);
}

console.log('\nCPF — normalização e exibição');
conferir(soDigitos('529.982.247-25') === '52998224725', 'a máscara é descartada na gravação');
conferir(formatarCpf('52998224725') === '529.982.247-25', 'e reposta na exibição');
conferir(formatarCpf('123') === '123', 'o que não é CPF sai como veio, sem inventar máscara');

console.log('\nTelefone');
conferir(telefoneValido('(11) 98765-4321'), 'celular com DDD e máscara passa');
conferir(telefoneValido('1133334444'), 'fixo de dez dígitos passa');
conferir(!telefoneValido('987654321'), 'nove dígitos (sem DDD) é recusado');
conferir(!telefoneValido('119876543210'), 'doze dígitos é recusado');
conferir(formatarTelefone('11987654321') === '(11) 98765-4321', 'celular sai formatado');
conferir(formatarTelefone('1133334444') === '(11) 3333-4444', 'fixo sai formatado');

console.log(falhas === 0 ? '\n>>> DOCUMENTOS OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
