'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirPlanejamento } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { CARGOS } from '@/lib/domain/escalas/constantes';
import { DIAS_ABREV } from '@/lib/domain/escalas/datas';

const COLABS = '/colaboradores';
const PARAMS = '/parametros';

function erro(rota: string, msg: string): never {
  redirect(`${rota}?erro=${encodeURIComponent(msg)}`);
}

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

  if (!nome) erro(COLABS, 'Informe o nome.');
  if (!matricula) erro(COLABS, 'Informe a matrícula.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erro(COLABS, 'E-mail em formato inválido.');
  if (cargo && !CARGOS.includes(cargo)) erro(COLABS, 'Cargo inválido.');
  if (!equipeId) erro(COLABS, 'Selecione a equipe.');
  if (!unidadeBaseId) erro(COLABS, 'Selecione a unidade base.');
  if (!/^\d{2}:\d{2}$/.test(entrada)) erro(COLABS, 'Horário de entrada inválido.');
  if (!(jornada > 0 && jornada <= 24)) erro(COLABS, 'A jornada precisa estar entre 1 e 24 horas.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissao)) erro(COLABS, 'Informe a data de admissão.');
  if (!['ativo', 'afastado', 'desligado'].includes(status)) erro(COLABS, 'Situação inválida.');
  if (status === 'desligado' && !desligamento) erro(COLABS, 'Um colaborador desligado precisa da data de desligamento.');
  if (desligamento && desligamento < admissao) erro(COLABS, 'O desligamento não pode ser anterior à admissão.');

  const supabase = await createClient();

  // Regime e turno vêm da equipe; o turno pode ser sobreposto caso a caso.
  const { data: equipe } = await supabase.from('equipes').select('regime, turno, gestor_id').eq('id', equipeId).single();
  if (!equipe) erro(COLABS, 'Equipe não encontrada.');

  const ciclo = equipe.regime === '12x36'
    ? (cicloBruto === 'PAR' ? 'PAR' : 'IMPAR')
    : null;
  if (equipe.regime === '12x36' && !cicloBruto) erro(COLABS, 'Regime 12x36 exige definir o ciclo base (dias pares ou ímpares).');

  const duplicada = await supabase
    .from('colaboradores')
    .select('id')
    .eq('matricula', matricula)
    .neq('id', id || -1)
    .maybeSingle();
  if (duplicada.data) erro(COLABS, `A matrícula ${matricula} já pertence a outro colaborador.`);

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

  if (error) erro(COLABS, `Não foi possível salvar: ${error.message}`);

  await registrarLog(sessao, id ? 'Colaborador atualizado' : 'Colaborador criado', `${nome} · ${matricula} · ${status}`);
  revalidatePath('/', 'layout');
  redirect(`${COLABS}?ok=1`);
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

  if (!nome || !codigo || !sigla) erro(PARAMS, 'Nome, código e sigla são obrigatórios.');
  if (!Number.isInteger(total) || total < 0) erro(PARAMS, 'Capacidade total inválida.');
  if (!Number.isInteger(reservadas) || reservadas < 0) erro(PARAMS, 'Posições reservadas inválidas.');
  if (reservadas > total) erro(PARAMS, 'As posições reservadas não podem passar da capacidade total.');

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
  if (error) erro(PARAMS, `Não foi possível salvar a unidade: ${error.message}`);

  await registrarLog(sessao, id ? 'Unidade atualizada' : 'Unidade criada', `${nome} · ${total - reservadas} posições operacionais`);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
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
  const dowBruto = texto(formData, 'dow');
  const dataBruta = texto(formData, 'data');
  const totalBruto = texto(formData, 'total');
  const reservadasBruto = texto(formData, 'reservadas');

  if (!unidadeId) erro(PARAMS, 'Unidade inválida.');
  if (!dowBruto && !dataBruta) erro(PARAMS, 'Informe o dia da semana ou a data da exceção.');
  if (dowBruto && dataBruta) erro(PARAMS, 'A exceção vale para um dia da semana OU para uma data, não os dois.');

  const supabase = await createClient();
  const { data: unidade } = await supabase
    .from('unidades')
    .select('nome, capacidade_total')
    .eq('id', unidadeId)
    .single();
  if (!unidade) erro(PARAMS, 'Unidade não encontrada.');

  const total = totalBruto === '' ? unidade.capacidade_total : Number(totalBruto);
  const reservadas = reservadasBruto === '' ? 0 : Number(reservadasBruto);
  if (!Number.isInteger(total) || total < 0) erro(PARAMS, 'Capacidade total inválida.');
  if (!Number.isInteger(reservadas) || reservadas < 0) erro(PARAMS, 'Posições reservadas inválidas.');
  if (reservadas > total) {
    erro(PARAMS, `As ${reservadas} posições reservadas não cabem num total de ${total}.`);
  }

  // Uma exceção por (unidade, dia da semana) e uma por (unidade, data) — índices
  // únicos no banco. Apagar antes de inserir é o upsert possível aqui, já que a
  // unicidade é parcial e o onConflict do PostgREST não a alcança.
  const filtro = supabase.from('capacidades').delete().eq('unidade_id', unidadeId);
  await (dowBruto ? filtro.eq('dow', Number(dowBruto)) : filtro.eq('data', dataBruta));

  const { error } = await supabase.from('capacidades').insert({
    conta_id: sessao.conta.id,
    unidade_id: unidadeId,
    dow: dowBruto ? Number(dowBruto) : null,
    data: dataBruta || null,
    total,
    reservadas,
  });
  if (error) erro(PARAMS, `Não foi possível salvar a capacidade: ${error.message}`);

  const quando = dowBruto ? `toda ${DIAS_ABREV[Number(dowBruto)].toLowerCase()}` : dataBruta;
  await registrarLog(
    sessao,
    'Capacidade ajustada',
    `${unidade.nome} · ${quando} · ${total} lugares, ${reservadas} reservadas`
  );
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}

/** Remove uma exceção de capacidade: o dia volta a valer a capacidade padrão da unidade. */
export async function removerCapacidade(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id'));
  if (!id) erro(PARAMS, 'Exceção inválida.');

  const supabase = await createClient();
  const { error } = await supabase.from('capacidades').delete().eq('id', id);
  if (error) erro(PARAMS, `Não foi possível remover a exceção: ${error.message}`);

  await registrarLog(sessao, 'Exceção de capacidade removida', `#${id}`);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}

export async function salvarEquipe(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const id = Number(formData.get('id') ?? 0);
  const nome = texto(formData, 'nome');
  const codigo = texto(formData, 'codigo').toUpperCase();
  const regime = texto(formData, 'regime') === '12x36' ? '12x36' : '5x2';
  const turno = texto(formData, 'turno') === 'N' ? 'N' : 'D';
  if (!nome || !codigo) erro(PARAMS, 'Nome e código da equipe são obrigatórios.');

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
  if (error) erro(PARAMS, `Não foi possível salvar a equipe: ${error.message}`);

  await registrarLog(sessao, id ? 'Equipe atualizada' : 'Equipe criada', `${nome} · ${regime} · turno ${turno}`);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}

export async function salvarFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const data = texto(formData, 'data');
  const nome = texto(formData, 'nome');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erro(PARAMS, 'Data do feriado inválida.');
  if (!nome) erro(PARAMS, 'Informe o nome do feriado.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('feriados')
    .upsert({ conta_id: sessao.conta.id, data, nome }, { onConflict: 'conta_id,data' });
  if (error) erro(PARAMS, `Não foi possível salvar o feriado: ${error.message}`);

  await registrarLog(sessao, 'Feriado cadastrado', `${data} · ${nome}`);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}

export async function removerFeriado(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);
  const data = texto(formData, 'data');
  const supabase = await createClient();
  await supabase.from('feriados').delete().eq('data', data);
  await registrarLog(sessao, 'Feriado removido', data);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}

export async function salvarParametros(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, PARAMS);

  const cicloAncora = texto(formData, 'cicloAncora');
  const tolerancia = Number(formData.get('tolerancia'));
  const cobertura = Number(formData.get('cobertura'));

  if (!/^\d{4}-\d{2}-01$/.test(cicloAncora)) erro(PARAMS, 'A âncora do ciclo precisa ser o dia 1º de um mês.');
  if (!Number.isInteger(tolerancia) || tolerancia < 0) erro(PARAMS, 'Tolerância de aderência inválida.');
  if (!Number.isInteger(cobertura) || cobertura < 0) erro(PARAMS, 'Cobertura mínima inválida.');

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
  if (error) erro(PARAMS, `Não foi possível salvar os parâmetros: ${error.message}`);

  await registrarLog(sessao, 'Parâmetros do motor alterados', `Âncora ${cicloAncora} · tolerância ±${tolerancia} · cobertura mínima ${cobertura}`);
  revalidatePath('/', 'layout');
  redirect(`${PARAMS}?ok=1`);
}
