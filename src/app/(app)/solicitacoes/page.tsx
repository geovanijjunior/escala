import Link from 'next/link';
import { getSessao, podeAprovar } from '@/lib/sessao';
import { listarSolicitacoes, listarUnidades, listarColaboradores } from '@/lib/data/escalas';
import { formatarData } from '@/lib/domain/escalas/datas';
import { STATUS_ABERTOS, STATUS_SOLICITACAO, TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { comFiltros, texto, type Busca } from '@/lib/pagina';
import { decidirSolicitacao } from '@/app/actions-solicitacoes';
import { Abas, Aviso, Badge, Bloco, Pill, Vazio } from '@/components/Ui';
import { FormRecusa } from '@/components/FormRecusa';
import type { Solicitacao } from '@/lib/data/escalas';

const ROTULO_ABA = { abertas: 'Abertas', fila: 'Lista de espera', historico: 'Histórico' };

export default async function SolicitacoesPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();

  const [todas, unidades, colaboradores] = await Promise.all([
    listarSolicitacoes(),
    listarUnidades(),
    listarColaboradores(),
  ]);

  const unidadePorId = new Map(unidades.map(u => [u.id, u]));
  const colabPorId = new Map(colaboradores.map(c => [c.id, c]));

  const aba = texto(busca, 'aba') || 'abertas';
  const abertas = todas.filter(s => STATUS_ABERTOS.includes(s.status) && s.status !== 'FILA');
  const fila = todas.filter(s => s.status === 'FILA').sort((a, b) => (a.posicaoFila ?? 99) - (b.posicaoFila ?? 99));
  const historico = todas.filter(s => s.status === 'APROVADA' || s.status === 'RECUSADA');
  const lista = aba === 'fila' ? fila : aba === 'historico' ? historico : abertas;

  const titulo =
    sessao.papel === 'planejamento' ? 'Solicitações'
    : sessao.papel === 'gestor' ? 'Aprovações da equipe'
    : 'Minhas solicitações';

  const subtitulo =
    sessao.papel === 'planejamento' ? 'Triagem, encaminhamento ao gestor e lista de espera.'
    : sessao.papel === 'gestor' ? 'Pedidos da sua equipe que chegaram para decisão.'
    : 'Seus pedidos e as trocas em que você foi convidado.';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">{titulo}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>{subtitulo}</p>
        </div>
        {sessao.papel === 'colaborador' && (
          <Link href="/minha-escala" className="esc-btn esc-btn-sm">Abrir nova solicitação</Link>
        )}
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <Abas
        ativa={aba}
        itens={(['abertas', 'fila', 'historico'] as const).map(k => ({
          chave: k,
          label: ROTULO_ABA[k],
          href: `/solicitacoes${comFiltros(busca, { aba: k })}`,
          extra: k === 'abertas' ? abertas.length : k === 'fila' ? fila.length : historico.length,
        }))}
      />

      {aba === 'fila' && fila.length > 0 && (
        <Bloco
          titulo="Ordem da lista de espera"
          desc="Quando uma posição é liberada, o primeiro da fila é o próximo a ser promovido para decisão do gestor."
        >
          <ol className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {fila.map((s, i) => (
              <li key={s.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                <span
                  className="w-7 h-7 rounded-full grid place-items-center text-[11.5px] font-semibold esc-num shrink-0"
                  style={
                    i === 0
                      ? { background: 'var(--green-bg)', color: 'var(--green)' }
                      : { background: 'var(--bg)', color: 'var(--muted)' }
                  }
                >
                  {s.posicaoFila ?? i + 1}º
                </span>
                <span className="text-[12.5px] font-medium">{s.colaboradorNome}</span>
                <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {TIPOS_SOLICITACAO[s.tipo].label} · {formatarData(s.data)}
                </span>
                {sessao.papel === 'planejamento' && (
                  <form action={decidirSolicitacao} className="ml-auto">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="acao" value="PROMOVER" />
                    <button type="submit" className={`esc-btn esc-btn-sm ${i === 0 ? 'esc-btn-sucesso' : 'esc-btn-outline'}`}>
                      Promover
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ol>
        </Bloco>
      )}

      {lista.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Nada por aqui"
            desc={
              aba === 'abertas'
                ? 'Não há solicitações aguardando decisão neste momento.'
                : aba === 'fila'
                ? 'A lista de espera está vazia.'
                : 'Nenhuma solicitação foi concluída ainda.'
            }
          />
        </Bloco>
      ) : (
        <div className="space-y-3">
          {lista.map(s => (
            <Cartao
              key={s.id}
              s={s}
              papel={sessao.papel}
              souParceiro={s.parceiroId === sessao.colaboradorId}
              unidadeNome={s.unidadeDesejadaId ? unidadePorId.get(s.unidadeDesejadaId)?.nome ?? null : null}
              equipeNome={colabPorId.get(s.colaboradorId)?.cargo ?? ''}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Cartao({
  s, papel, souParceiro, unidadeNome, equipeNome,
}: { s: Solicitacao; papel: string; souParceiro: boolean; unidadeNome: string | null; equipeNome: string }) {
  const cfg = STATUS_SOLICITACAO[s.status];
  const tipo = TIPOS_SOLICITACAO[s.tipo];
  const aprovador = podeAprovar(papel as 'planejamento' | 'gestor' | 'colaborador');

  return (
    <Bloco
      titulo={`${tipo.label} · ${formatarData(s.data)}`}
      desc={`${s.colaboradorNome}${equipeNome ? ` · ${equipeNome}` : ''} · aberta em ${formatarData(s.criadoEm.slice(0, 10))} · SLA de ${tipo.sla}h`}
      acoes={
        <>
          {s.posicaoFila && <Badge cor="var(--brand-700)" bg="var(--brand-100)">{s.posicaoFila}º na fila</Badge>}
          {souParceiro && s.status === 'AGUARDA_PARCEIRO' && (
            <Badge cor="var(--amber)" bg="var(--amber-bg)">Aguarda sua resposta</Badge>
          )}
          {s.aplicada && <Badge cor="var(--green)" bg="var(--green-bg)">Aplicada na escala</Badge>}
          <Pill cor={cfg.cor} bg={cfg.bg}>{cfg.label}</Pill>
        </>
      }
    >
      <div className="px-4 py-3 space-y-3">
        <p className="text-[12.5px] leading-relaxed">{s.detalhe}</p>

        {s.parceiroNome && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Troca com <strong className="font-semibold">{s.parceiroNome}</strong>
            {s.aceiteParceiro && ` · resposta do parceiro: ${s.aceiteParceiro.toLowerCase()}`}
          </p>
        )}
        {unidadeNome && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Unidade desejada: <strong className="font-semibold">{unidadeNome}</strong>
          </p>
        )}

        {s.motivoRecusa && (
          <div className="rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}>
            <strong className="font-semibold">Motivo da recusa:</strong> {s.motivoRecusa}
          </div>
        )}

        <details className="text-[12px]">
          <summary className="cursor-pointer font-semibold" style={{ color: 'var(--brand-700)' }}>
            Histórico ({s.eventos.length})
          </summary>
          <ol className="mt-2 border-l pl-4 space-y-2" style={{ borderColor: 'var(--line-2)' }}>
            {s.eventos.map((e, i) => (
              <li key={i} className="relative">
                <span
                  className="absolute -left-[21px] top-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--brand-600)' }}
                />
                <div className="font-medium">{e.etapa}</div>
                <div style={{ color: 'var(--muted)' }}>
                  {e.porNome} · {new Date(e.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
                {e.detalhe && <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{e.detalhe}</div>}
              </li>
            ))}
          </ol>
        </details>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {souParceiro && s.status === 'AGUARDA_PARCEIRO' && (
            <>
              <form action={decidirSolicitacao}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="ACEITAR_PARCEIRO" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Aceitar a troca</button>
              </form>
              <FormRecusa id={s.id} acao="RECUSAR_PARCEIRO" rotulo="Recusar a troca" />
            </>
          )}

          {papel === 'planejamento' && s.status === 'TRIAGEM' && (
            <>
              <form action={decidirSolicitacao}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="ENCAMINHAR" />
                <button type="submit" className="esc-btn esc-btn-sm">Encaminhar ao gestor</button>
              </form>
              {tipo.fila && (
                <form action={decidirSolicitacao}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="acao" value="FILA" />
                  <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Enviar para a lista de espera</button>
                </form>
              )}
              <FormRecusa id={s.id} acao="RECUSAR_TRIAGEM" rotulo="Recusar na triagem" />
            </>
          )}

          {aprovador && s.status === 'GESTOR' && (
            <>
              <form action={decidirSolicitacao}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="APROVAR" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Aprovar</button>
              </form>
              <FormRecusa id={s.id} acao="RECUSAR_GESTOR" rotulo="Recusar" />
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {['TROCA_UNIDADE', 'TROCA_HORARIO', 'FOLGA', 'FERIAS'].includes(s.tipo)
                  ? 'Aprovar já altera a escala do dia e trava a alocação.'
                  : 'Este tipo não altera a escala — a aprovação vale como registro formal.'}
              </span>
            </>
          )}
        </div>
      </div>
    </Bloco>
  );
}
