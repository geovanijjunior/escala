'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirPlanejamento } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { listarUnidades } from '@/lib/data/escalas';
import { addDias, cicloEfetivo, diffDias, formatarCompetencia } from '@/lib/domain/escalas/datas';

const VOLTA = '/planos';

/**
 * Devolve ao editor com o motivo — e com o editor ainda aberto no colaborador
 * certo, ancorado. Voltar para o topo da lista com a mensagem lá em cima faz o
 * usuário perder o contexto e parecer que o botão não fez nada.
 */
function erro(competencia: string, msg: string, colaboradorId?: number): never {
  const q = new URLSearchParams({ competencia, erro: msg });
  if (colaboradorId) q.set('colab', String(colaboradorId));
  redirect(`${VOLTA}?${q}${colaboradorId ? '#editor-plano' : ''}`);
}

const nums = (fd: FormData, campo: string) =>
  fd.getAll(campo).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);

/**
 * Salva o plano mensal de um colaborador. O formulário inteiro chega de uma vez
 * (distribuição, unidades fixas, home office, férias e ausências), então a
 * gravação regrava as tabelas filhas em bloco em vez de fazer diff campo a campo.
 */
export async function salvarPlano(formData: FormData) {
  const sessao = await getSessao();
  const competencia = String(formData.get('competencia') ?? '');
  exigirPlanejamento(sessao.papel, `${VOLTA}?competencia=${competencia}`);

  const colaboradorId = Number(formData.get('colaboradorId'));
  if (!colaboradorId || !/^\d{4}-\d{2}-01$/.test(competencia)) erro(competencia, 'Plano inválido.', colaboradorId);

  const supabase = await createClient();
  const unidades = (await listarUnidades()).filter(u => u.ativa);

  // ── Distribuição percentual: precisa fechar em 100 entre as unidades ativas.
  const distribuicao = unidades.map(u => ({
    unidade_id: u.id,
    percentual: Math.max(0, Math.min(100, Number(formData.get(`dist_${u.id}`) ?? 0))),
  }));
  const soma = distribuicao.reduce((acc, d) => acc + d.percentual, 0);
  if (soma !== 100) erro(competencia, `A distribuição soma ${soma}% — precisa somar exatamente 100%.`, colaboradorId);

  // ── Unidade fixa por dia da semana.
  const unidadesFixas: { dow: number; unidade_id: number }[] = [];
  for (let dow = 0; dow <= 6; dow++) {
    const valor = String(formData.get(`fixa_${dow}`) ?? '');
    if (!valor) continue;
    const unidadeId = Number(valor);
    if (unidades.some(u => u.id === unidadeId)) unidadesFixas.push({ dow, unidade_id: unidadeId });
  }

  // ── Home office.
  const modoBruto = String(formData.get('ho_modo') ?? '');
  const ho_modo = modoBruto === 'FIXO' || modoBruto === 'COTA' ? modoBruto : null;
  const ho_dias_semana = ho_modo === 'FIXO' ? nums(formData, 'ho_dias_semana') : [];
  const ho_dias_preferencia = ho_modo === 'COTA' ? nums(formData, 'ho_dias_preferencia') : [];
  const ho_dias_proibidos = ho_modo === 'COTA' ? nums(formData, 'ho_dias_proibidos') : [];
  const ho_quantidade = ho_modo === 'COTA' ? Math.max(1, Math.min(7, Number(formData.get('ho_quantidade') ?? 1))) : 0;

  if (ho_modo === 'FIXO' && ho_dias_semana.length === 0) erro(competencia, 'Home office fixo precisa de ao menos um dia da semana.', colaboradorId);
  for (const dow of ho_dias_semana) {
    if (unidadesFixas.some(f => f.dow === dow)) {
      erro(competencia, 'Um mesmo dia da semana não pode ser home office fixo e unidade fixa ao mesmo tempo.', colaboradorId);
    }
  }

  // ── Postos: só valem se a pessoa de fato vai à unidade do posto no mês.
  // Cobrar o Corpo Clínico de quem tem 0% de Morumbi seria escala impossível.
  const { data: postosDaConta } = await supabase
    .from('postos').select('id, nome, unidade_id').eq('ativo', true);

  const postos: { posto_id: number; dias: number; semana: number | null }[] = [];
  for (const po of (postosDaConta ?? []) as { id: number; nome: string; unidade_id: number }[]) {
    if (String(formData.get(`posto_${po.id}`) ?? '') !== 'on') continue;

    const dias = Number(formData.get(`posto_dias_${po.id}`) ?? 0);
    if (!Number.isInteger(dias) || dias < 1 || dias > 5) {
      erro(competencia, `Informe de 1 a 5 dias para o posto ${po.nome}.`, colaboradorId);
    }

    const semanaBruta = String(formData.get(`posto_semana_${po.id}`) ?? '').trim();
    const semana = semanaBruta === '' ? null : Number(semanaBruta);
    if (semana !== null && (!Number.isInteger(semana) || semana < 1 || semana > 6)) {
      erro(competencia, `Semana inválida para o posto ${po.nome}.`, colaboradorId);
    }

    const vaiNaUnidade = distribuicao.some(d => d.unidade_id === po.unidade_id && d.percentual > 0)
      || unidadesFixas.some(f => f.unidade_id === po.unidade_id);
    if (!vaiNaUnidade) {
      const nomeUnidade = unidades.find(u => u.id === po.unidade_id)?.nome ?? 'a unidade do posto';
      erro(competencia, `Para cobrir ${po.nome} é preciso que a pessoa tenha presença em ${nomeUnidade} — hoje a distribuição dela é 0% ali.`, colaboradorId);
    }

    postos.push({ posto_id: po.id, dias, semana });
  }

  const cicloBruto = String(formData.get('ciclo') ?? '');
  const ciclo = cicloBruto === 'IMPAR' || cicloBruto === 'PAR' ? cicloBruto : null;

  const { data: colab } = await supabase
    .from('colaboradores')
    .select('id, nome, regime, eleg_home')
    .eq('id', colaboradorId)
    .single();
  if (!colab) erro(competencia, 'Colaborador não encontrado.', colaboradorId);
  if (colab.regime === '12x36' && !ciclo) erro(competencia, 'Regime 12x36 exige definir o ciclo do mês.', colaboradorId);
  if (ho_modo && !colab.eleg_home) erro(competencia, `${colab.nome} não está marcado como elegível a home office.`, colaboradorId);

  const { data: plano, error: erroPlano } = await supabase
    .from('planos')
    .upsert(
      {
        conta_id: sessao.conta.id,
        colaborador_id: colaboradorId,
        competencia,
        ciclo,
        ho_modo,
        ho_dias_semana,
        ho_quantidade,
        ho_dias_preferencia,
        ho_dias_proibidos,
        atualizado_em: new Date().toISOString(),
        atualizado_por: sessao.usuario.id,
      },
      { onConflict: 'colaborador_id,competencia' }
    )
    .select('id')
    .single();

  if (erroPlano || !plano) erro(competencia, 'Não foi possível salvar o plano.', colaboradorId);

  await supabase.from('plano_distribuicao').delete().eq('plano_id', plano.id);
  await supabase.from('plano_distribuicao').insert(distribuicao.map(d => ({ ...d, plano_id: plano.id })));
  await supabase.from('plano_unidade_fixa').delete().eq('plano_id', plano.id);
  if (unidadesFixas.length) {
    await supabase.from('plano_unidade_fixa').insert(unidadesFixas.map(f => ({ ...f, plano_id: plano.id })));
  }
  await supabase.from('plano_posto').delete().eq('plano_id', plano.id);
  if (postos.length) {
    await supabase.from('plano_posto').insert(
      postos.map(x => ({ ...x, plano_id: plano.id, conta_id: sessao.conta.id }))
    );
  }

  await registrarLog(
    sessao,
    'Plano mensal salvo',
    `${colab.nome} · ${formatarCompetencia(competencia)} · ${distribuicao.map(d => `${d.unidade_id}:${d.percentual}%`).join(' ')}`
  );

  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?competencia=${competencia}&ok=1`);
}

/** Copia os planos de um mês para outro. Férias e ausências ficam de fora de
 *  propósito: são eventos datados, não configuração recorrente. */
export async function copiarPlanosDoMes(formData: FormData) {
  const sessao = await getSessao();
  const destino = String(formData.get('competencia') ?? '');
  exigirPlanejamento(sessao.papel, `${VOLTA}?competencia=${destino}`);

  const origem = String(formData.get('origem') ?? '');
  if (!/^\d{4}-\d{2}-01$/.test(origem) || !/^\d{4}-\d{2}-01$/.test(destino)) erro(destino, 'Meses inválidos.');
  if (origem === destino) erro(destino, 'A origem e o destino são o mesmo mês.');

  const supabase = await createClient();
  const { data: origens } = await supabase
    .from('planos')
    .select('*, plano_distribuicao(unidade_id, percentual), plano_unidade_fixa(dow, unidade_id), plano_posto(posto_id, dias, semana)')
    .eq('competencia', origem);

  if (!origens?.length) erro(destino, `Não há planos em ${formatarCompetencia(origem)} para copiar.`);

  const { data: jaExistem } = await supabase.from('planos').select('colaborador_id').eq('competencia', destino);
  const configurados = new Set((jaExistem ?? []).map(p => p.colaborador_id));

  type LinhaOrigem = {
    colaborador_id: number; ciclo: 'IMPAR' | 'PAR' | null; ho_modo: 'FIXO' | 'COTA' | null;
    ho_dias_semana: number[]; ho_quantidade: number; ho_dias_preferencia: number[]; ho_dias_proibidos: number[];
    plano_distribuicao: { unidade_id: number; percentual: number }[] | null;
    plano_unidade_fixa: { dow: number; unidade_id: number }[] | null;
    plano_posto: { posto_id: number; dias: number; semana: number }[] | null;
  };

  const pendentes = (origens as LinhaOrigem[]).filter(p => !configurados.has(p.colaborador_id));
  if (pendentes.length === 0) erro(destino, 'Todos os colaboradores já têm plano nesse mês.');

  for (const p of pendentes) {
    const { data: novo } = await supabase
      .from('planos')
      .insert({
        conta_id: sessao.conta.id,
        colaborador_id: p.colaborador_id,
        competencia: destino,
        // A paridade do 12x36 vira a cada mês de 31 dias, então copiá-la
        // literal gravaria no destino a paridade da ORIGEM. `cicloEfetivo`
        // conta os dias entre os dois meses e vira quando precisa.
        //
        // A herança implícita já fazia isso (`cicloDoMes`); a cópia explícita
        // continuava congelando — e o resultado dela é pior, porque fica
        // gravado no destino com cara de decisão tomada para aquele mês.
        ciclo: p.ciclo ? cicloEfetivo(p.ciclo, destino, origem) : null,
        ho_modo: p.ho_modo,
        ho_dias_semana: p.ho_dias_semana,
        ho_quantidade: p.ho_quantidade,
        ho_dias_preferencia: p.ho_dias_preferencia,
        ho_dias_proibidos: p.ho_dias_proibidos,
        atualizado_por: sessao.usuario.id,
      })
      .select('id')
      .single();
    if (!novo) continue;
    const dist = p.plano_distribuicao ?? [];
    if (dist.length) await supabase.from('plano_distribuicao').insert(dist.map(d => ({ ...d, plano_id: novo.id })));
    const fixas = p.plano_unidade_fixa ?? [];
    if (fixas.length) await supabase.from('plano_unidade_fixa').insert(fixas.map(f => ({ ...f, plano_id: novo.id })));
    // O posto ficava de fora, e quem cobria o Corpo Clínico voltava a ser um
    // presencial qualquer no mês copiado.
    const postos = p.plano_posto ?? [];
    if (postos.length) {
      await supabase.from('plano_posto').insert(
        postos.map(x => ({ ...x, plano_id: novo.id, conta_id: sessao.conta.id })),
      );
    }
  }

  await registrarLog(
    sessao,
    'Planos copiados',
    `${formatarCompetencia(origem)} → ${formatarCompetencia(destino)} · ${pendentes.length} colaborador(es)`
  );
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?competencia=${destino}&ok=1`);
}

