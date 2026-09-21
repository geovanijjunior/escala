import { horaNormalizada } from './datas';
import { cpfValido, telefoneValido } from '../../documentos';
import type { Equipe, Turno, Unidade } from './tipos';

/**
 * Leitura de uma planilha de colaboradores.
 *
 * Função pura: recebe o texto do arquivo e os cadastros contra os quais
 * conferir, e devolve o que seria gravado mais os erros de cada linha. Não toca
 * em banco, o que permite testá-la com trinta casos de arquivo malformado sem
 * subir nada — e é o que torna viável a conferência antes de gravar.
 *
 * O formato é o mesmo que a exportação produz, porque o caminho mais comum é
 * exportar, editar na planilha e trazer de volta. Aceita mais do que exporta:
 * quem monta o arquivo à mão erra o separador, a acentuação do cabeçalho e o
 * formato da data, e recusar por isso seria recusar por motivo errado.
 */

export interface LinhaImportada {
  /** Da pessoa, desde a 0031 — a equipe não tem mais regime. */
  regime: '12x36' | '5x2';
  /** Linha no arquivo, contando o cabeçalho. É por ela que a pessoa acha o erro. */
  linha: number;
  nome: string;
  matricula: string;
  email: string;
  cargo: string;
  equipeId: number | null;
  equipeNome: string;
  unidadeBaseId: number | null;
  unidadeNome: string;
  turno: Turno;
  /** Ficha da pessoa (0030): só dígitos, vazio quando não informado. */
  cpf: string;
  telefone: string;
  /** ISO `aaaa-mm-dd`, ou vazio. */
  nascimento: string;
  ciclo: 'IMPAR' | 'PAR' | null;
  entrada: string;
  saida: string;
  elegHome: boolean;
  elegExterno: boolean;
  sextaReduzida: boolean;
  admissao: string;
  erros: string[];
}

export interface Leitura {
  linhas: LinhaImportada[];
  /** Problemas do arquivo inteiro: cabeçalho faltando, arquivo vazio. */
  erros: string[];
  /** Cabeçalhos presentes no arquivo que o sistema não usa. */
  ignoradas: string[];
}

/* ============================================================
   CSV
   ============================================================ */

/**
 * Divide o texto em células, respeitando aspas.
 *
 * Sem tratar aspas, um cargo escrito "Analista Pl, Sênior" parte a linha ao
 * meio e todas as colunas seguintes entram deslocadas — o pior tipo de erro,
 * porque o arquivo importa e os dados ficam trocados de campo.
 */
function partirCsv(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let celula = '';
  let atual: string[] = [];
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreAspas) {
      if (c === '"') {
        // Aspas duplicadas dentro de campo com aspas são uma aspa literal.
        if (texto[i + 1] === '"') { celula += '"'; i++; }
        else entreAspas = false;
      } else celula += c;
      continue;
    }

    if (c === '"') { entreAspas = true; continue; }
    if (c === separador) { atual.push(celula); celula = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { atual.push(celula); linhas.push(atual); atual = []; celula = ''; continue; }
    celula += c;
  }

  if (celula !== '' || atual.length) { atual.push(celula); linhas.push(atual); }
  return linhas.filter(l => l.some(x => x.trim() !== ''));
}

/**
 * Descobre o separador olhando a primeira linha.
 *
 * O Excel em português salva com `;`; quase todo o resto do mundo usa `,`.
 * Fixar um dos dois faria metade dos arquivos chegar como uma coluna só, com a
 * mensagem inútil "falta a coluna nome".
 */
function separadorDe(primeira: string): string {
  const fora = (sep: string) => {
    let n = 0, aspas = false;
    for (const c of primeira) {
      if (c === '"') aspas = !aspas;
      else if (c === sep && !aspas) n++;
    }
    return n;
  };
  return fora(';') >= fora(',') ? ';' : ',';
}

