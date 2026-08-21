import { lerPlanilha } from './importacao';
import { horaNormalizada } from './datas';
import type { Equipe, Unidade } from './tipos';

let falhas = 0;
const ok = (cond: boolean, nome: string, extra = '') => {
  if (!cond) { falhas++; console.log('FALHOU:', nome, extra); }
  else console.log('ok:', nome);
};

const unidades: Unidade[] = [
  { id: 1, codigo: 'MOR', nome: 'Morumbi', sigla: 'MOR', cor: '#000', bg: '#fff', capacidadeTotal: 10, capacidadeReservadas: 0, ordem: 1, ativa: true },
  { id: 2, codigo: 'PAU', nome: 'Paulista', sigla: 'PAU', cor: '#000', bg: '#fff', capacidadeTotal: 10, capacidadeReservadas: 0, ordem: 2, ativa: true },
  { id: 3, codigo: 'OLD', nome: 'Antiga', sigla: 'OLD', cor: '#000', bg: '#fff', capacidadeTotal: 1, capacidadeReservadas: 0, ordem: 3, ativa: false },
];

const equipes: Equipe[] = [
  { id: 1, codigo: 'TEC', nome: 'Técnicos de Campo', regime: '5x2', turno: 'D', gestorId: null, naEscala: true },
  { id: 2, codigo: 'PLA', nome: 'Plantão 12x36', regime: '12x36', turno: 'D', gestorId: null, naEscala: true },
];

const ler = (csv: string) => lerPlanilha(csv, { equipes, unidades });
const CAB = 'nome;matricula;equipe;unidade base;admissao';

// ── 1. O caminho feliz
{
  const r = ler(`${CAB}\nAna Lima;100;Técnicos de Campo;Morumbi;01/03/2024`);
  ok(r.erros.length === 0, 'arquivo válido não tem erro de arquivo', JSON.stringify(r.erros));
  ok(r.linhas.length === 1, 'uma linha de dados vira uma linha lida');
  ok(r.linhas[0].erros.length === 0, 'linha válida não tem erro', JSON.stringify(r.linhas[0]?.erros));
  ok(r.linhas[0].equipeId === 1 && r.linhas[0].unidadeBaseId === 1, 'equipe e unidade resolvidas pelo nome');
  ok(r.linhas[0].admissao === '2024-03-01', 'data brasileira vira ISO');
  ok(r.linhas[0].entrada === '08:00' && r.linhas[0].saida === '17:00', 'entrada e saída têm padrão');
}

// ── 2. O que o Excel brasileiro produz: BOM, ponto e vírgula, CRLF
{
  const r = ler(`﻿${CAB}\r\nAna;100;TEC;MOR;01/03/2024\r\n`);
  ok(r.erros.length === 0, 'BOM e CRLF não atrapalham', JSON.stringify(r.erros));
  ok(r.linhas[0]?.equipeId === 1, 'equipe casa pelo código');
  ok(r.linhas[0]?.unidadeBaseId === 1, 'unidade casa pela sigla');
}

// ── 3. Separador vírgula, que é o resto do mundo
{
  const r = ler('nome,matricula,equipe,unidade base,admissao\nAna,100,TEC,MOR,2024-03-01');
  ok(r.erros.length === 0 && r.linhas.length === 1, 'vírgula como separador');
  ok(r.linhas[0]?.admissao === '2024-03-01', 'data já em ISO passa direto');
}

// ── 4. Aspas: o campo com separador dentro não pode partir a linha
{
  const r = ler(`${CAB};cargo\nAna;100;TEC;MOR;01/03/2024;"Analista Pl, Sênior"`);
  ok(r.linhas.length === 1, 'campo entre aspas não vira duas linhas');
  ok(/Cargo "Analista Pl, Sênior" não existe/.test(r.linhas[0]?.erros[0] ?? ''),
    'o conteúdo entre aspas chega inteiro à validação', JSON.stringify(r.linhas[0]?.erros));
}

// ── 5. Cabeçalho sem acento, com caixa trocada e com sinônimo
{
  const r = ler('NOME;Matrícula;Time;Lotação;Data de Admissão\nAna;100;TEC;MOR;01/03/2024');
  ok(r.erros.length === 0, 'cabeçalho aceita acento, caixa e sinônimo', JSON.stringify(r.erros));
  ok(r.linhas[0]?.erros.length === 0, 'e a linha é lida', JSON.stringify(r.linhas[0]?.erros));
}

