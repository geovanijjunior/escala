'use server';

import { revalidatePath } from 'next/cache';
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
