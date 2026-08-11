'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirAprovador } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { avisarComunicado } from '@/lib/avisos';
import { rotaComErro } from '@/lib/volta';
import { mensagemErroBanco } from '@/lib/erros-banco';
import { TIPOS_ANEXO, LIMITE_BYTES } from '@/lib/anexos';
import { redirect } from 'next/navigation';

const VOLTA = '/mural';

function erro(msg: string): never {
  redirect(rotaComErro(VOLTA, msg));
}

export async function publicarComunicado(formData: FormData) {
  const sessao = await getSessao();
  exigirAprovador(sessao.papel, VOLTA);

  const titulo = String(formData.get('titulo') ?? '').trim();
  const corpo = String(formData.get('corpo') ?? '').trim();
  const publico = String(formData.get('publico') ?? '');
  const equipeBruta = String(formData.get('equipeId') ?? '').trim();
  const fixado = formData.get('fixado') === 'on';

  if (!titulo) erro('Informe o título do comunicado.');
  if (!corpo) erro('Escreva o comunicado.');
  if (!['colaboradores', 'gestores'].includes(publico)) erro('Escolha para quem é o comunicado.');

  // O gestor publica só para colaboradores, e só da equipe que gerencia. A
  // policy do banco repete essa regra — a tela é conveniência, não a defesa.
  if (sessao.papel === 'gestor' && publico !== 'colaboradores') {
    erro('O gestor publica comunicados para a equipe, não para os gestores.');
  }

  const supabase = await createClient();

  let equipeId: number | null = equipeBruta ? Number(equipeBruta) : null;
  if (sessao.papel === 'gestor') {
    const { data: minhas } = await supabase.from('equipes').select('id').eq('gestor_id', sessao.usuario.id);
    const ids = (minhas ?? []).map((e: { id: number }) => e.id);
    if (ids.length === 0) erro('Você não gerencia nenhuma equipe.');
    if (!equipeId) equipeId = ids[0];
    if (!ids.includes(equipeId)) erro('Você só publica para uma equipe que gerencia.');
  }

  const { data: novo, error } = await supabase
    .from('comunicados')
    .insert({
      conta_id: sessao.conta.id,
      titulo,
      corpo,
      publico,
      equipe_id: equipeId,
      fixado,
      autor_id: sessao.usuario.id,
      autor_nome: sessao.usuario.nome,
    })
    .select('id')
    .single();

  if (error || !novo) erro(`Não foi possível publicar: ${mensagemErroBanco(error)}`);

  // ── Anexos ────────────────────────────────────────────────
  const arquivos = formData.getAll('anexos').filter((f): f is File => f instanceof File && f.size > 0);
  for (const arquivo of arquivos) {
    if (!TIPOS_ANEXO.includes(arquivo.type)) {
      erro(`"${arquivo.name}" não é imagem nem PDF. Aceitos: PNG, JPEG, WEBP, GIF e PDF.`);
    }
    if (arquivo.size > LIMITE_BYTES) {
      erro(`"${arquivo.name}" tem ${(arquivo.size / 1048576).toFixed(1)} MB — o limite por arquivo é 2 MB.`);
    }
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const { error: erroAnexo } = await supabase.from('comunicado_anexos').insert({
      conta_id: sessao.conta.id,
      comunicado_id: novo.id,
      nome: arquivo.name,
      tipo: arquivo.type,
      tamanho: arquivo.size,
      // `\\x…` é como o Postgres recebe bytea por texto; o driver do PostgREST
      // não tem tipo binário no JSON.
      conteudo: `\\x${bytes.toString('hex')}`,
    });
    if (erroAnexo) erro(`Comunicado publicado, mas o anexo "${arquivo.name}" falhou: ${mensagemErroBanco(erroAnexo)}`);
  }

  // ── Avisa quem vai ler ────────────────────────────────────
  const alvo = supabase.from('perfis').select('id');
  const { data: perfis } = publico === 'gestores'
    ? await alvo.eq('papel', 'gestor')
    : await alvo.eq('papel', 'colaborador');

  let ids = (perfis ?? []).map((p: { id: string }) => p.id);

  // Comunicado de equipe avisa só quem é da equipe.
  if (publico === 'colaboradores' && equipeId) {
    const { data: daEquipe } = await supabase
      .from('colaboradores')
      .select('perfil_id')
      .eq('equipe_id', equipeId);
    const perfisDaEquipe = new Set((daEquipe ?? [])
      .map((c: { perfil_id: string | null }) => c.perfil_id)
      .filter((x): x is string => !!x));
    ids = ids.filter((id: string) => perfisDaEquipe.has(id));
  }

  const avisados = await avisarComunicado(sessao, { perfis: ids, titulo });

  await registrarLog(
    sessao,
    'Comunicado publicado',
    `${titulo} · para ${publico}${equipeId ? ` (equipe ${equipeId})` : ''} · ${arquivos.length} anexo(s) · ${avisados} avisado(s)`,
  );
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?ok=1`);
}

export async function removerComunicado(formData: FormData) {
  const sessao = await getSessao();
  exigirAprovador(sessao.papel, VOLTA);

  const id = Number(formData.get('id'));
  if (!id) erro('Comunicado inválido.');

  const supabase = await createClient();
  // A policy já barra quem não é autor nem Planejamento; o delete devolve zero
  // linhas nesse caso, então a mensagem precisa vir daqui.
  const { data: apagado, error } = await supabase
    .from('comunicados').delete().eq('id', id).select('id, titulo');
  if (error) erro(`Não foi possível remover: ${mensagemErroBanco(error)}`);
  if (!apagado?.length) erro('Você só remove comunicados que publicou.');

  await registrarLog(sessao, 'Comunicado removido', apagado[0].titulo);
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?ok=1`);
}