/** Sem acento, sem caixa, sem espaço dobrado — para casar cabeçalho e nome de equipe. */
export function chaveDe(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ============================================================
   Colunas
   ============================================================ */

/** Cada campo e os cabeçalhos que valem por ele. O primeiro é o que a exportação escreve. */
const COLUNAS = {
  nome: ['nome', 'colaborador'],
  matricula: ['matricula', 'registro', 'chapa'],
  email: ['email', 'e mail'],
  cargo: ['cargo', 'funcao'],
  equipe: ['equipe', 'time', 'setor'],
  unidade: ['unidade base', 'unidade', 'base', 'lotacao'],
  turno: ['turno'],
  // Coluna nova desde a 0031, quando o regime deixou de vir da equipe.
  // Opcional: em branco vale 5x2, que é o expediente comum — obrigá-la
  // invalidaria toda planilha que já existe por aí.
  regime: ['regime', 'jornada', 'escala'],
  ciclo: ['ciclo'],
  entrada: ['entrada', 'horario', 'hora entrada'],
  saida: ['saida', 'saída', 'hora saida', 'hora de saida'],
  elegHome: ['home office', 'home', 'eleg home', 'elegivel home office'],
  elegExterno: ['trabalho externo', 'externo', 'eleg externo'],
  sextaReduzida: ['sexta reduzida', 'sexta'],
  admissao: ['admissao', 'data de admissao', 'data admissao'],
  // A ficha da pessoa (0030). Ficaram de fora quando os campos entraram nos
  // formulários, e a primeira planilha real veio com as três colunas — 79
  // pessoas teriam entrado sem CPF, que é justamente o dado que depois se
  // cruza com a folha.
  cpf: ['cpf', 'documento'],
  telefone: ['telefone', 'celular', 'contato', 'fone'],
  nascimento: ['data de nascimento', 'nascimento', 'data nascimento'],
} as const;

type Campo = keyof typeof COLUNAS;

const OBRIGATORIAS: Campo[] = ['nome', 'matricula', 'equipe', 'unidade', 'admissao'];

/* ============================================================
   Conversões
   ============================================================ */

const SIM = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes', 'y']);
const NAO = new Set(['', 'nao', 'n', 'false', 'falso', '0', 'no']);

function booleano(bruto: string): boolean | null {
  const k = chaveDe(bruto);
  if (SIM.has(k)) return true;
  if (NAO.has(k)) return false;
  return null;
}

/** Aceita `aaaa-mm-dd` e `dd/mm/aaaa`, que é o que a planilha brasileira escreve. */
function data(bruto: string): string | null {
  const t = bruto.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return ehDataReal(t) ? t : null;
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    return ehDataReal(iso) ? iso : null;
  }
  return null;
}

/**
 * `new Date('2026-02-31')` não lança: rola para 3 de março. Comparar a volta com
 * a ida é o que separa data existente de data que só parece uma.
 */
