import type { SupabaseClient } from '@supabase/supabase-js';
import { CARGOS, MOTIVOS_INATIVACAO } from '@/lib/domain/escalas/constantes';
import { horaNormalizada } from '@/lib/domain/escalas/datas';

/**
 * Leitura e validação dos campos de colaborador vindos de um formulário.
 *
 * Existe porque agora são DOIS os formulários que criam colaborador: o de
 * Colaboradores, que é o cadastro completo, e o de Usuários, que cria o login e
 * o colaborador no mesmo passo quando o papel escolhido é "colaborador".
 *
 * Não redireciona nem grava: devolve o registro pronto ou a primeira mensagem
 * de erro, e quem chamou decide para qual tela voltar. Foi o que permitiu os
 * dois caminhos compartilharem a regra em vez de manterem cópias — duas cópias
 * da mesma validação divergem no primeiro ajuste que alguém fizer só de um
 * lado, e a que ficar para trás não dá erro: aceita o cadastro errado.
 *
 * `ciclo` não aparece no registro de propósito. No insert o banco aplica o
 * default; no update, omitir a coluna preserva o que já estava lá — incluí-la
 * como `null` apagaria, a cada edição de cadastro, o ciclo histórico de quem
 * foi cadastrado antes de a regra mudar.
 */

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? '').trim();
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true';

export interface RegistroColaborador {
  conta_id: string;
  perfil_id: string | null;
  nome: string;
  matricula: string;
  email: string;
  cargo: string;
  equipe_id: number;
  gestor_id: string | null;
  regime: string;
  turno: 'D' | 'N';
  entrada: string;
  saida: string;
  unidade_base_id: number;
  eleg_home: boolean;
  eleg_externo: boolean;
  sexta_reduzida: boolean;
  status: string;
  motivo_status: string;
  admissao: string;
  desligamento: string | null;
}

/**
 * União discriminada por `ok`, e não por "tem `erro`?".
 *
 * Quem chama faz `if (!lido.ok) return voltarComErro(...)`. O `return` é o que
 * garante o estreitamento: sem ele o TypeScript não conclui sozinho que o
 * caminho de erro termina ali, e o acesso a `registro` logo abaixo não compila.
 */
export type ResultadoColaborador =
  | { ok: false; erro: string }
  | { ok: true; registro: RegistroColaborador; rotuloMotivo: string | null };

export async function montarColaborador(
  supabase: SupabaseClient,
  contaId: string,
  formData: FormData,
  opcoes: { id?: number; perfilId?: string | null; nome?: string; email?: string } = {},
): Promise<ResultadoColaborador> {
  const id = opcoes.id ?? 0;
  // No cadastro unificado o nome e o e-mail são os do usuário, e não campos
  // repetidos do colaborador — pedir duas vezes a mesma coisa é como as duas
  // grafias do mesmo nome entram na base.
  const nome = opcoes.nome ?? texto(formData, 'nome');
  const email = opcoes.email ?? texto(formData, 'email');

  const matricula = texto(formData, 'matricula');
  const cargo = texto(formData, 'cargo');
  const equipeId = Number(formData.get('equipeId'));
  const unidadeBaseId = Number(formData.get('unidadeBaseId'));
  // Normalizados aqui, e não conferidos por formato lá embaixo: `8:00` e
  // `08:00` são o mesmo horário e precisam entrar iguais no banco, e `99:99`
  // não é horário nenhum embora tenha a forma de um.
  const entrada = horaNormalizada(texto(formData, 'entrada'));
  const saida = horaNormalizada(texto(formData, 'saida'));
  const admissao = texto(formData, 'admissao');
  const desligamento = texto(formData, 'desligamento');

  // O status é DERIVADO do motivo, não enviado ao lado dele. Com os dois vindo
  // da tela, um dia eles discordariam — "ativo" com motivo de desligamento — e
  // não haveria como saber qual dos dois é o verdadeiro.
  const ativo = texto(formData, 'ativo') !== '0';
  const motivoStatus = ativo ? '' : texto(formData, 'motivoStatus');
  const regra = MOTIVOS_INATIVACAO.find(m => m.chave === motivoStatus);
  const status = ativo ? 'ativo' : (regra?.desliga ? 'desligado' : 'afastado');
  const turno = texto(formData, 'turno') === 'N' ? 'N' : 'D';

  if (!nome) return { ok: false, erro: 'Informe o nome.' };
  if (!matricula) return { ok: false, erro: 'Informe a matrícula.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erro: 'E-mail em formato inválido.' };
  if (cargo && !CARGOS.includes(cargo)) return { ok: false, erro: 'Cargo inválido.' };
  if (!equipeId) return { ok: false, erro: 'Selecione a equipe.' };
  if (!unidadeBaseId) return { ok: false, erro: 'Selecione a unidade base.' };
  if (!entrada) return { ok: false, erro: 'Horário de entrada inválido.' };
  if (!saida) return { ok: false, erro: 'Horário de saída inválido.' };
  // Saída igual à entrada seria turno de duração zero. Saída ANTES da entrada é
  // aceita de propósito: é o turno noturno, que entra num dia e sai no outro.
  if (saida === entrada) return { ok: false, erro: 'A saída não pode ser igual à entrada.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissao)) return { ok: false, erro: 'Informe a data de admissão.' };
  if (!ativo && !regra) return { ok: false, erro: 'Informe o motivo da inativação.' };
  if (status === 'desligado' && !desligamento) return { ok: false, erro: 'Um colaborador desligado precisa da data de desligamento.' };
  if (desligamento && desligamento < admissao) return { ok: false, erro: 'O desligamento não pode ser anterior à admissão.' };

  // Regime e turno vêm da equipe; o turno pode ser sobreposto caso a caso.
  const { data: equipe } = await supabase
    .from('equipes').select('regime, turno, gestor_id').eq('id', equipeId).single();
  if (!equipe) return { ok: false, erro: 'Equipe não encontrada.' };

  // O ciclo do 12x36 NÃO é pedido aqui: quem decide é o plano do mês, que o
  // motor lê primeiro e cuja validação bloqueia a geração sem ele. Pedir nos
  // dois lugares criava um valor que ninguém consultava.

  const duplicada = await supabase
    .from('colaboradores').select('id').eq('matricula', matricula).neq('id', id || -1).maybeSingle();
  if (duplicada.data) return { ok: false, erro: `A matrícula ${matricula} já pertence a outro colaborador.` };

  return {
    ok: true,
    rotuloMotivo: regra?.label ?? null,
    registro: {
      conta_id: contaId,
      perfil_id: opcoes.perfilId !== undefined ? opcoes.perfilId : (texto(formData, 'perfilId') || null),
      nome,
      matricula,
      email,
      cargo,
      equipe_id: equipeId,
      gestor_id: texto(formData, 'gestorId') || equipe.gestor_id,
      regime: equipe.regime,
      turno,
      entrada,
      saida,
      unidade_base_id: unidadeBaseId,
      eleg_home: marcado(formData, 'elegHome'),
      eleg_externo: marcado(formData, 'elegExterno'),
      sexta_reduzida: equipe.regime === '5x2' && marcado(formData, 'sextaReduzida'),
      status,
      motivo_status: motivoStatus,
      admissao,
      desligamento: status === 'desligado' ? desligamento : null,
    },
  };
}
