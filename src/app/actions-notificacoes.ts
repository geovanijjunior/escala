'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao } from '@/lib/sessao';
import { voltar } from '@/lib/volta';

/**
 * Zera o sino. Marca o instante atual como "visto"; tudo mais novo que isso
 * volta a contar como não lido.
 *
 * Não recebe uma lista de ids de propósito: marcar item a item obrigaria a
 * guardar leitura por evento e por pessoa, e o valor disso não paga a tabela
 * extra num sistema onde o histórico completo continua na própria solicitação.
 */
export async function marcarNotificacoesLidas(formData: FormData) {
  const sessao = await getSessao();
  const supabase = await createClient();

  await supabase
    .from('perfis')
    .update({ notificacoes_vistas_em: new Date().toISOString() })
    .eq('id', sessao.usuario.id);

  revalidatePath('/', 'layout');
  voltar(String(formData.get('rota') || '/'), formData);
}

/**
 * Abre a solicitação de uma notificação e, no mesmo passo, zera o sino.
 *
 * O item era um link puro: a pessoa lia o aviso, ia até a solicitação, voltava
 * — e o contador continuava no mesmo número. Só o botão "Marcar como lidas"
 * mexia nele, e ninguém associa ter lido um aviso a precisar marcá-lo depois.
 *
 * Marca tudo até agora, não só o item clicado: `notificacoes_vistas_em` é um
 * instante, não uma lista. Ler por item exigiria uma tabela de leitura por
 * evento e por pessoa, e o histórico completo já vive na própria solicitação.
 *
 * A rota vem do aviso, mas é conferida aqui: precisa ser caminho interno
 * começando com uma barra só. Sem isso, `//exemplo.com` no formulário viraria
 * redirecionamento para fora do sistema.
 */
export async function abrirNotificacao(formData: FormData) {
  const pedida = String(formData.get('rota') ?? '');
  const destino = /^\/(?!\/)/.test(pedida) ? pedida : '/solicitacoes';
  const sessao = await getSessao();
  const supabase = await createClient();

  await supabase
    .from('perfis')
    .update({ notificacoes_vistas_em: new Date().toISOString() })
    .eq('id', sessao.usuario.id);

  revalidatePath('/', 'layout');
  redirect(destino);
}
