'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirCadastrador } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { montarColaborador } from '@/lib/colaborador-form';
import { DIAS_ABREV } from '@/lib/domain/escalas/datas';
import { voltar, voltarComErro } from '@/lib/volta';
import { mensagemErroBanco } from '@/lib/erros-banco';

const COLABS = '/colaboradores';
const PARAMS = '/parametros';

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? '').trim();
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true';

/**
 * Inteiro de um campo que precisa estar preenchido.
 *
 * `Number('')` é 0, e 0 passa por `Number.isInteger`. Um campo numérico apagado
 * chegava como zero válido e era gravado calado — limpar a tolerância de
 * aderência e salvar zerava a tolerância sem nenhum aviso. Devolve `null` no
 * vazio, para quem chama distinguir "não preencheu" de "preencheu zero".
 */
function inteiro(fd: FormData, campo: string): number | null {
  const bruto = texto(fd, campo);
  if (bruto === '') return null;
  const n = Number(bruto);
  return Number.isInteger(n) ? n : null;
}

/* ============================================================
   COLABORADORES
   ============================================================ */

export async function salvarColaborador(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, COLABS);

  const id = Number(formData.get('id') ?? 0);
  const supabase = await createClient();

  // A leitura e a validação vivem em `montarColaborador` porque o formulário de
  // Usuários também cria colaborador — ver o comentário lá.
  const lido = await montarColaborador(supabase, sessao.conta.id, formData, { id });
  if (!lido.ok) return voltarComErro(COLABS, formData, lido.erro);
  const { registro, rotuloMotivo } = lido;

  const { error } = id
    ? await supabase.from('colaboradores').update(registro).eq('id', id)
    : await supabase.from('colaboradores').insert(registro);

  if (error) voltarComErro(COLABS, formData, `Não foi possível salvar: ${mensagemErroBanco(error)}`);

  await registrarLog(
    sessao,
    id ? 'Colaborador atualizado' : 'Colaborador criado',
    `${registro.nome} · ${registro.matricula} · ${registro.status}${rotuloMotivo ? ` (${rotuloMotivo})` : ''}`,
  );
  revalidatePath('/', 'layout');
  // Fecha o formulário e diz o nome de quem foi salvo. Antes o editor
  // continuava aberto com os mesmos campos preenchidos, e a única pista de que
  // a gravação aconteceu era um "Alteração salva." genérico lá em cima — o que
  // se lê como "o botão não fez nada" e convida a clicar de novo.
  voltar(COLABS, formData, {
    id: '',
    novo: '',
    ok: `${registro.nome} ${id ? 'atualizado' : 'cadastrado'} com sucesso.`,
  });
}

/* ============================================================
   PARÂMETROS: unidades, capacidade, equipes, feriados
   ============================================================ */

export async function salvarUnidade(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const sigla = texto(formData, 'sigla').toUpperCase();
  const total = inteiro(formData, 'capacidadeTotal');
  const reservadas = inteiro(formData, 'capacidadeReservadas');

  if (!nome || !sigla) voltarComErro(PARAMS, formData, 'Nome e sigla são obrigatórios.');
  if (total === null || total < 0) voltarComErro(PARAMS, formData, 'Informe a capacidade total como um número inteiro de posições.');
  if (reservadas === null || reservadas < 0) voltarComErro(PARAMS, formData, 'Informe as posições reservadas como um número inteiro.');
  if (reservadas > total) voltarComErro(PARAMS, formData, 'As posições reservadas não podem passar da capacidade total.');

  const supabase = await createClient();
  // Sem `codigo`: no insert quem preenche é o trigger da 0018, a partir do id;
  // no update, omitir a coluna preserva o valor que já está gravado.
  const registro = {
    conta_id: sessao.conta.id,
    nome,
    sigla,
    cor: texto(formData, 'cor') || '#1A4E93',
    bg: texto(formData, 'bg') || '#DCEAF8',
    capacidade_total: total,
    capacidade_reservadas: reservadas,
    ordem: Number(formData.get('ordem') ?? 0),
    ativa: marcado(formData, 'ativa'),
  };

  const { error } = id
    ? await supabase.from('unidades').update(registro).eq('id', id)
    : await supabase.from('unidades').insert(registro);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a unidade: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, id ? 'Unidade atualizada' : 'Unidade criada', `${nome} · ${total - reservadas} posições operacionais`);
  revalidatePath('/', 'layout');
  // `unidade: ''` apaga o parâmetro da volta, e é o que fecha o formulário.
  // Sem isso ele reabria preenchido com o que acabara de ser gravado — a tela
  // ficava idêntica à de antes de salvar, que é como se lê "não funcionou".
  voltar(PARAMS, formData, { unidade: '' });
}

