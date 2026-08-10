import { createClient } from '@/lib/supabase/server';
import type { Sessao } from './sessao';

/** Trilha de auditoria do módulo. No protótipo essa tela era conteúdo estático. */
export async function registrarLog(sessao: Sessao, acao: string, detalhe = '') {
  const supabase = await createClient();
  await supabase.from('logs').insert({
    conta_id: sessao.conta.id,
    usuario_id: sessao.usuario.id,
    usuario_nome: sessao.usuario.nome,
    acao,
    detalhe,
  });
}
