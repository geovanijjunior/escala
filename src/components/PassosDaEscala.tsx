import Link from 'next/link';

export interface Passo {
  chave: string;
  numero: number;
  titulo: string;
  /** Habilitado quando a etapa já pode ser aberta; caso contrário fica apagado. */
  liberado: boolean;
  concluido: boolean;
}

/**
 * O caminho de montar a escala, do plano até a publicação.
 *
 * Antes as quatro etapas moravam em dois destinos de menu ("Planos do mês" e
 * "Gerar escala") mais o calendário, e nada na tela dizia que uma era
 * pré-requisito da outra: dava para abrir a geração antes de revisar o plano,
 * e o resultado disso era um bloqueio no meio do caminho sem explicação
 * visível. Numerar as etapas e mostrá-las juntas responde "onde eu estou" e
 * "o que falta" sem precisar ler texto nenhum.
 *
 * Etapa ainda não liberada não é link. Só o estado do mês libera cada uma —
 * gerar exige plano sem pendência, publicar exige escala gerada —, e um link
 * que leva a uma tela que vai recusar a ação é pior do que um item apagado.
 */
export function PassosDaEscala({
  passos, atual, href,
}: {
  passos: Passo[];
  atual: string;
  href: (chave: string) => string;
}) {
  return (
    <ol className="esc-card flex flex-wrap items-stretch overflow-hidden" aria-label="Etapas da escala">
      {passos.map((p, i) => {
        const aqui = p.chave === atual;
        const conteudo = (
          <>
            <span
              className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold esc-num"
              style={
                aqui
                  ? { background: 'var(--accent)', color: '#fff' }
                  : p.concluido
                    ? { background: 'var(--green-bg)', color: 'var(--green)' }
                    : { background: 'var(--bg)', color: 'var(--faint)' }
              }
            >
              {p.concluido && !aqui ? '✓' : p.numero}
            </span>
            <span
              className="text-[12.5px] leading-tight"
              style={{
                fontWeight: aqui ? 600 : 500,
                color: aqui ? 'var(--ink)' : p.liberado ? 'var(--muted)' : 'var(--faint)',
              }}
            >
              {p.titulo}
            </span>
          </>
        );

        return (
          <li
            key={p.chave}
            className="flex-1 min-w-[150px] border-r last:border-r-0"
            style={{ borderColor: 'var(--line)', background: aqui ? 'var(--brand-50)' : undefined }}
          >
            {p.liberado ? (
              <Link
                href={href(p.chave)}
                aria-current={aqui ? 'step' : undefined}
                className="flex items-center gap-2.5 px-3.5 py-3 h-full"
              >
                {conteudo}
              </Link>
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-3 h-full" aria-disabled="true">
                {conteudo}
              </div>
            )}
            {i < passos.length - 1 && <span className="sr-only">, depois</span>}
          </li>
        );
      })}
    </ol>
  );
}
