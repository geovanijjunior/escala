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

  // A caixa de saída da versão que sai de cena vai junto. Ela descreve
  // movimentos feitos sobre uma escala que deixou de existir — publicá-los
  // depois avisaria a equipe de mudanças que a nova geração já refez ou
  // desfez. E como a tela só lista as pendências da versão vigente, o que
  // ficasse aqui nunca mais apareceria para ninguém: lixo invisível que só
  // aparece no dia em que alguém consulta a tabela direto.
  if (anterior) {
    await supabase.from('alteracoes_pendentes').delete().eq('geracao_id', anterior.id);
  }

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
  if (!colaboradorId || !data || !destino) erro(volta, 'Dados insuficientes para mover a alocação.');

  // destino chega como "UNIDADE:12" ou como a própria modalidade ("HOME", "EXTERNO"…).
  const [modalidade, unidadeStr] = destino.split(':') as [Modalidade, string | undefined];
  const unidadeId = modalidade === 'UNIDADE' ? Number(unidadeStr) : null;
  if (modalidade === 'UNIDADE' && !unidadeId) erro(volta, 'Unidade de destino inválida.');

  const supabase = await createClient();
  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');
  exigirEditorDeEscala(sessao.papel, geracao.status, volta);

  // O estado anterior, para a caixa de saída poder dizer "de X para Y". Lido
  // antes do update, que é o único momento em que ele ainda existe.
  const { data: antes } = await supabase
    .from('alocacoes')
    .select('modalidade, unidade_id')
    .eq('geracao_id', geracao.id)
    .eq('colaborador_id', colaboradorId)
    .eq('data', data)
    .maybeSingle();

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

  // Escala em rascunho ainda não foi vista por ninguém: nada a comunicar.
  // Publicada, a alteração vai para a caixa de saída e só sai de lá quando
  // alguém confirmar — ver `publicarAlteracoes`. Uma reorganização de dez
  // linhas manda um aviso, não dez, e nenhum deles descreve um estado
  // intermediário que não durou até o fim do trabalho.
  if (geracao.status === 'publicada') {
    const rotulo = await rotuloDoDestino(supabase, modalidade, unidadeId);

    const chave = { geracao_id: geracao.id, colaborador_id: colaboradorId, data };
    const { data: jaPendente } = await supabase
      .from('alteracoes_pendentes')
      .select('id, de')
      .match(chave)
      .maybeSingle();

    // O ponto de partida é o que o colaborador viu por último, não o estado de
    // um segundo atrás: mover a mesma pessoa três vezes no mesmo dia é uma
    // alteração, e ela parte de onde ela estava quando a escala foi publicada.
    const origem = jaPendente
      ? jaPendente.de
      : await rotuloDoDestino(supabase, (antes?.modalidade ?? '') as Modalidade, antes?.unidade_id ?? null);

    if (origem === rotulo) {
      // Voltou para onde estava. Não há o que comunicar, e um aviso de "seu dia
      // mudou" sobre um dia que não mudou é pior do que aviso nenhum.
      if (jaPendente) await supabase.from('alteracoes_pendentes').delete().eq('id', jaPendente.id);
    } else if (jaPendente) {
      await supabase
        .from('alteracoes_pendentes')
        .update({ para: rotulo, por_id: sessao.usuario.id, por_nome: sessao.usuario.nome })
        .eq('id', jaPendente.id);
    } else {
      await supabase.from('alteracoes_pendentes').insert({
        conta_id: sessao.conta.id,
        ...chave,
        de: origem,
        para: rotulo,
        por_id: sessao.usuario.id,
        por_nome: sessao.usuario.nome,
      });
    }
  }

  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({ competencia, dia: data })}`);
}

/**
 * O destino em português.
 *
 * `MODALIDADES` não tem UNIDADE: unidade não é modalidade remota nem ausência,
 * é o nome do prédio. Sem isto o aviso diria "agora está como UNIDADE:2".
 */
async function rotuloDoDestino(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modalidade: Modalidade,
  unidadeId: number | null,
): Promise<string> {
  if (modalidade !== 'UNIDADE') return MODALIDADES[modalidade]?.label ?? String(modalidade);
  if (!unidadeId) return 'unidade';
  const { data: u } = await supabase.from('unidades').select('nome').eq('id', unidadeId).maybeSingle();
  return u?.nome ?? 'unidade';
}

/**
 * Comunica de uma vez tudo o que mudou desde a última publicação.
 *
 * É o passo que faltava entre "mexi na escala" e "a equipe soube". Mexer podia
 * ser um trabalho de meia hora com dez movimentos, e cada movimento mandava o
 * seu próprio aviso — inclusive os que foram desfeitos no minuto seguinte.
 * Agora quem reorganiza trabalha à vontade, vê os conflitos surgirem e
 * desaparecerem, e comunica quando o resultado está de pé.
 */
export async function publicarAlteracoes(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/calendario');
  const competencia = String(formData.get('competencia') ?? '');
  const alcance: Alcance = formData.get('alcance') === 'todos' ? 'todos' : 'afetados';

  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');
  exigirEditorDeEscala(sessao.papel, geracao.status, volta);

  const supabase = await createClient();
  const { data: pendentes } = await supabase
    .from('alteracoes_pendentes')
    .select('id, colaborador_id, data, de, para')
    .eq('geracao_id', geracao.id)
    .order('data');

  const linhas = (pendentes ?? []) as {
    id: number; colaborador_id: number; data: string; de: string; para: string;
  }[];
  if (linhas.length === 0) erro(volta, 'Não há alteração pendente para comunicar.');

  let avisados = 0;
  for (const l of linhas) {
    avisados += await avisarAlteracaoDaEscala(sessao, {
      geracaoId: geracao.id,
      competencia,
      data: l.data,
      colaboradorId: l.colaborador_id,
      resumo: l.de ? `de ${l.de} para ${l.para}` : `agora está como ${l.para}`,
      // O alcance vale para o lote inteiro: é uma decisão sobre a
      // reorganização, não sobre cada linha dela.
      alcance,
    });
  }

  await supabase.from('alteracoes_pendentes').delete().eq('geracao_id', geracao.id);

  await registrarLog(
    sessao,
    'Alterações da escala comunicadas',
    `${formatarCompetencia(competencia)} · ${linhas.length} alteração(ões) · `
      + `${alcance === 'todos' ? 'toda a escala' : 'só quem mudou'} · ${avisados} aviso(s)`,
  );
  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({ competencia, ok: '1' })}`);
}

/** Descarta a caixa de saída sem avisar ninguém. A escala fica como está. */
export async function descartarAlteracoesPendentes(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/calendario');
  const competencia = String(formData.get('competencia') ?? '');

  const geracao = await getGeracaoAtual(competencia);
  if (!geracao) erro(volta, 'Não há escala gerada para esse mês.');
  exigirEditorDeEscala(sessao.papel, geracao.status, volta);

  const supabase = await createClient();
  const { count } = await supabase
    .from('alteracoes_pendentes')
    .delete({ count: 'exact' })
    .eq('geracao_id', geracao.id);

  // A escala continua alterada — o que se descarta é o aviso, não a mudança.
  // Quem quiser voltar atrás move de volta; o log guarda os dois movimentos.
  await registrarLog(
    sessao,
    'Avisos de alteração descartados',
    `${formatarCompetencia(competencia)} · ${count ?? 0} alteração(ões) não comunicada(s)`,
  );
  revalidatePath('/', 'layout');
  redirect(`${volta}?competencia=${competencia}`);
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