// ── 6. Coluna obrigatória faltando derruba o arquivo, não a linha
{
  const r = ler('nome;matricula;equipe;admissao\nAna;100;TEC;01/03/2024');
  ok(r.erros.length === 1 && /unidade base/.test(r.erros[0]), 'falta de coluna é erro de arquivo');
  ok(r.linhas.length === 0, 'e nada é lido');
  ok(/O cabeçalho lido foi/.test(r.erros[0]), 'o erro mostra o cabeçalho lido, para achar o engano');
}

// ── 7. Cada erro de linha aponta a linha e o motivo
{
  const r = ler([
    CAB,
    ';100;TEC;MOR;01/03/2024',
    'Bia;;TEC;MOR;01/03/2024',
    'Cid;102;Inexistente;MOR;01/03/2024',
    'Dan;103;TEC;Inexistente;01/03/2024',
    'Eva;104;TEC;MOR;31/02/2024',
    'Fábio;105;TEC;MOR;',
  ].join('\n'));
  ok(r.linhas.length === 6, 'todas as linhas são lidas, mesmo as inválidas');
  ok(r.linhas[0].linha === 2, 'a numeração conta o cabeçalho');
  ok(/Nome em branco/.test(r.linhas[0].erros[0]), 'nome vazio');
  ok(/Matrícula em branco/.test(r.linhas[1].erros[0]), 'matrícula vazia');
  ok(/Equipe "Inexistente"/.test(r.linhas[2].erros[0]), 'equipe desconhecida');
  ok(/Unidade "Inexistente"/.test(r.linhas[3].erros[0]), 'unidade desconhecida');
  ok(r.linhas[4].erros.some(e => /admissão inválida/.test(e)), '31 de fevereiro não passa por data');
  ok(r.linhas[5].erros.some(e => /admissão inválida/.test(e)), 'admissão em branco é erro');
}

// ── 8. Matrícula repetida dentro do próprio arquivo
{
  const r = ler(`${CAB}\nAna;100;TEC;MOR;01/03/2024\nBia;100;TEC;MOR;01/03/2024`);
  ok(r.linhas[0].erros.length === 0, 'a primeira ocorrência passa');
  ok(/repetida na linha 2/.test(r.linhas[1].erros[0] ?? ''),
    'a segunda aponta onde está a primeira', JSON.stringify(r.linhas[1]?.erros));
}

// ── 9. Unidade inativa não serve de base
{
  const r = ler(`${CAB}\nAna;100;TEC;Antiga;01/03/2024`);
  ok(/inativa/.test(r.linhas[0].erros[0] ?? ''), 'unidade inativa é recusada com o motivo certo');
}

// ── 10. 12x36 exige ciclo; 5x2 não tem ciclo
{
  const semCiclo = ler(`${CAB}\nAna;100;Plantão 12x36;MOR;01/03/2024`);
  ok(/exige o ciclo/.test(semCiclo.linhas[0].erros[0] ?? ''), '12x36 sem ciclo é erro');

  const comCiclo = ler(`${CAB};ciclo\nAna;100;PLA;MOR;01/03/2024;ímpar`);
  ok(comCiclo.linhas[0].erros.length === 0 && comCiclo.linhas[0].ciclo === 'IMPAR',
    '12x36 com ciclo por extenso e acentuado', JSON.stringify(comCiclo.linhas[0].erros));
  ok(comCiclo.linhas[0].saida === '19:00', '12x36 sai às 19:00 por padrão', comCiclo.linhas[0].saida);

  const cincoDois = ler(`${CAB};ciclo\nAna;100;TEC;MOR;01/03/2024;par`);
  ok(cincoDois.linhas[0].ciclo === null, '5x2 ignora o ciclo em vez de gravá-lo');
}

// ── 11. Sim/não em todas as formas que a planilha escreve
{
  const r = ler(`${CAB};home office;trabalho externo\nAna;100;TEC;MOR;01/03/2024;Sim;x`);
  ok(r.linhas[0].elegHome && r.linhas[0].elegExterno, '"Sim" e "x" viram verdadeiro');

  const vazio = ler(`${CAB};home office\nAna;100;TEC;MOR;01/03/2024;`);
  ok(vazio.linhas[0].elegHome === false && vazio.linhas[0].erros.length === 0,
    'célula vazia é não, e não é erro');

  const lixo = ler(`${CAB};home office\nAna;100;TEC;MOR;01/03/2024;talvez`);
  ok(/não é sim nem não/.test(lixo.linhas[0].erros[0] ?? ''), '"talvez" é recusado');
}