function ehDataReal(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Aceita `8:00`, `08:00` e `08:00:00`.
 *
 * Mudou de casa para `datas.ts` quando o formulário de colaborador passou a
 * digitar horário também: eram duas réguas para o mesmo campo, e a de lá
 * conferia só o formato — a planilha recusava `99:99` e a tela aceitava.
 */
const hora = horaNormalizada;

/* ============================================================
   Leitura
   ============================================================ */

export function lerPlanilha(
  conteudo: string,
  { equipes, unidades, cargos }: { equipes: Equipe[]; unidades: Unidade[]; cargos: string[] },
): Leitura {
  // O Excel escreve BOM no começo do arquivo. Sem removê-lo, o primeiro
  // cabeçalho vira "﻿nome" e a coluna obrigatória "nome" some.
  const texto = conteudo.replace(/^﻿/, '');
  if (texto.trim() === '') return { linhas: [], erros: ['O arquivo está vazio.'], ignoradas: [] };

  const primeira = texto.split('\n')[0];
  const grade = partirCsv(texto, separadorDe(primeira));
  if (grade.length === 0) return { linhas: [], erros: ['O arquivo está vazio.'], ignoradas: [] };

  const cabecalho = grade[0].map(chaveDe);
  const posicao = {} as Record<Campo, number>;
  for (const campo of Object.keys(COLUNAS) as Campo[]) {
    posicao[campo] = cabecalho.findIndex(c => (COLUNAS[campo] as readonly string[]).includes(c));
  }

  const usadas = new Set(Object.values(posicao).filter(i => i >= 0));
  const ignoradas = grade[0].filter((_, i) => !usadas.has(i) && grade[0][i].trim() !== '');

  const erros: string[] = [];
  for (const campo of OBRIGATORIAS) {
    if (posicao[campo] < 0) {
      erros.push(`Falta a coluna "${COLUNAS[campo][0]}". O cabeçalho lido foi: ${grade[0].join(' | ')}`);
    }
  }
  if (erros.length) return { linhas: [], erros, ignoradas };
  if (grade.length === 1) return { linhas: [], erros: ['O arquivo só tem o cabeçalho.'], ignoradas };

  // Índice por chave normalizada: a planilha traz "Técnicos de Campo", "TEC" ou
  // "tecnicos de campo", e as três precisam achar a mesma equipe.
  const acharEquipe = new Map<string, Equipe>();
  for (const e of equipes) {
    acharEquipe.set(chaveDe(e.nome), e);
    acharEquipe.set(chaveDe(e.codigo), e);
  }
  const acharUnidade = new Map<string, Unidade>();
  for (const u of unidades.filter(x => x.ativa)) {
    acharUnidade.set(chaveDe(u.nome), u);
    acharUnidade.set(chaveDe(u.codigo), u);
    acharUnidade.set(chaveDe(u.sigla), u);
  }

  const vistas = new Map<string, number>();
  const linhas: LinhaImportada[] = [];

  for (let i = 1; i < grade.length; i++) {
    const celulas = grade[i];
    const campo = (c: Campo) => (posicao[c] >= 0 ? (celulas[posicao[c]] ?? '').trim() : '');
    const problemas: string[] = [];

    const nome = campo('nome');
    if (!nome) problemas.push('Nome em branco.');

    const matricula = campo('matricula');
    if (!matricula) problemas.push('Matrícula em branco.');
    else if (vistas.has(matricula)) problemas.push(`Matrícula repetida na linha ${vistas.get(matricula)} do próprio arquivo.`);
    else vistas.set(matricula, i + 1);

    const email = campo('email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problemas.push(`E-mail inválido: "${email}".`);

    // Os cargos vêm da área, e não mais de uma lista no código: quem acabou
    // de cadastrar "Enfermeiro" em Parâmetros precisa conseguir importar uma
    // planilha com ele. `chaveDe` compara sem acento e sem caixa, para que
    // "analista jr" da planilha case com "Analista Jr" do cadastro.
    const cargoBruto = campo('cargo');
    const cargo = cargos.find(c => chaveDe(c) === chaveDe(cargoBruto)) ?? '';
    if (cargoBruto && !cargo) {
      problemas.push(cargos.length
        ? `Cargo "${cargoBruto}" não está cadastrado. Use um destes: ${cargos.join(', ')}.`
        : `Cargo "${cargoBruto}" não está cadastrado, e não há cargo nenhum na área. Cadastre em Parâmetros → Cargos.`);
    }

    const equipeBruta = campo('equipe');
    const equipe = acharEquipe.get(chaveDe(equipeBruta));
    if (!equipe) problemas.push(`Equipe "${equipeBruta}" não está cadastrada.`);

    const unidadeBruta = campo('unidade');
    const unidade = acharUnidade.get(chaveDe(unidadeBruta));
    if (!unidade) problemas.push(`Unidade "${unidadeBruta}" não está cadastrada ou está inativa.`);

    // Os três valores da 0031. O vespertino ficou de fora daqui quando entrou
    // nas telas, e a primeira planilha de verdade veio com três pessoas nele —
    // que teriam entrado como DIURNAS, sem erro nenhum à vista.
    const turnoBruto = chaveDe(campo('turno'));
    const DE_TURNO: Record<string, Turno> = {
      d: 'D', diurno: 'D',
      v: 'V', vespertino: 'V', tarde: 'V',
      n: 'N', noturno: 'N', noite: 'N',
    };
    const turno: Turno = DE_TURNO[turnoBruto] ?? 'D';
    if (turnoBruto && !(turnoBruto in DE_TURNO)) {
      problemas.push(`Turno "${campo('turno')}" não é diurno, vespertino nem noturno.`);
    }

    // O ciclo só existe no 12x36, e ali é obrigatório: sem ele o motor não sabe
    // se a pessoa trabalha nos dias pares ou nos ímpares.
    // O regime é DA PESSOA desde a 0031: antes saía da equipe, e uma planilha
    // não tinha como trazer plantonista e administrativo para o mesmo time.
    const regimeBruto = chaveDe(campo('regime'));
    const regime: '12x36' | '5x2' = ['12x36', '12 x 36', '12'].includes(regimeBruto) ? '12x36' : '5x2';
    if (regimeBruto && !['12x36', '12 x 36', '12', '5x2', '5 x 2', '5'].includes(regimeBruto)) {
      problemas.push(`Regime "${campo('regime')}" não reconhecido. Use "12x36" ou "5x2".`);
    }

    const cicloBruto = chaveDe(campo('ciclo'));
    let ciclo: 'IMPAR' | 'PAR' | null = null;
    if (regime === '12x36') {
      if (['impar', 'impares', 'i'].includes(cicloBruto)) ciclo = 'IMPAR';
      else if (['par', 'pares', 'p'].includes(cicloBruto)) ciclo = 'PAR';
      else problemas.push('Quem é 12x36 exige o ciclo: "ímpar" ou "par".');
    }

    // Só dígitos, como no formulário: a máscara é da planilha, não do banco.
    const cpf = campo('cpf').replace(/\D/g, '');
    if (cpf && !cpfValido(cpf)) problemas.push(`CPF "${campo('cpf')}" não confere — revise os dígitos.`);
    const telefone = campo('telefone').replace(/\D/g, '');
    if (telefone && !telefoneValido(telefone)) {
      problemas.push(`Telefone "${campo('telefone')}" precisa de DDD e número (10 ou 11 dígitos).`);
    }
    const nascimento = data(campo('nascimento'));
    if (campo('nascimento') && nascimento === null) {
      problemas.push(`Data de nascimento inválida: "${campo('nascimento')}".`);
    }

    const entradaBruta = campo('entrada');
    const entrada = entradaBruta ? hora(entradaBruta) : '08:00';
    if (entrada === null) problemas.push(`Horário de entrada inválido: "${entradaBruta}". Use HH:MM.`);

    // O padrão sai do regime porque é o que a planilha mais deixa em branco:
    // 12x36 entra 07:00 e sai 19:00; 5x2 entra 08:00 e sai 17:00.
    const saidaBruta = campo('saida');
    const saida = saidaBruta ? hora(saidaBruta) : (regime === '12x36' ? '19:00' : '17:00');
    if (saida === null) problemas.push(`Horário de saída inválido: "${saidaBruta}". Use HH:MM.`);
    else if (saida === (entrada ?? '08:00')) problemas.push('A saída não pode ser igual à entrada.');

    const boolCampo = (c: Campo, rotulo: string) => {
      const v = booleano(campo(c));
      if (v === null) problemas.push(`${rotulo}: "${campo(c)}" não é sim nem não.`);
      return v ?? false;
    };
    const elegHome = boolCampo('elegHome', 'Home office');
    const elegExterno = boolCampo('elegExterno', 'Trabalho externo');
    const sextaReduzidaBruta = boolCampo('sextaReduzida', 'Sexta reduzida');

    const admissaoBruta = campo('admissao');
    const admissao = data(admissaoBruta);
    if (!admissao) problemas.push(`Data de admissão inválida: "${admissaoBruta}". Use dd/mm/aaaa.`);

    linhas.push({
      linha: i + 1,
      nome,
      matricula,
      email,
      cargo,
      equipeId: equipe?.id ?? null,
      equipeNome: equipe?.nome ?? equipeBruta,
      unidadeBaseId: unidade?.id ?? null,
      unidadeNome: unidade?.nome ?? unidadeBruta,
      turno,
      cpf,
      telefone,
      nascimento: nascimento ?? '',
      regime,
      ciclo,
      entrada: entrada ?? '08:00',
      saida: saida ?? '17:00',
      elegHome,
      elegExterno,
      // Sexta reduzida não existe no 12x36: quem faz plantão não tem sexta
      // curta. Aceitar em silêncio guardaria uma regra que nunca se aplica.
      sextaReduzida: regime === '5x2' && sextaReduzidaBruta,
      admissao: admissao ?? '',
      erros: problemas,
    });
  }

  return { linhas, erros: [], ignoradas };
}

/** Cabeçalho de referência, para o modelo que a tela oferece para baixar. */
export const CABECALHO_MODELO = [
  'nome', 'matricula', 'email', 'cargo', 'equipe', 'unidade base',
  'turno', 'ciclo', 'entrada', 'saida',
  'home office', 'trabalho externo', 'sexta reduzida', 'admissao',
];
