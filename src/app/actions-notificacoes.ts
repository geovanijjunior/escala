'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao } from '@/lib/sessao';
import { voltar } from '@/lib/volta';

/**
 * Zera o sino inteiro. Marca o instante atual como "visto"; tudo mais novo que
 * isso volta a contar como não lido.
 *
 * Continua sendo um carimbo só, e não uma linha por item: quem clica em
 * "marcar todas" está dizendo "não quero ver nada disso", e gravar N linhas
 * para representar isso seria trabalho sem leitor.
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
 * Abre o item do sino e o retira da lista — só ele.
 *
 * Antes isto avançava `notificacoes_vistas_em`, o mesmo carimbo do "marcar
 * todas". Enquanto o sino mostrava tudo e apenas destacava o que era novo, dava
 * para conviver com isso. Quando ele passou a mostrar só o que falta ler, o
 * efeito ficou impossível de defender: abrir um aviso esvaziava a lista
 * inteira, e os outros — que ninguém tinha visto — sumiam junto.
 *
 * A rota vem do aviso, mas é conferida aqui: precisa ser caminho interno
 * começando com uma barra só. Sem isso, `//exemplo.com` no formulário viraria
 * redirecionamento para fora do sistema.
 */
export async function abrirNotificacao(formData: FormData) {
  const pedida = String(formData.get('rota') ?? '');
  const destino = /^\/(?!\/)/.test(pedida) ? pedida : '/solicitacoes';
  const chave = String(formData.get('chave') ?? '').trim();

  const sessao = await getSessao();
  const supabase = await createClient();

  if (chave) {
    // `ignoreDuplicates`: reabrir o mesmo item pelo botão voltar não pode
    // falhar por chave duplicada, e a data que interessa é a da primeira vez.
    await supabase.from('notificacoes_lidas').upsert(
      {
        conta_id: sessao.conta.id,
        perfil_id: sessao.usuario.id,
        chave,
      },
      { onConflict: 'perfil_id,chave', ignoreDuplicates: true },
    );
  }

  revalidatePath('/', 'layout');
  redirect(destino);
}