/**
 * Capacidade excepcional por dia da semana ou por data.
 *
 * Total em branco herda a capacidade padrão da unidade, porque o caso comum é
 * mexer só nas reservadas ("segunda e sexta tenho 2 posições guardadas") sem
 * querer alterar quantas pessoas cabem. Antes o branco apagava a exceção, o que
 * fazia esse caso salvar nada silenciosamente; remover agora é o botão da linha.
 */
export async function salvarCapacidade(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const unidadeId = Number(formData.get('unidadeId'));
  // Vários dias de uma vez: "segunda e sexta tenho 2 reservadas" é um pedido só,
  // e obrigar a repetir o formulário por dia é trabalho manual sem motivo.
  const dows = formData.getAll('dow')
    .map(v => Number(v))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  const dataBruta = texto(formData, 'data');
  const totalBruto = texto(formData, 'total');
  const reservadasBruto = texto(formData, 'reservadas');

  if (!unidadeId) voltarComErro(PARAMS, formData, 'Unidade inválida.');
  if (dows.length === 0 && !dataBruta) voltarComErro(PARAMS, formData, 'Marque ao menos um dia da semana ou informe uma data.');
  if (dows.length > 0 && dataBruta) voltarComErro(PARAMS, formData, 'A exceção vale para dias da semana OU para uma data específica, não os dois.');

  const supabase = await createClient();
  const { data: unidade } = await supabase
    .from('unidades')
    .select('nome, capacidade_total')
    .eq('id', unidadeId)
    .single();
  if (!unidade) voltarComErro(PARAMS, formData, 'Unidade não encontrada.');

  const total = totalBruto === '' ? unidade.capacidade_total : Number(totalBruto);
  const reservadas = reservadasBruto === '' ? 0 : Number(reservadasBruto);
  if (!Number.isInteger(total) || total < 0) voltarComErro(PARAMS, formData, 'Capacidade total inválida.');
  if (!Number.isInteger(reservadas) || reservadas < 0) voltarComErro(PARAMS, formData, 'Posições reservadas inválidas.');
  if (reservadas > total) {
    voltarComErro(PARAMS, formData, `As ${reservadas} posições reservadas não cabem num total de ${total}.`);
  }

  // Uma exceção por (unidade, dia da semana) e uma por (unidade, data) — índices
  // únicos no banco. Apagar antes de inserir é o upsert possível aqui, já que a
  // unicidade é parcial e o onConflict do PostgREST não a alcança.
  const filtro = supabase.from('capacidades').delete().eq('unidade_id', unidadeId);
  await (dows.length > 0 ? filtro.in('dow', dows) : filtro.eq('data', dataBruta));

  const base = { conta_id: sessao.conta.id, unidade_id: unidadeId, total, reservadas };
  const linhas: (typeof base & { dow: number | null; data: string | null })[] = dows.length > 0
    ? dows.map(dow => ({ ...base, dow, data: null }))
    : [{ ...base, dow: null, data: dataBruta }];

  const { error } = await supabase.from('capacidades').insert(linhas);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a capacidade: ${mensagemErroBanco(error)}`);

  const quando = dows.length > 0
    ? dows.map(d => DIAS_ABREV[d]).join(', ')
    : dataBruta;
  await registrarLog(
    sessao,
    'Capacidade ajustada',
    `${unidade.nome} · ${quando} · ${total} lugares, ${reservadas} reservadas`
  );
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { form: '' });
}

/** Remove uma exceção de capacidade: o dia volta a valer a capacidade padrão da unidade. */
export async function removerCapacidade(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id'));
  if (!id) voltarComErro(PARAMS, formData, 'Exceção inválida.');

  const supabase = await createClient();
  const { error } = await supabase.from('capacidades').delete().eq('id', id);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível remover a exceção: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Exceção de capacidade removida', `#${id}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

export async function salvarEquipe(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const regime = texto(formData, 'regime') === '12x36' ? '12x36' : '5x2';
  const turno = texto(formData, 'turno') === 'N' ? 'N' : 'D';
  if (!nome) voltarComErro(PARAMS, formData, 'Informe o nome da equipe.');

  const supabase = await createClient();
  // Sem `codigo`: no insert quem preenche é o trigger da 0018, a partir do id;
  // no update, omitir a coluna preserva o valor que já está gravado.
  const registro = {
    conta_id: sessao.conta.id,
    nome,
    regime,
    turno,
    gestor_id: texto(formData, 'gestorId') || null,
    na_escala: marcado(formData, 'naEscala'),
  };
  const { error } = id
    ? await supabase.from('equipes').update(registro).eq('id', id)
    : await supabase.from('equipes').insert(registro);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a equipe: ${mensagemErroBanco(error)}`);

  await registrarLog(
    sessao,
    id ? 'Equipe atualizada' : 'Equipe criada',
    `${nome} · ${regime} · turno ${turno}${registro.na_escala ? '' : ' · fora da escala'}`,
  );
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { equipe: '' });
}

/**
 * Traz os feriados nacionais de um ano para a área.
 *
 * A área nova já nasce com o ano corrente (trigger da 0022); este botão existe
 * para os anos seguintes e para quem montou a operação antes da migration.
 *
 * `semear_feriados_nacionais` usa `on conflict do nothing`, então repetir é
 * seguro e o que a área ajustou à mão fica intacto — a semeadura acrescenta o
 * que falta, nunca reescreve o que alguém decidiu.
 */
export async function trazerFeriadosNacionais(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const ano = inteiro(formData, 'ano');
  if (ano === null || ano < 2000 || ano > 2100) {
    voltarComErro(PARAMS, formData, 'Informe um ano entre 2000 e 2100.');
  }

  // Só o ano. A área sai de `conta_id()` DENTRO da função — mandá-la daqui
  // seria deixar quem chama escolher em que área escrever, e a função roda como
  // `security definer`: a RLS não estaria lá para desmentir. Ver a 0023.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('semear_feriados_nacionais', { p_ano: ano });
  if (error) voltarComErro(PARAMS, formData, `Não foi possível trazer os feriados: ${mensagemErroBanco(error)}`);

  const novos = Number(data ?? 0);
  await registrarLog(sessao, 'Feriados nacionais importados', `${ano} · ${novos} novo(s)`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, {
    form: '',
    ok: novos > 0
      ? `${novos} feriado(s) nacional(is) de ${ano} adicionado(s).`
      : `Os feriados nacionais de ${ano} já estavam cadastrados.`,
  });
}

export async function salvarFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const data = texto(formData, 'data');
  const nome = texto(formData, 'nome');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) voltarComErro(PARAMS, formData, 'Data do feriado inválida.');
  if (!nome) voltarComErro(PARAMS, formData, 'Informe o nome do feriado.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('feriados')
    .upsert({ conta_id: sessao.conta.id, data, nome }, { onConflict: 'conta_id,data' });
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar o feriado: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Feriado cadastrado', `${data} · ${nome}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { form: '' });
}

