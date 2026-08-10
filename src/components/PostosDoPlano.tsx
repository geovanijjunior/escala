'use client';

import type { Posto, PostoDoPlano, Unidade } from '@/lib/domain/escalas/tipos';

interface Props {
  postos: Posto[];
  unidades: Unidade[];
  atribuidos: PostoDoPlano[];
  distribuicao: Record<number, number>;
}

/**
 * Pergunta se a pessoa cobre um posto da unidade e por quantos dias.
 *
 * O posto só aparece quando a distribuição do plano manda a pessoa àquela
 * unidade — perguntar sobre o Corpo Clínico para quem tem 0% de Morumbi seria
 * oferecer uma escala impossível. Como o percentual é escolhido na mesma tela,
 * a lista reage ao vivo em vez de esperar o salvamento.
 *
 * Os dias são contíguos e começam na segunda: 5 dias é a semana inteira, 3 é
 * segunda a quarta. É como o rodízio funciona, e evita alguém ir ao posto em
 * dias soltos.
 */
export function PostosDoPlano({ postos, unidades, atribuidos, distribuicao }: Props) {
  const nomeUnidade = (id: number) => unidades.find(u => u.id === id)?.nome ?? '—';
  const ativos = postos.filter(p => p.ativo);
  const visiveis = ativos.filter(p => (distribuicao[p.unidadeId] ?? 0) > 0);

  // Sem nenhum posto cadastrado, a seção some — e quem procura o Corpo Clínico
  // fica sem saber que ele nasce em Parâmetros. Melhor dizer onde ele é criado.
  if (ativos.length === 0) {
    return (
      <section>
        <span className="esc-rotulo">Postos</span>
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Nenhum posto cadastrado. Crie um em{' '}
          <strong style={{ color: 'var(--text)' }}>Parâmetros → Unidades e capacidade → Postos dentro das unidades</strong>{' '}
          — por exemplo, Corpo Clínico dentro do Morumbi. Depois ele aparece aqui para ser atribuído.
        </p>
      </section>
    );
  }

  return (
    <section>
      <span className="esc-rotulo">Postos</span>

      {visiveis.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {ativos.map(p => p.nome).join(', ')} {ativos.length === 1 ? 'fica' : 'ficam'} dentro de{' '}
          {[...new Set(ativos.map(p => nomeUnidade(p.unidadeId)))].join(', ')}. Dê a esta pessoa algum percentual
          nessa unidade acima para poder atribuir o posto.
        </p>
      ) : (
        <div className="space-y-2">
          {visiveis.map(p => {
            const atual = atribuidos.find(a => a.postoId === p.id);
            return (
              <div
                key={p.id}
                className="rounded-md border px-3 py-2.5"
                style={{ borderColor: 'var(--line-2)' }}
              >
                <label className="flex items-center gap-2 text-[12.5px] font-medium cursor-pointer">
                  <input type="checkbox" name={`posto_${p.id}`} defaultChecked={!!atual} />
                  Fica no <strong>{p.nome}</strong>
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                    (dentro do {nomeUnidade(p.unidadeId)})
                  </span>
                </label>

                <div className="mt-2 flex flex-wrap items-end gap-3 pl-6">
                  <label className="block">
                    <span className="esc-rotulo">Dias seguidos</span>
                    <select name={`posto_dias_${p.id}`} defaultValue={atual?.dias ?? 5} className="esc-input w-44">
                      <option value={1}>1 — só segunda</option>
                      <option value={2}>2 — segunda e terça</option>
                      <option value={3}>3 — segunda a quarta</option>
                      <option value={4}>4 — segunda a quinta</option>
                      <option value={5}>5 — a semana inteira</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="esc-rotulo">Em qual semana</span>
                    <select name={`posto_semana_${p.id}`} defaultValue={atual?.semana ?? ''} className="esc-input w-48">
                      <option value="">Motor escolhe (rodízio)</option>
                      <option value={1}>1ª semana do mês</option>
                      <option value={2}>2ª semana</option>
                      <option value={3}>3ª semana</option>
                      <option value={4}>4ª semana</option>
                      <option value={5}>5ª semana</option>
                    </select>
                  </label>
                  <p className="text-[11px] flex-1 min-w-[220px]" style={{ color: 'var(--muted)' }}>
                    Sempre a partir da segunda-feira, em dias seguidos. Deixe a semana no automático para o motor
                    rodiziar o posto entre as pessoas; fixe uma quando precisar de alguém numa semana específica.
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
