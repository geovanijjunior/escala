import type { SupabaseClient } from '@supabase/supabase-js';
import { CARGOS, MOTIVOS_INATIVACAO } from '@/lib/domain/escalas/constantes';

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
 * de "12x36 exige ciclo" divergem no primeiro ajuste que alguém fizer só de um
 * lado, e a que ficar para trás não dá erro: aceita o cadastro errado.
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
  ciclo: 'PAR' | 'IMPAR' | null;
  entrada: string;
  jornada: number;
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
  const entrada = texto(formData, 'entrada');
  const jornada = Number(formData.get('jornada'));
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
  const cicloBruto = texto(formData, 'ciclo');

  if (!nome) return { ok: false, erro: 'Informe o nome.' };
  if (!matricula) return { ok: false, erro: 'Informe a matrícula.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erro: 'E-mail em formato inválido.' };
  if (cargo && !CARGOS.includes(cargo)) return { ok: false, erro: 'Cargo inválido.' };
  if (!equipeId) return { ok: false, erro: 'Selecione a equipe.' };
  if (!unidadeBaseId) return { ok: false, erro: 'Selecione a unidade base.' };
  if (!/^\d{2}:\d{2}$/.test(entrada)) return { ok: false, erro: 'Horário de entrada inválido.' };
  if (!(jornada > 0 && jornada <= 24)) return { ok: false, erro: 'A jornada precisa estar entre 1 e 24 horas.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissao)) return { ok: false, erro: 'Informe a data de admissão.' };
  if (!ativo && !regra) return { ok: false, erro: 'Informe o motivo da inativação.' };
  if (status === 'desligado' && !desligamento) return { ok: false, erro: 'Um colaborador desligado precisa da data de desligamento.' };
  if (desligamento && desligamento < admissao) return { ok: false, erro: 'O desligamento não pode ser anterior à admissão.' };

  // Regime e turno vêm da equipe; o turno pode ser sobreposto caso a caso.
  const { data: equipe } = await supabase
    .from('equipes').select('regime, turno, gestor_id').eq('id', equipeId).single();
  if (!equipe) return { ok: false, erro: 'Equipe não encontrada.' };

  if (equipe.regime === '12x36' && !cicloBruto) {
    return { ok: false, erro: 'Regime 12x36 exige definir o ciclo base (dias pares ou ímpares).' };
  }
  const ciclo = equipe.regime === '12x36' ? (cicloBruto === 'PAR' ? 'PAR' : 'IMPAR') : null;

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
      ciclo,
      entrada,
      jornada,
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