export async function removerFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);
  const data = texto(formData, 'data');
  const supabase = await createClient();
  await supabase.from('feriados').delete().eq('data', data);
  await registrarLog(sessao, 'Feriado removido', data);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

export async function salvarParametros(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const cicloAncora = texto(formData, 'cicloAncora');
  const tolerancia = inteiro(formData, 'tolerancia');
  const cobertura = inteiro(formData, 'cobertura');

  if (!/^\d{4}-\d{2}-01$/.test(cicloAncora)) voltarComErro(PARAMS, formData, 'A âncora do ciclo precisa ser o dia 1º de um mês.');
  if (tolerancia === null || tolerancia < 0) voltarComErro(PARAMS, formData, 'Informe a tolerância de aderência como um número inteiro de dias.');
  if (cobertura === null || cobertura < 0) voltarComErro(PARAMS, formData, 'Informe a cobertura mínima como um número inteiro de pessoas.');

  const supabase = await createClient();
  const { error } = await supabase.from('config').upsert(
    {
      conta_id: sessao.conta.id,
      ciclo_ancora: cicloAncora,
      tolerancia_aderencia: tolerancia,
      cobertura_minima: cobertura,
    },
    { onConflict: 'conta_id' }
  );
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar os parâmetros: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Parâmetros do motor alterados', `Âncora ${cicloAncora} · tolerância ±${tolerancia} · cobertura mínima ${cobertura}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { form: '' });
}

/* ============================================================
   COTA DE POSIÇÕES POR EQUIPE
   ============================================================ */

/**
 * Teto de pessoas de uma equipe numa unidade — "no Morumbi cabem 5 técnicos
 * 12x36 e 3 analistas".
 *
 * Aceita vários dias da semana de uma vez, e "todos os dias" quando nenhum é
 * marcado. Salvar de novo o mesmo par substitui o valor: os índices únicos do
 * banco são parciais, então o upsert do PostgREST não os alcança e o caminho é
 * apagar antes de inserir.
 */
