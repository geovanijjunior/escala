'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirPlanejamento } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { CARGOS } from '@/lib/domain/escalas/constantes';
import { DIAS_ABREV } from '@/lib/domain/escalas/datas';
import { voltar, voltarComErro } from '@/lib/volta';
import { mensagemErroBanco } from '@/lib/erros-banco';

const COLABS = '/colaboradores';
const PARAMS = '/parametros';

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? '').trim();
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true';

/* ============================================================
   COLABORADORES
   ============================================================ */

export async function salvarColaborador(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, COLABS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const matricula = texto(formData, 'matricula');
  const email = texto(formData, 'email');
  const cargo = texto(formData, 'cargo');
  const equipeId = Number(formData.get('equipeId'));
  const unidadeBaseId = Number(formData.get('unidadeBaseId'));
  const entrada = texto(formData, 'entrada');
  const jornada = Number(formData.get('jornada'));
  const admissao = texto(formData, 'admissao');
  const status = texto(formData, 'status') || 'ativo';
  const desligamento = texto(formData, 'desligamento');
  const turno = texto(formData, 'turno') === 'N' ? 'N' : 'D';
  const cicloBruto = texto(formData, 'ciclo');
  const perfilIdBruto = texto(formData, 'perfilId');

  if (!nome) voltarComErro(COLABS, formData, 'Informe o nome.');
  if (!matricula) voltarComErro(COLABS, formData, 'Informe a matrícula.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) voltarComErro(COLABS, formData, 'E-mail em formato inválido.');
  if (cargo && !CARGOS.includes(cargo)) voltarComErro(COLABS, formData, 'Cargo inválido.');
  if (!equipeId) voltarComErro(COLABS, formData, 'Selecione a equipe.');
  if (!unidadeBaseId) voltarComErro(COLABS, formData, 'Selecione a unidade base.');
  if (!/^\d{2}:\d{2}$/.test(entrada)) voltarComErro(COLABS, formData, 'Horário de entrada inválido.');
  if (!(jornada > 0 && jornada <= 24)) voltarComErro(COLABS, formData, 'A jornada precisa estar entre 1 e 24 horas.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissao)) voltarComErro(COLABS, formData, 'Informe a data de admissão.');
  if (!['ativo', 'afastado', 'desligado'].includes(status)) voltarComErro(COLABS, formData, 'Situação inválida.');
  if (status === 'desligado' && !desligamento) voltarComErro(COLABS, formData, 'Um colaborador desligado precisa da data de desligamento.');
  if (desligamento && desligamento < admissao) voltarComErro(COLABS, formData, 'O desligamento não pode ser anterior à admissão.');

  const supabase = await createClient();

  // Regime e turno vêm da equipe; o turno pode ser sobreposto caso a caso.
  const { data: equipe } = await supabase.from('equipes').select('regime, turno, gestor_id').eq('id', equipeId).single();
  if (!equipe) voltarComErro(COLABS, formData, 'Equipe não encontrada.');

  const ciclo = equipe.regime === '12x36'
    ? (cicloBruto === 'PAR' ? 'PAR' : 'IMPAR')
    : null;
  if (equipe.regime === '12x36' && !cicloBruto) voltarComErro(COLABS, formData, 'Regime 12x36 exige definir o ciclo base (dias pares ou ímpares).');

  const duplicada = await supabase
    .from('colaboradores')
    .select('id')
    .eq('matricula', matricula)
    .neq('id', id || -1)
    .maybeSingle();
  if (duplicada.data) voltarComErro(COLABS, formData, `A matrícula ${matricula} já pertence a outro colaborador.`);

  const registro = {
    conta_id: sessao.conta.id,
    perfil_id: perfilIdBruto || null,
    nome,
    matricula,
    email,
    cargo,
    equipe_id: equipeId,
    gestor_id: texto(formData, 'gestorId') || equipe.gestor_id,
    regime: equipe.regime,
    turno,
    ciclo,
    entrada,
    jornada,
    unidade_base_id: unidadeBaseId,
    eleg_home: marcado(formData, 'elegHome'),
    eleg_externo: marcado(formData, 'elegExterno'),
    sexta_reduzida: equipe.regime === '5x2' && marcado(formData, 'sextaReduzida'),
    status,
    admissao,
    desligamento: status === 'desligado' ? desligamento : null,
  };

  const { error } = id
    ? await supabase.from('colaboradores').update(registro).eq('id', id)
    : await supabase.from('colaboradores').insert(registro);

  if (error) voltarComErro(COLABS, formData, `Não foi possível salvar: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, id ? 'Colaborador atualizado' : 'Colaborador criado', `${nome} · ${matricula} · ${status}`);
  revalidatePath('/', 'layout');
  voltar(COLABS, formData);
}

/* ============================================================
   PARÂMETROS: unidades, capacidade, equipes, feriados
   ============================================================ */

export async function salvarUnidade(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const codigo = texto(formData, 'codigo').toUpperCase();
  const sigla = texto(formData, 'sigla').toUpperCase();
  const total = Number(formData.get('capacidadeTotal'));
  const reservadas = Number(formData.get('capacidadeReservadas'));

  if (!nome || !codigo || !sigla) voltarComErro(PARAMS, formData, 'Nome, código e sigla são obrigatórios.');
  if (!Number.isInteger(total) || total < 0) voltarComErro(PARAMS, formData, 'Capacidade total inválida.');
  if (!Number.isInteger(reservadas) || reservadas < 0) voltarComErro(PARAMS, formData, 'Posições reservadas inválidas.');
  if (reservadas > total) voltarComErro(PARAMS, formData, 'As posições reservadas não podem passar da capacidade total.');

  const supabase = await createClient();
  const registro = {
    conta_id: sessao.conta.id,
    codigo,
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
  voltar(PARAMS, formData);
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
  exigirPlanejamento(sessao.papel, PARAMS);

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
  voltar(PARAMS, formData);
}

/** Remove uma exceção de capacidade: o dia volta a valer a capacidade padrão da unidade. */
export async function removerCapacidade(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

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
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const codigo = texto(formData, 'codigo').toUpperCase();
  const regime = texto(formData, 'regime') === '12x36' ? '12x36' : '5x2';
  const turno = texto(formData, 'turno') === 'N' ? 'N' : 'D';
  if (!nome || !codigo) voltarComErro(PARAMS, formData, 'Nome e código da equipe são obrigatórios.');

  const supabase = await createClient();
  const registro = {
    conta_id: sessao.conta.id,
    codigo,
    nome,
    regime,
    turno,
    gestor_id: texto(formData, 'gestorId') || null,
  };
  const { error } = id
    ? await supabase.from('equipes').update(registro).eq('id', id)
    : await supabase.from('equipes').insert(registro);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a equipe: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, id ? 'Equipe atualizada' : 'Equipe criada', `${nome} · ${regime} · turno ${turno}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

export async function salvarFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

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
  voltar(PARAMS, formData);
}

export async function removerFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);
  const data = texto(formData, 'data');
  const supabase = await createClient();
  await supabase.from('feriados').delete().eq('data', data);
  await registrarLog(sessao, 'Feriado removido', data);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

export async function salvarParametros(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const cicloAncora = texto(formData, 'cicloAncora');
  const tolerancia = Number(formData.get('tolerancia'));
  const cobertura = Number(formData.get('cobertura'));

  if (!/^\d{4}-\d{2}-01$/.test(cicloAncora)) voltarComErro(PARAMS, formData, 'A âncora do ciclo precisa ser o dia 1º de um mês.');
  if (!Number.isInteger(tolerancia) || tolerancia < 0) voltarComErro(PARAMS, formData, 'Tolerância de aderência inválida.');
  if (!Number.isInteger(cobertura) || cobertura < 0) voltarComErro(PARAMS, formData, 'Cobertura mínima inválida.');

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
  voltar(PARAMS, formData);
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
  exigirPlanejamento(sessao.papel, PARAMS);

  const unidadeId = Number(formData.get('unidadeId'));
  const equipeId = Number(formData.get('equipeId'));
  const limiteBruto = texto(formData, 'limite');
  const dows = formData.getAll('dow')
    .map(v => Number(v))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);

  if (!unidadeId || !equipeId) voltarComErro(PARAMS, formData, 'Escolha a unidade e a equipe.');
  const limite = Number(limiteBruto);
  if (limiteBruto === '' || !Number.isInteger(limite) || limite < 0) {
    voltarComErro(PARAMS, formData, 'Informe a cota como um número inteiro de posições (0 impede a equipe de usar a unidade).');
  }

  const supabase = await createClient();
  const [{ data: unidade }, { data: equipe }] = await Promise.all([
    supabase.from('unidades').select('nome, capacidade_total, capacidade_reservadas').eq('id', unidadeId).single(),
    supabase.from('equipes').select('nome').eq('id', equipeId).single(),
  ]);
  if (!unidade || !equipe) voltarComErro(PARAMS, formData, 'Unidade ou equipe não encontrada.');

  const operacionais = unidade.capacidade_total - unidade.capacidade_reservadas;
  if (limite > operacionais) {
    voltarComErro(PARAMS, formData, `A cota de ${limite} passa das ${operacionais} posições operacionais de ${unidade.nome}.`);
  }

  const filtro = supabase.from('cotas_equipe').delete().eq('unidade_id', unidadeId).eq('equipe_id', equipeId);
  await (dows.length > 0 ? filtro.in('dow', dows) : filtro.is('dow', null));

  const base = { conta_id: sessao.conta.id, unidade_id: unidadeId, equipe_id: equipeId, limite };
  const linhas: (typeof base & { dow: number | null })[] = dows.length > 0
    ? dows.map(dow => ({ ...base, dow }))
    : [{ ...base, dow: null }];

  const { error } = await supabase.from('cotas_equipe').insert(linhas);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar a cota: ${mensagemErroBanco(error)}`);

  const quando = dows.length > 0 ? dows.map(d => DIAS_ABREV[d]).join(', ') : 'todos os dias';
  await registrarLog(sessao, 'Cota por equipe ajustada', `${equipe.nome} em ${unidade.nome} · ${quando} · até ${limite}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

/** Remove a cota: a equipe volta a ser limitada só pela capacidade da unidade. */
export async function removerCotaEquipe(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

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
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const unidadeId = Number(formData.get('unidadeId'));
  const nome = texto(formData, 'nome');
  const vagas = Number(formData.get('vagas') ?? 1);

  if (!unidadeId) voltarComErro(PARAMS, formData, 'Escolha a unidade do posto.');
  if (!nome) voltarComErro(PARAMS, formData, 'Informe o nome do posto.');
  if (!Number.isInteger(vagas) || vagas < 1) voltarComErro(PARAMS, formData, 'O posto precisa de ao menos 1 vaga.');

  const supabase = await createClient();
  const registro = {
    conta_id: sessao.conta.id,
    unidade_id: unidadeId,
    nome,
    vagas,
    ativo: marcado(formData, 'ativo'),
  };
  const { error } = id
    ? await supabase.from('postos').update(registro).eq('id', id)
    : await supabase.from('postos').insert(registro);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível salvar o posto: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, id ? 'Posto atualizado' : 'Posto criado', `${nome} · ${vagas} vaga(s)`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}

export async function removerPosto(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id'));
  if (!id) voltarComErro(PARAMS, formData, 'Posto inválido.');

  const supabase = await createClient();
  const { error } = await supabase.from('postos').delete().eq('id', id);
  if (error) voltarComErro(PARAMS, formData, `Não foi possível remover o posto: ${mensagemErroBanco(error)}`);

  await registrarLog(sessao, 'Posto removido', `#${id}`);
  revalidatePath('/', 'layout');
  voltar(PARAMS, formData);
}
