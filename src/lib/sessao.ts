import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';
import type { Conta, PerfilUsuario } from '@/lib/supabase/types';

export interface Sessao {
  usuario: PerfilUsuario;
  conta: Conta;
  papel: PapelEscalas;
  /** Linha em `colaboradores` ligada ao usuário logado, quando existir. */
  colaboradorId: number | null;
}

/**
 * Sessão do Administrador Geral, que não tem conta.
 *
 * É um tipo separado de propósito. `Sessao.conta` não é opcional, e todo o
 * console de escala conta com isso — deixar o campo nulável para acomodar um
 * papel que nunca abre aquelas telas espalharia um `?.` por cada uma delas para
 * proteger de um caso que não existe.
 */
export interface SessaoGeral {
  usuario: PerfilUsuario;
}

/**
 * Carrega usuário, conta, papel e a qual colaborador o usuário corresponde.
 *
 * Todo perfil tem papel — quem não tem colaborador vinculado simplesmente não
 * aparece na escala, mas continua operando o sistema conforme o papel.
 *
 * Redireciona para o login se não houver sessão; é defesa em profundidade, já
 * que o proxy.ts barra antes de chegar aqui.
 *
 * Envolvido em `cache()`: o layout e a página chamam esta função na mesma
 * requisição, e sem isso a segunda chamada repetia tudo. O cache do React vale
 * só enquanto a requisição existe — não é cache entre usuários nem entre
 * navegações, então não há risco de vazar sessão de um para outro.
 *
 * As três consultas seguintes são disparadas juntas. `contas` não precisa do
 * conta_id do perfil para ser encontrada: a policy `contas_select` já é
 * `id = conta_id()`, então a tabela inteira, sob RLS, é exatamente a conta do
 * usuário. Isso quebra a dependência que obrigava a esperar `perfis` terminar.
 *
 * A única sessão que enxerga mais de uma linha em `contas` é a do Administrador
 * Geral — e ela é desviada para `/areas` antes de olhar o resultado, por isso
 * `maybeSingle()` em vez de `single()`: ali "mais de uma" não é erro, é o papel.
 */
export const getSessao = cache(async function getSessao(): Promise<Sessao> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [perfilRes, contaRes, colabRes] = await Promise.all([
    supabase.from('perfis').select('*').eq('id', user.id).single(),
    supabase.from('contas').select('*').maybeSingle(),
    supabase.from('colaboradores').select('id').eq('perfil_id', user.id).maybeSingle(),
  ]);

  const perfil = perfilRes.data as PerfilUsuario | null;
  if (!perfil) redirect('/login');

  // O Administrador Geral não tem conta, e daqui para baixo tudo pressupõe uma.
  // Mandá-lo para o console dele é mais honesto do que devolvê-lo ao login com
  // a impressão de que a credencial está errada.
  if (perfil.papel === 'admin_geral') redirect('/areas');

  if (!contaRes.data) redirect('/login');

  // Desativar a área precisa valer para quem já está dentro. Sem esta linha, a
  // desativação só barraria logins novos, e qualquer aba aberta seguiria
  // operando a escala de uma área que o sistema considera fora do ar.
  const conta = contaRes.data as Conta;
  if (conta.ativa === false) {
    redirect(`/login?erro=${encodeURIComponent('Esta área está desativada. Fale com o administrador do sistema.')}`);
  }

  return {
    usuario: perfil,
    conta,
    papel: perfil.papel,
    colaboradorId: colabRes.data?.id ?? null,
  };
});

/**
 * Sessão do console de áreas. Só o Administrador Geral entra.
 *
 * Não reaproveita `getSessao()` porque ela exige conta — e a ausência de conta
 * é exatamente o que define este papel.
 */
export const getSessaoGeral = cache(async function getSessaoGeral(): Promise<SessaoGeral> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase.from('perfis').select('*').eq('id', user.id).single();
  const perfil = data as PerfilUsuario | null;
  if (!perfil) redirect('/login');
  if (perfil.papel !== 'admin_geral') redirect('/');

  return { usuario: perfil };
});

export function ehPlanejamento(papel: PapelEscalas): boolean {
  return papel === 'planejamento';
}

export function podeAprovar(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}

export function podeVerEquipe(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}

/**
 * Quem mexe nos cadastros de base da área: colaboradores, equipes, unidades,
 * postos, feriados e usuários.
 *
 * É a única coisa que o Administrador da Área e o Planejamento fazem em comum.
 * Plano do mês, geração, publicação e triagem de solicitação continuam sendo só
 * do Planejamento, e continuam guardados por `exigirPlanejamento` — que é
 * estrito de propósito: um papel novo só ganha alcance onde alguém o escreveu.
 */
export function podeCadastrar(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'admin_local';
}

/** Barra a ação e volta pra tela de origem com o motivo explícito na query. */
export function exigirPlanejamento(papel: PapelEscalas, voltarPara: string): void {
  if (papel !== 'planejamento') {
    redirect(`${voltarPara}?erro=${encodeURIComponent('Só o Planejamento pode fazer essa alteração.')}`);
  }
}

export function exigirCadastrador(papel: PapelEscalas, voltarPara: string): void {
  if (!podeCadastrar(papel)) {
    redirect(
      `${voltarPara}?erro=${encodeURIComponent('Só o Planejamento e o Administrador da Área podem alterar cadastros.')}`,
    );
  }
}

export function exigirAprovador(papel: PapelEscalas, voltarPara: string): void {
  if (papel !== 'planejamento' && papel !== 'gestor') {
    redirect(`${voltarPara}?erro=${encodeURIComponent('Você não tem permissão para essa ação.')}`);
  }
}

/**
 * Quem pode mexer na escala à mão.
 *
 * O Planejamento monta o mês e ajusta antes e depois de publicar. O gestor
 * ajusta a equipe dele DEPOIS da publicação: antes disso a escala ainda está
 * sendo montada, e mexer num rascunho que vai ser regerado só cria a impressão
 * de que a mudança foi feita. Mês encerrado não aceita ninguém.
 */
export function podeEditarEscala(papel: PapelEscalas, status: string): boolean {
  if (status === 'encerrada') return false;
  if (papel === 'planejamento') return true;
  return papel === 'gestor' && status === 'publicada';
}

export function exigirEditorDeEscala(papel: PapelEscalas, status: string, voltarPara: string): void {
  if (podeEditarEscala(papel, status)) return;
  const motivo = status === 'encerrada'
    ? 'O mês está encerrado e não aceita mais alterações.'
    : papel === 'gestor'
      ? 'O gestor só ajusta a escala depois de publicada.'
      : 'Você não tem permissão para alterar a escala.';
  redirect(`${voltarPara}?erro=${encodeURIComponent(motivo)}`);
}