export async function salvarCotaEquipe(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const unidadeId = Number(formData.get('unidadeId'));
  const equipeId = Number(formData.get('equipeId'));
  const minimoBruto = texto(formData, 'minimo');
  const dows = formData.getAll('dow')
    .map(v => Number(v))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);

  if (!unidadeId || !equipeId) voltarComErro(PARAMS, formData, 'Escolha a unidade e a equipe.');
  const minimo = Number(minimoBruto);
  if (minimoBruto === '' || !Number.isInteger(minimo) || minimo < 0) {
    voltarComErro(PARAMS, formData, 'Informe a cota como um número inteiro de posições (0 impede a equipe de usar a unidade).');
  }

  const supabase = await createClient();
  const [{ data: unidade }, { data: equipe }] = await Promise.all([
    supabase.from('unidades').select('nome, capacidade_total, capacidade_reservadas').eq('id', unidadeId).single(),
    supabase.from('equipes').select('nome').eq('id', equipeId).single(),
  ]);
  if (!unidade || !equipe) voltarComErro(PARAMS, formData, 'Unidade ou equipe não encontrada.');

  const operacionais = unidade.capacidade_total - unidade.capacidade_reservadas;
  if (minimo > operacionais) {
    voltarComErro(PARAMS, formData, `O mínimo de ${minimo} passa das ${operacionais} posições operacionais de ${unidade.nome}.`);
  }

  const filtro = supabase.from('cotas_equipe').delete().eq('unidade_id', unidadeId).eq('equipe_id', equipeId);
  await (dows.length > 0 ? filtro.in('dow', dows) : filtro.is('dow', null));

  const base = { conta_id: sessao.conta.id, unidade_id: unidadeId, equipe_id: equipeId, minimo };
  const linhas: (typeof base & { dow: number | null })[] = dows.length > 0
    ? dows.map(dow => ({ ...base, dow }))
    : [{ ...base, dow: null }];

  const { error } = await supabase.from('cotas_equipe').insert(linhas);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a cota: ${mensagemErroBanco(error)}`);

  const quando = dows.length > 0 ? dows.map(d => DIAS_ABREV[d]).join(', ') : 'todos os dias';
  await registrarLog(sessao, 'Cota por equipe ajustada', `${equipe.nome} em ${unidade.nome} · ${quando} · mínimo ${minimo}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { form: '' });
}

/** Remove a cota: a equipe volta a ser limitada só pela capacidade da unidade. */
export async function removerCotaEquipe(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id'));
  if (!id) voltarComErro(PARAMS, formData, 'Cota inválida.');

  const supabase = await createClient();
  const { error } = await supabase.from('cotas_equipe').delete().eq('id', id);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível remover a cota: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Cota por equipe removida', `#${id}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

/* ============================================================
   POSTOS
   ============================================================ */

/**
 * Posto: uma função exercida dentro de uma unidade — o Corpo Clínico dentro do
 * Morumbi. Não é lugar concorrente: quem cobre o posto ocupa uma posição normal
 * da unidade, então capacidade e distribuição percentual não mudam.
 */
export async function salvarPosto(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const unidadeId = Number(formData.get('unidadeId'));
  const nome = texto(formData, 'nome');
  const vagas = inteiro(formData, 'vagas');

  if (!unidadeId) voltarComErro(PARAMS, formData, 'Escolha a unidade do posto.');
  if (!nome) voltarComErro(PARAMS, formData, 'Informe o nome do posto.');
  if (vagas === null || vagas < 1) voltarComErro(PARAMS, formData, 'Informe quantas vagas simultâneas o posto tem — ao menos 1.');

  // Vazio = aberto a qualquer equipe, que é como os postos existiam antes de a
  // coluna nascer. Só um `null` explícito preserva esse sentido; `Number('')`
  // seria 0, um id de equipe que não existe.
  const equipeId = Number(formData.get('equipeId')) || null;

  const supabase = await createClient();
  const registro = {
    conta_id: sessao.conta.id,
    unidade_id: unidadeId,
    nome,
    vagas,
    equipe_id: equipeId,
    ativo: marcado(formData, 'ativo'),
  };
  const { error } = id
    ? await supabase.from('postos').update(registro).eq('id', id)
    : await supabase.from('postos').insert(registro);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar o posto: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, id ? 'Posto atualizado' : 'Posto criado', `${nome} · ${vagas} vaga(s)`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData, { form: '' });
}

export async function removerPosto(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, PARAMS);

  const id = Number(formData.get('id'));
  if (!id) voltarComErro(PARAMS, formData, 'Posto inválido.');

  const supabase = await createClient();
  const { error } = await supabase.from('postos').delete().eq('id', id);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível remover o posto: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Posto removido', `#${id}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}