/* ============================================================
   AUSÊNCIAS E FÉRIAS
   ============================================================ */

export async function salvarAusencia(formData: FormData) {
  const sessao = await getSessao();
  const competencia = String(formData.get('competencia') ?? '');
  exigirPlanejamento(sessao.papel, `${VOLTA}?competencia=${competencia}`);

  const colaboradorId = Number(formData.get('colaboradorId'));
  const tipo = String(formData.get('tipo') ?? '');
  const inicio = String(formData.get('inicio') ?? '');
  if (!colaboradorId || !['FERIAS', 'AUSENCIA'].includes(tipo)) erro(competencia, 'Ausência inválida.', colaboradorId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) erro(competencia, 'Informe a data de início.', colaboradorId);

  // Os dois tipos vêm como intervalo de datas, que é como as pessoas pensam
  // ("de 10 a 24"). Contar dias corridos de cabeça é trabalho para quem
  // preenche e fonte clássica de erro de um dia. Férias exigem o fim; numa
  // ausência o fim vazio significa um único dia, que é o caso mais comum.
  const fimBruto = String(formData.get('fim') ?? '').trim();
  if (tipo === 'FERIAS' && !/^\d{4}-\d{2}-\d{2}$/.test(fimBruto)) {
    erro(competencia, 'Informe a data final das férias.', colaboradorId);
  }
  if (fimBruto && !/^\d{4}-\d{2}-\d{2}$/.test(fimBruto)) {
    erro(competencia, 'Data final inválida.', colaboradorId);
  }

  const dias = fimBruto ? diffDias(inicio, fimBruto) + 1 : 1;
  if (dias < 1) erro(competencia, 'A data final não pode ser anterior à data de início.', colaboradorId);
  if (dias > 365) erro(competencia, 'O período não pode passar de 365 dias.', colaboradorId);

  const grupo = tipo === 'AUSENCIA' ? String(formData.get('grupo') ?? '') : '';
  const motivo = tipo === 'AUSENCIA' ? String(formData.get('motivo') ?? '') : '';
  if (tipo === 'AUSENCIA' && (!grupo || !motivo)) erro(competencia, 'Selecione o grupo e o motivo da ausência.', colaboradorId);

  const fim = addDias(inicio, dias - 1);
  const supabase = await createClient();

  // Sobreposição é rejeitada na gravação: no protótipo duas ausências podiam
  // cobrir o mesmo dia e a segunda simplesmente não surtia efeito.
  const idEdicao = Number(formData.get('id') ?? 0);
  const { data: existentes } = await supabase
    .from('ausencias')
    .select('id, inicio, dias')
    .eq('colaborador_id', colaboradorId);
  for (const a of (existentes ?? []) as { id: number; inicio: string; dias: number }[]) {
    if (a.id === idEdicao) continue;
    const outroFim = addDias(a.inicio, a.dias - 1);
    if (inicio <= outroFim && a.inicio <= fim) {
      erro(competencia, `Já existe uma ausência entre ${a.inicio.split('-').reverse().join('/')} e ${outroFim.split('-').reverse().join('/')} que se sobrepõe a esse período.`, colaboradorId);
    }
  }

  const registro = {
    conta_id: sessao.conta.id,
    colaborador_id: colaboradorId,
    tipo,
    inicio,
    dias,
    grupo,
    motivo,
    criado_por: sessao.usuario.id,
  };

  if (idEdicao) await supabase.from('ausencias').update(registro).eq('id', idEdicao);
  else await supabase.from('ausencias').insert(registro);

  await registrarLog(
    sessao,
    tipo === 'FERIAS' ? 'Férias lançadas' : 'Ausência lançada',
    `Colaborador ${colaboradorId} · ${inicio} a ${fim}${motivo ? ` · ${grupo} — ${motivo}` : ''}`
  );
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?competencia=${competencia}&colab=${colaboradorId}&ok=1#ausencias`);
}

export async function removerAusencia(formData: FormData) {
  const sessao = await getSessao();
  const competencia = String(formData.get('competencia') ?? '');
  exigirPlanejamento(sessao.papel, `${VOLTA}?competencia=${competencia}`);

  const id = Number(formData.get('id'));
  const colaboradorId = Number(formData.get('colaboradorId'));
  if (!id) erro(competencia, 'Ausência inválida.', colaboradorId);

  const supabase = await createClient();
  await supabase.from('ausencias').delete().eq('id', id);
  await registrarLog(sessao, 'Ausência removida', `Colaborador ${colaboradorId} · registro ${id}`);
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?competencia=${competencia}&colab=${colaboradorId}&ok=1#ausencias`);
}
