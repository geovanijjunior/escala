'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rotaComErro } from '@/lib/volta';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirPlanejamento, exigirEditorDeEscala } from '@/lib/sessao';
import { avisarAlteracaoDaEscala, type Alcance } from '@/lib/avisos';
import { registrarLog } from '@/lib/log';
import { carregarContextoMes, getGeracaoAtual, pendenciasDoMes, simular } from '@/lib/data/escalas';
import { diasNoMes, formatarCompetencia, formatarData, iso, partesIso } from '@/lib/domain/escalas/datas';
import { MODALIDADES } from '@/lib/domain/escalas/constantes';
import type { Modalidade } from '@/lib/domain/escalas/tipos';

const VOLTA = '/gerar';

function erro(rota: string, msg: string): never {
  redirect(rotaComErro(rota, msg));
}

/**
 * Grava uma nova versão da escala do mês.
 *
 * `equipes` e a janela `de`/`ate` recortam a regeração: tudo que fica fora do
 * recorte é reinjetado como trava, de modo que o motor recalcula só o pedaço
 * pedido e o resto sai idêntico ao que já estava publicado.
 */
export async function gerarEscalaDoMes(formData: FormData) {
  const sessao = await getSessao();
  exigirPlanejamento(sessao.papel, VOLTA);

  const competencia = String(formData.get('competencia') ?? '');
  if (!/^\d{4}-\d{2}-01$/.test(competencia)) erro(VOLTA, 'Competência inválida.');

  const equipes = formData.getAll('equipes').map(Number).filter(n => Number.isFinite(n));
  const de = String(formData.get('de') ?? '');
  const ate = String(formData.get('ate') ?? '');
  const parcial = equipes.length > 0 || !!de || !!ate;

  const ctx = await carregarContextoMes(competencia, sessao.conta.id);

  const pendencias = pendenciasDoMes(ctx);
  if (pendencias.length > 0) {
    erro(`${VOLTA}?competencia=${competencia}`, `Existem ${pendencias.length} pendência(s) nos planos do mês. Resolva antes de gerar.`);
  }

  const supabase = await createClient();

  // Recorte parcial: congela o que está fora do escopo a partir da geração vigente.
  const travasExtras: { colaboradorId: number; data: string; modalidade: Modalidade; unidadeId: number | null }[] = [];
  const anterior = await getGeracaoAtual(competencia);
  if (parcial && anterior) {
    const { data: antigas } = await supabase
      .from('alocacoes')
      .select('colaborador_id, data, modalidade, unidade_id')
      .eq('geracao_id', anterior.id);
    const equipePorColab = new Map(ctx.colaboradores.map(c => [c.id, c.equipeId]));
    for (const a of (antigas ?? []) as { colaborador_id: number; data: string; modalidade: Modalidade; unidade_id: number | null }[]) {
      const foraDaEquipe = equipes.length > 0 && !equipes.includes(equipePorColab.get(a.colaborador_id) ?? -1);
      const foraDaJanela = (de && a.data < de) || (ate && a.data > ate);
      if (foraDaEquipe || foraDaJanela) {
        travasExtras.push({ colaboradorId: a.colaborador_id, data: a.data, modalidade: a.modalidade, unidadeId: a.unidade_id });
      }
    }
  }

  const resultado = simular(ctx, travasExtras);

  const escopo = parcial
    ? `Parcial — ${equipes.length ? ctx.equipes.filter(e => equipes.includes(e.id)).map(e => e.nome).join(', ') : 'todas as equipes'}` +
      ` · ${de || ate ? `${de ? formatarData(de) : 'início'} a ${ate ? formatarData(ate) : 'fim'}` : 'mês inteiro'}`
    : 'Mês completo';

  // Só uma geração fica marcada como atual por competência (índice parcial no banco).
  await supabase.from('geracoes').update({ atual: false }).eq('competencia', competencia).eq('atual', true);

  const { data: nova, error: erroGeracao } = await supabase
    .from('geracoes')
    .insert({
      conta_id: sessao.conta.id,
      competencia,
      versao: (anterior?.versao ?? 0) + 1,
      status: 'rascunho',
      escopo,
      conflitos: resultado.conflitos,
      alertas: resultado.alertas,
      aderencia: resultado.aderencia,
      atual: true,
      gerada_por: sessao.usuario.id,
      gerada_por_nome: sessao.usuario.nome,
    })
    .select('id, versao')
    .single();

  if (erroGeracao || !nova) {
    // Sem geração nova, devolve a anterior ao posto de vigente pra não deixar o
    // mês órfão (o update acima já tinha zerado o flag).
    if (anterior) await supabase.from('geracoes').update({ atual: true }).eq('id', anterior.id);
    erro(`${VOLTA}?competencia=${competencia}`, 'Não foi possível gravar a geração. Tente novamente.');
  }

  const travadas = new Set([...ctx.pins, ...travasExtras].map(p => `${p.colaboradorId}|${p.data}`));
  const linhas = resultado.alocacoes.map(a => ({
    conta_id: sessao.conta.id,
    geracao_id: nova.id,
    colaborador_id: a.colaboradorId,
    data: a.data,
    modalidade: a.modalidade,
    unidade_id: a.unidadeId,
    posto_id: a.postoId,
    travado: travadas.has(`${a.colaboradorId}|${a.data}`),
  }));

  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('alocacoes').insert(linhas.slice(i, i + 500));
    if (error) {
      await supabase.from('geracoes').delete().eq('id', nova.id);
      if (anterior) await supabase.from('geracoes').update({ atual: true }).eq('id', anterior.id);
      erro(`${VOLTA}?competencia=${competencia}`, 'Falha ao gravar as alocações. Nada foi alterado.');
    }
  }

  await registrarLog(
    sessao,
    'Escala gerada',
    `${formatarCompetencia(competencia)} · versão ${nova.versao} · ${escopo} · ${resultado.conflitos.length} conflito(s), ${resultado.alertas.length} alerta(s)`
  );

  revalidatePath('/', 'layout');
  redirect(`/gerar?competencia=${competencia}&passo=revisar`);
}

