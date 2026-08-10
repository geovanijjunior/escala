'use client';

import { useEffect, useState } from 'react';
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
  const [pct, setPct] = useState<Record<number, number>>(distribuicao);

  // A distribuição vive noutro componente do mesmo formulário; ler os campos
  // direto do form é o que mantém os dois em sincronia sem elevar o estado.
  useEffect(() => {
    const form = document.querySelector('form') as HTMLFormElement | null;
    if (!form) return;
    const ler = () => {
      const atual: Record<number, number> = {};
      for (const u of unidades) {
        const campo = form.elements.namedItem(`dist_${u.id}`) as HTMLInputElement | null;
        atual[u.id] = campo ? Number(campo.value) || 0 : 0;
      }
      setPct(atual);
    };
    ler();
    form.addEventListener('change', ler);
    return () => form.removeEventListener('change', ler);
  }, [unidades]);

  const nomeUnidade = (id: number) => unidades.find(u => u.id === id)?.nome ?? '—';
  const visiveis = postos.filter(p => p.ativo && (pct[p.unidadeId] ?? 0) > 0);

  if (postos.filter(p => p.ativo).length === 0) return null;

  return (
    <section>
      <span className="esc-rotulo">Postos</span>

      {visiveis.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Os postos aparecem aqui quando a distribuição acima mandar esta pessoa a uma unidade que tenha posto.
          Hoje nenhuma das unidades com posto tem percentual para ela.
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