// ── 12. Sexta reduzida não existe no 12x36
{
  const r = ler(`${CAB};ciclo;sexta reduzida\nAna;100;PLA;MOR;01/03/2024;par;sim`);
  ok(r.linhas[0].sextaReduzida === false, 'plantonista não tem sexta reduzida, mesmo pedindo');
}

// ── 13. Entrada e saída nos formatos da planilha
{
  const r = ler(`${CAB};entrada;saida\nAna;100;TEC;MOR;01/03/2024;7:30;16:45`);
  ok(r.linhas[0].entrada === '07:30', '7:30 vira 07:30');
  ok(r.linhas[0].saida === '16:45', '16:45 é lido como está', r.linhas[0].saida);

  const ruim = ler(`${CAB};entrada;saida\nAna;100;TEC;MOR;01/03/2024;25:00;99:00`);
  ok(ruim.linhas[0].erros.some(e => /entrada inválido/.test(e)), '25:00 não é hora');
  ok(ruim.linhas[0].erros.some(e => /saída inválido/.test(e)), '99:00 não é hora de saída');

  // Turno que vira o dia é legítimo: entra 19:00, sai 07:00.
  const noturno = ler(`${CAB};entrada;saida\nAna;100;TEC;MOR;01/03/2024;19:00;07:00`);
  ok(noturno.linhas[0].erros.length === 0, 'saída antes da entrada é turno noturno, não erro',
    JSON.stringify(noturno.linhas[0].erros));

  const igual = ler(`${CAB};entrada;saida\nAna;100;TEC;MOR;01/03/2024;08:00;08:00`);
  ok(igual.linhas[0].erros.some(e => /igual à entrada/.test(e)), 'saída igual à entrada é recusada');
}

// ── 13b. O parser de horário, direto
//
// Ele é a régua dos DOIS caminhos de entrada: esta planilha e o formulário de
// colaborador. Enquanto morava dentro deste arquivo, só a planilha o usava — o
// formulário conferia `\d{2}:\d{2}`, que "99:99" satisfaz, e uma sonda de
// `scripts/manual/hostil.mjs` gravou um colaborador com esse horário.
{
  ok(horaNormalizada('8:00') === '08:00', 'completa o zero da frente');
  ok(horaNormalizada('08:00:00') === '08:00', 'descarta os segundos');
  ok(horaNormalizada(' 08:00 ') === '08:00', 'ignora espaço em volta');
  ok(horaNormalizada('00:00') === '00:00', 'meia-noite é horário válido');
  ok(horaNormalizada('23:59') === '23:59', 'o último minuto do dia também');

  // A forma certa e o valor impossível: é a diferença que a checagem por
  // formato não enxerga.
  ok(horaNormalizada('99:99') === null, '99:99 tem o formato mas não é hora');
  ok(horaNormalizada('24:00') === null, '24:00 não existe no relógio');
  ok(horaNormalizada('08:60') === null, 'minuto 60 não existe');
  ok(horaNormalizada('') === null, 'vazio não é hora');
  ok(horaNormalizada('meio-dia') === null, 'texto não é hora');
}

// ── 14. Arquivo vazio e só-cabeçalho
{
  ok(/vazio/.test(ler('').erros[0] ?? ''), 'arquivo vazio');
  ok(/só tem o cabeçalho/.test(ler(CAB).erros[0] ?? ''), 'arquivo só com cabeçalho');
}

// ── 15. Linhas em branco no meio não viram registro
{
  const r = ler(`${CAB}\nAna;100;TEC;MOR;01/03/2024\n\n;;;;\nBia;101;TEC;MOR;01/03/2024\n`);
  ok(r.linhas.length === 2, 'linhas vazias são descartadas', `leu ${r.linhas.length}`);
}

// ── 16. Colunas desconhecidas não impedem, mas são relatadas
{
  const r = ler(`${CAB};centro de custo\nAna;100;TEC;MOR;01/03/2024;CC-9`);
  ok(r.linhas[0].erros.length === 0, 'coluna extra não invalida a linha');
  ok(r.ignoradas.includes('centro de custo'), 'a coluna ignorada é relatada');
}

console.log(falhas ? `\n${falhas} TESTE(S) FALHARAM` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