/** rascunho → publicada → encerrada. Só avança; não há caminho de volta. */
export async function mudarStatusEscala(formData: FormData) {
  const sessao = await getSessao();
  const competencia = String(formData.get('competencia') ?? '');
  const destino = String(formData.get('status') ?? '');
  const volta = String(formData.get('volta') ?? '/calendario');
  exigirPlanejamento(sessao.papel, volta);

  if (!['publicada', 'encerrada'].includes(destino)) erro(volta, 'Status inválido.');

  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');

  const permitido = (geracao.status === 'rascunho' && destino === 'publicada')
    || (geracao.status === 'publicada' && destino === 'encerrada');
  if (!permitido) erro(volta, `Uma escala ${geracao.status} não pode ir para ${destino}.`);

  const supabase = await createClient();
  await supabase.from('geracoes').update({ status: destino }).eq('id', geracao.id);

  await registrarLog(
    sessao,
    destino === 'publicada' ? 'Escala publicada' : 'Mês encerrado',
    `${formatarCompetencia(competencia)} · versão ${geracao.versao}`
  );

  revalidatePath('/', 'layout');
  redirect(`${volta}?competencia=${competencia}`);
}

/** Trava/destrava a alocação de uma pessoa num dia, para sobreviver à regeração. */
export async function alternarTrava(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/calendario');

  const colaboradorId = Number(formData.get('colaboradorId'));
  const data = String(formData.get('data') ?? '');
  const competencia = String(formData.get('competencia') ?? '');
  if (!colaboradorId || !/^\d{4}-\d{2}-\d{2}$/.test(data)) erro(volta, 'Alocação inválida.');

  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');
  exigirEditorDeEscala(sessao.papel, geracao.status, volta);

  const supabase = await createClient();
  const { data: existente } = await supabase
    .from('pins')
    .select('id')
    .eq('colaborador_id', colaboradorId)
    .eq('data', data)
    .maybeSingle();

  if (existente) {
    await supabase.from('pins').delete().eq('id', existente.id);
    await supabase.from('alocacoes').update({ travado: false }).eq('colaborador_id', colaboradorId).eq('data', data);
    await registrarLog(sessao, 'Trava removida', `Colaborador ${colaboradorId} em ${formatarData(data)}`);
  } else {
    const modalidade = String(formData.get('modalidade') ?? '') as Modalidade;
    const unidadeIdBruto = String(formData.get('unidadeId') ?? '');
    const unidadeId = unidadeIdBruto ? Number(unidadeIdBruto) : null;
    if (!modalidade) erro(volta, 'Modalidade inválida para travar.');
    if (modalidade === 'UNIDADE' && !unidadeId) erro(volta, 'Uma alocação em unidade precisa da unidade para ser travada.');

    await supabase.from('pins').insert({
      conta_id: sessao.conta.id,
      colaborador_id: colaboradorId,
      data,
      modalidade,
      unidade_id: unidadeId,
      motivo: String(formData.get('motivo') ?? ''),
      criado_por: sessao.usuario.id,
    });
    await supabase.from('alocacoes').update({ travado: true }).eq('colaborador_id', colaboradorId).eq('data', data);
    await registrarLog(sessao, 'Alocação travada', `Colaborador ${colaboradorId} em ${formatarData(data)} · ${modalidade}`);
  }

  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({ competencia, dia: data })}`);
}

/** Move manualmente uma pessoa de modalidade/unidade num dia — e já deixa travado. */
export async function reposicionarAlocacao(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/calendario');

  const colaboradorId = Number(formData.get('colaboradorId'));
  const data = String(formData.get('data') ?? '');
  const destino = String(formData.get('destino') ?? '');
  const competencia = String(formData.get('competencia') ?? '');
  const alcance: Alcance = formData.get('alcance') === 'todos' ? 'todos' : 'afetados';
  if (!colaboradorId || !data || !destino) erro(volta, 'Dados insuficientes para mover a alocação.');

  // destino chega como "UNIDADE:12" ou como a própria modalidade ("HOME", "EXTERNO"…).
  const [modalidade, unidadeStr] = destino.split(':') as [Modalidade, string | undefined];
  const unidadeId = modalidade === 'UNIDADE' ? Number(unidadeStr) : null;
  if (modalidade === 'UNIDADE' && !unidadeId) erro(volta, 'Unidade de destino inválida.');

  const supabase = await createClient();
  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');
  exigirEditorDeEscala(sessao.papel, geracao.status, volta);

  await supabase
    .from('alocacoes')
    .update({ modalidade, unidade_id: unidadeId, travado: true })
    .eq('geracao_id', geracao.id)
    .eq('colaborador_id', colaboradorId)
    .eq('data', data);

  await supabase.from('pins').upsert(
    {
      conta_id: sessao.conta.id,
      colaborador_id: colaboradorId,
      data,
      modalidade,
      unidade_id: unidadeId,
      motivo: 'Ajuste manual no calendário',
      criado_por: sessao.usuario.id,
    },
    { onConflict: 'colaborador_id,data' }
  );

  await registrarLog(sessao, 'Alocação ajustada', `Colaborador ${colaboradorId} em ${formatarData(data)} → ${destino}`);

  // O aviso precisa dizer o destino em português, não "UNIDADE:2".
  // `MODALIDADES` não tem UNIDADE: unidade não é modalidade remota nem ausência,
  // é o nome do prédio — que vem da consulta abaixo.
  let rotulo: string = modalidade === 'UNIDADE'
    ? 'unidade'
    : MODALIDADES[modalidade]?.label ?? modalidade;
  if (modalidade === 'UNIDADE' && unidadeId) {
    const { data: u } = await supabase.from('unidades').select('nome').eq('id', unidadeId).maybeSingle();
    rotulo = u?.nome ?? rotulo;
  }

  // Escala em rascunho ainda não foi vista por ninguém — avisar seria ruído.
  let avisados = 0;
  if (geracao.status === 'publicada') {
    avisados = await avisarAlteracaoDaEscala(sessao, {
      geracaoId: geracao.id,
      competencia,
      data,
      colaboradorId,
      resumo: `agora está como ${rotulo}`,
      alcance,
    });
  }

  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({
    competencia, dia: data, ...(avisados ? { avisados: String(avisados) } : {}),
  })}`);
}

export async function liberarTodasAsTravas(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? VOLTA);
  exigirPlanejamento(sessao.papel, volta);

  const competencia = String(formData.get('competencia') ?? '');
  if (!/^\d{4}-\d{2}-01$/.test(competencia)) erro(volta, 'Competência inválida.');
  const [ano, mes] = partesIso(competencia);

  const supabase = await createClient();
  const { count } = await supabase
    .from('pins')
    .delete({ count: 'exact' })
    .gte('data', competencia)
    .lte('data', iso(ano, mes, diasNoMes(ano, mes)));

  await registrarLog(sessao, 'Travas liberadas', `${formatarCompetencia(competencia)} · ${count ?? 0} trava(s)`);
  revalidatePath('/', 'layout');
  redirect(`${volta}?competencia=${competencia}`);
}
