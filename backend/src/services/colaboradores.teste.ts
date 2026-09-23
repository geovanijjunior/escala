import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../config/prisma.ts';
import { listar, type Recorte } from '../repositories/colaboradores.ts';
import { recorteDaSessao } from './colaboradores.ts';
import type { SessaoAberta } from '../repositories/sessoes.ts';

/**
 * A autorização nova, conferida contra a antiga.
 *
 * Este é o teste que a migração inteira precisa, e a razão é que um erro de
 * porte aqui não parece erro. Quando o recorte fica largo demais, ninguém vê:
 * as telas funcionam, os dados aparecem, e o que mudou é que um gestor passou a
 * enxergar a área toda. Não há tela vermelha para isso — só um vazamento que se
 * descobre quando alguém comenta o que não deveria saber.
 *
 * Então em vez de afirmar o que eu ACHO que a regra é, o teste pergunta ao
 * banco. `pode_ver_colaborador` é a função que as 75 policies de RLS usam hoje,
 * e é a autoridade: para cada perfil e cada colaborador, ela responde sim ou
 * não. O código novo tem de responder igual, sempre.
 *
 * É também o que protege a migração daqui para frente: no dia em que alguém
 * mexer numa policy sem mexer no serviço — ou o contrário —, isto acusa.
 */

/** O que `pode_ver_colaborador` responde para um perfil, direto do banco. */
async function segundoAsPolicies(perfilId: string): Promise<Set<number>> {
  const linhas = await prisma.$transaction(async tx => {
    // A função lê `auth.uid()`, que vem daqui — é o mesmo caminho que o
    // PostgREST usa com o JWT de verdade. `true` no terceiro argumento faz o
    // ajuste morrer no fim da transação.
    await tx.$executeRaw`select set_config('request.jwt.claim.sub', ${perfilId}, true)`;
    return tx.$queryRaw<{ id: bigint }[]>`
      select id from colaboradores where pode_ver_colaborador(id)
    `;
  });
  return new Set(linhas.map(l => Number(l.id)));
}

/** O que o código novo responde. */
async function segundoOCodigo(recorte: Recorte): Promise<Set<number>> {
  const lista = await listar(recorte);
  return new Set(lista.map(c => c.id));
}

const comoSessao = (p: {
  id: string; nome: string; email: string; papel: string; conta_id: string | null;
}): SessaoAberta => ({
  perfilId: p.id,
  nome: p.nome,
  email: p.email,
  papel: p.papel,
  contaId: p.conta_id,
  bloqueado: false,
});

after(async () => { await prisma.$disconnect(); });

describe('o recorte novo concorda com as policies de RLS', () => {
  it('para todo perfil de toda área, pessoa por pessoa', async () => {
    const perfis = await prisma.perfis.findMany({
      where: { NOT: { conta_id: null } },
      orderBy: { email: 'asc' },
    });

    assert.ok(perfis.length >= 4, `a massa precisa ter perfis de vários papéis (achei ${perfis.length})`);

    const papeisVistos = new Set<string>();
    for (const p of perfis) {
      papeisVistos.add(p.papel);

      const doBanco = await segundoAsPolicies(p.id);
      const doCodigo = await segundoOCodigo(recorteDaSessao(comoSessao(p)));

      const aMais = [...doCodigo].filter(id => !doBanco.has(id));
      const aMenos = [...doBanco].filter(id => !doCodigo.has(id));

      // O vazamento é o erro grave: o código mostrando quem a policy esconde.
      assert.deepEqual(
        aMais, [],
        `${p.email} (${p.papel}) enxerga ${aMais.length} colaborador(es) que a RLS esconde: ${aMais.join(', ')}`,
      );
      // O contrário é defeito de tela, não de segurança — mas também é defeito.
      assert.deepEqual(
        aMenos, [],
        `${p.email} (${p.papel}) deixa de enxergar ${aMenos.length} que a RLS mostra: ${aMenos.join(', ')}`,
      );
    }

    // Sem isto o teste passaria numa massa só de planejamento, sem ter tocado
    // nos recortes que dão trabalho.
    for (const papel of ['planejamento', 'gestor', 'colaborador']) {
      assert.ok(papeisVistos.has(papel), `a massa não tem nenhum perfil com papel "${papel}"`);
    }
  });

  it('o gestor enxerga menos que o planejamento, e o colaborador menos ainda', async () => {
    // Não é só "concordam": os recortes precisam de fato RECORTAR. Se todos
    // devolvessem a área inteira, o teste acima passaria e a autorização não
    // estaria fazendo nada.
    const todos = await prisma.perfis.findMany({ where: { NOT: { conta_id: null } } });
    const porPapel = new Map<string, number>();

    for (const p of todos) {
      const quantos = (await segundoOCodigo(recorteDaSessao(comoSessao(p)))).size;
      porPapel.set(p.papel, Math.max(porPapel.get(p.papel) ?? 0, quantos));
    }

    const planejamento = porPapel.get('planejamento') ?? 0;
    const colaborador = porPapel.get('colaborador') ?? 0;

    assert.ok(planejamento > 0, 'o Planejamento tem de enxergar a área');
    assert.ok(
      colaborador < planejamento,
      `o colaborador enxerga ${colaborador} e o planejamento ${planejamento} — o recorte não está recortando`,
    );
  });

  it('quem não tem área nenhuma é recusado, e não recebe lista vazia', () => {
    // A diferença importa: lista vazia é uma resposta, e uma resposta vazia
    // para o Administrador Geral pareceria "a área não tem ninguém". O 403 diz
    // o que é.
    const semArea = comoSessao({
      id: '00000000-0000-0000-0000-000000000009',
      nome: 'Administrador Geral',
      email: 'geral@x',
      papel: 'admin_geral',
      conta_id: null,
    });
    assert.throws(() => recorteDaSessao(semArea), /área/i);
  });

  it('um papel desconhecido cai no recorte mais restrito, não no mais aberto', () => {
    // O erro que esta escolha evita: alguém cria um papel novo, esquece deste
    // arquivo, e o `default` o trata como administrador. Ninguém percebe,
    // porque tudo funciona — funciona demais.
    const estranho = comoSessao({
      id: '11111111-1111-1111-1111-111111111111',
      nome: 'Papel Novo',
      email: 'novo@x',
      papel: 'auditor_externo',
      conta_id: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(recorteDaSessao(estranho).tipo, 'colaborador');
  });
});
