import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessao } from '@/lib/sessao';
import {
  listarSolicitacoes, listarUnidades, listarColaboradores, listarAusenciasSobrepostas,
} from '@/lib/data/escalas';
import { formatarData } from '@/lib/domain/escalas/datas';
import {
  OPCOES_FERIAS, STATUS_ABERTOS, STATUS_SOLICITACAO, TIPOS_COM_EFEITO_NA_ESCALA, TIPOS_SOLICITACAO,
} from '@/lib/domain/escalas/constantes';
import { comFiltros, texto, type Busca } from '@/lib/pagina';
import { Volta } from '@/components/Volta';
import { valorVolta } from '@/lib/volta';
import { abrirSolicitacao, decidirSolicitacao } from '@/app/actions-solicitacoes';
import { Abas, Aviso, Badge, Bloco, Pill, Vazio } from '@/components/Ui';
import { FormRecusa } from '@/components/FormRecusa';
import { NovaSolicitacao } from '@/components/NovaSolicitacao';
import type { AusenciaSobreposta, Solicitacao } from '@/lib/data/escalas';

const ROTULO_ABA = { abertas: 'Abertas', fila: 'Lista de espera', historico: 'Histórico' };

export default async function SolicitacoesPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  // O Administrador da Área cuida de cadastro, não de escala. As telas de
  // operação ficam fora do alcance dele mesmo quando a RLS deixaria ler.
  if (sessao.papel === 'admin_local') redirect('/');

  const [todas, unidades, colaboradores] = await Promise.all([
    listarSolicitacoes(),
    listarUnidades(),
    listarColaboradores(),
  ]);

  const unidadePorId = new Map(unidades.map(u => [u.id, u]));
  const colabPorId = new Map(colaboradores.map(c => [c.id, c]));

  const aba = texto(busca, 'aba') || 'abertas';
  const abrindo = sessao.papel === 'planejamento' && texto(busca, 'abrir') === '1';
  const abertas = todas.filter(s => STATUS_ABERTOS.includes(s.status) && s.status !== 'FILA');
  const fila = todas.filter(s => s.status === 'FILA').sort((a, b) => (a.posicaoFila ?? 99) - (b.posicaoFila ?? 99));
  const historico = todas.filter(s => s.status === 'APROVADA' || s.status === 'RECUSADA');
  const lista = aba === 'fila' ? fila : aba === 'historico' ? historico : abertas;

  // Férias esperando o gestor: quem mais da equipe já está fora naquelas
  // semanas. Só para os cartões que ele pode decidir agora — carregar para o
  // histórico inteiro seria uma consulta por cartão sem ninguém para usar.
  const paraDecidir = sessao.papel === 'gestor'
    ? lista.filter(s => s.tipo === 'FERIAS' && s.status === 'GESTOR')
    : [];
  const sobreposicoes = new Map(await Promise.all(paraDecidir.map(async s =>
    [s.id, await listarAusenciasSobrepostas(s.data, s.dataFim || s.data, s.colaboradorId)] as const,
  )));

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
        {/* O botão fica no cabeçalho, e não dentro de um bloco lá embaixo:
            abrir um pedido em nome de alguém é a segunda coisa que se faz nesta
            tela, depois de triar o que já chegou. */}
        {sessao.papel === 'planejamento' && (
          <Link
            href={`/solicitacoes${comFiltros(busca, { abrir: abrindo ? null : '1' })}${abrindo ? '' : '#abrir'}`}
            className={`esc-btn esc-btn-sm${abrindo ? ' esc-btn-ghost' : ''}`}
          >
            {abrindo ? 'Fechar' : 'Abrir solicitação para um colaborador'}
          </Link>
        )}
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      {/* O Planejamento abre PELA pessoa.
          Boa parte das férias e das ausências não nasce de um pedido: nasce de
          uma combinação em reunião ou de um telefonema. Antes só havia dois
          jeitos de registrar isso — pedir que a pessoa abrisse o pedido que já
          estava combinado, ou lançar a ausência à mão no plano, sem decisão de
          gestor por trás. O pedido aberto aqui pula a triagem (quem triaria é
          quem abriu), vai direto ao gestor e volta para implantação. */}
      {abrindo && (
        <div id="abrir" className="scroll-mt-16">
          <Bloco
            titulo="Abrir solicitação para um colaborador"
            desc="Vai direto ao gestor da equipe da pessoa. Aprovado, volta para você implantar na escala e confirmar."
            acoes={
              <Link href={`/solicitacoes${comFiltros(busca, { abrir: null })}`} className="esc-btn esc-btn-ghost esc-btn-sm">
                Fechar
              </Link>
            }
          >
            <form action={abrirSolicitacao} className="px-4 py-4">
              <input type="hidden" name="volta" value="/solicitacoes" />
              <NovaSolicitacao
                unidades={unidades.filter(u => u.ativa).map(u => ({ id: u.id, nome: u.nome }))}
                tipos={Object.entries(TIPOS_SOLICITACAO).map(([k, v]) => ({ chave: k, label: v.label, sla: v.sla }))}
                // Troca de plantão aberta daqui vai sem par nomeado: o par
                // depende da equipe de quem foi escolhido acima, que só se sabe
                // depois da escolha. Quem já combinou a troca dos dois lados
                // abre pelo colaborador, que enxerga a própria equipe.
                colegas={[]}
                // A matrícula vai junto porque o campo é digitável: ela
                // desempata homônimos e é o que muita gente tem na ponta da
                // língua ao abrir um pedido em nome de outra pessoa.
                pessoas={colaboradores
                  .filter(c => c.status === 'ativo')
                  .map(c => ({ id: c.id, nome: c.nome, matricula: c.matricula }))}
              />
            </form>
          </Bloco>
        </div>
      )}

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
                  {TIPOS_SOLICITACAO[s.tipo].label} ·{' '}
                  {s.dataFim && s.dataFim !== s.data
                    ? `${formatarData(s.data)} a ${formatarData(s.dataFim)}`
                    : formatarData(s.data)}
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
              sobrepostas={sobreposicoes.get(s.id) ?? []}
              busca={busca}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Cartao({
  s, papel, souParceiro, unidadeNome, equipeNome, sobrepostas, busca,
}: {
  s: Solicitacao; papel: string; souParceiro: boolean;
  unidadeNome: string | null; equipeNome: string;
  sobrepostas: AusenciaSobreposta[]; busca: Busca;
}) {
  const cfg = STATUS_SOLICITACAO[s.status];
  const tipo = TIPOS_SOLICITACAO[s.tipo];
  const opcao = s.opcaoFerias ? OPCOES_FERIAS.find(o => o.chave === s.opcaoFerias) : null;
  const mexeNaEscala = TIPOS_COM_EFEITO_NA_ESCALA.includes(s.tipo);

  return (
    <Bloco
      titulo={`${tipo.label} · ${s.dataFim && s.dataFim !== s.data
        ? `${formatarData(s.data)} a ${formatarData(s.dataFim)}`
        : formatarData(s.data)}`}
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
        {s.motivo && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Motivo: <strong className="font-semibold">{s.motivo}</strong>
          </p>
        )}
        {/* Quem faz a triagem precisa da combinação escolhida e do abono para
            conferir contra o que o RH vai lançar — sem isso, só o intervalo de
            datas chega, e 20 dias podem ser 20+10 de abono ou 20 secos. */}
        {opcao && (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Opção de férias: <strong className="font-semibold">{opcao.label}</strong>
            {' · '}
            {s.lancadoFiori
              ? <span style={{ color: 'var(--green)' }}>já lançada no Fiori</span>
              : <span style={{ color: 'var(--amber)' }}>ainda não lançada no Fiori</span>}
          </p>
        )}

        {s.motivoRecusa && (
          <div className="rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}>
            <strong className="font-semibold">Motivo da recusa:</strong> {s.motivoRecusa}
          </div>
        )}

        {/* Só aparece quando há decisão a tomar. Um pedido de férias sem saber
            quem mais está fora naquelas semanas é meia informação, e a outra
            metade estava a três telas de distância. */}
        {papel === 'gestor' && s.status === 'GESTOR' && s.tipo === 'FERIAS' && (
          <div
            className="rounded-md px-3 py-2.5 text-[12px]"
            style={{
              background: sobrepostas.length ? 'var(--amber-bg)' : 'var(--green-bg)',
              color: sobrepostas.length ? 'var(--amber)' : 'var(--green)',
            }}
          >
            {sobrepostas.length === 0 ? (
              <>
                <strong className="font-semibold">Ninguém mais da equipe está fora</strong> nesse período.
              </>
            ) : (
              <>
                <strong className="font-semibold">
                  {sobrepostas.length} pessoa(s) da equipe já estão fora nesse período:
                </strong>
                <ul className="mt-1.5 space-y-1">
                  {sobrepostas.map(a => (
                    <li key={`${a.colaboradorId}-${a.inicio}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{a.nome}</span>
                      <span className="esc-num">{formatarData(a.inicio)} a {formatarData(a.fim)}</span>
                      <span>{a.tipo === 'FERIAS' ? 'férias' : 'ausência'}{a.motivo ? ` · ${a.motivo}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
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
                <Volta busca={busca} />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="ACEITAR_PARCEIRO" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Aceitar a troca</button>
              </form>
              <FormRecusa volta={valorVolta(busca)} id={s.id} acao="RECUSAR_PARCEIRO" rotulo="Recusar a troca" />
            </>
          )}

          {papel === 'planejamento' && s.status === 'TRIAGEM' && (
            <>
              <form action={decidirSolicitacao}>
                <Volta busca={busca} />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="ENCAMINHAR" />
                <button type="submit" className="esc-btn esc-btn-sm">Encaminhar ao gestor</button>
              </form>
              {/* Aprovar direto: nem todo pedido precisa da decisão do gestor, e
                  encaminhar o que já está resolvido só atrasa a resposta. */}
              <form action={decidirSolicitacao}>
                <Volta busca={busca} />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="APROVAR_TRIAGEM" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Aprovar direto</button>
              </form>
              {tipo.fila && (
                <form action={decidirSolicitacao}>
                <Volta busca={busca} />
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="acao" value="FILA" />
                  <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Enviar para a lista de espera</button>
                </form>
              )}
              <FormRecusa volta={valorVolta(busca)} id={s.id} acao="RECUSAR_TRIAGEM" rotulo="Recusar na triagem" />
              <span className="text-[11px] w-full" style={{ color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--text)' }}>Aprovar direto</strong> encerra o pedido sem passar pelo gestor
                {mexeNaEscala
                  ? ' e já altera a escala do dia, travando a alocação.'
                  : '. Este tipo não altera a escala — vale como registro formal.'}
              </span>
            </>
          )}

          {/* Depois de encaminhado, quem decide é o gestor. O Planejamento
              acompanha o cartão, mas não tem botão: encaminhar é delegar, e
              delegar com o botão ainda na mão de quem delegou não delega nada. */}
          {papel === 'gestor' && s.status === 'GESTOR' && (
            <>
              <form action={decidirSolicitacao}>
                <Volta busca={busca} />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="APROVAR" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Aprovar</button>
              </form>
              {tipo.fila && (
                <form action={decidirSolicitacao}>
                  <Volta busca={busca} />
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="acao" value="FILA_GESTOR" />
                  <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Enviar para a lista de espera</button>
                </form>
              )}
              <FormRecusa volta={valorVolta(busca)} id={s.id} acao="RECUSAR_GESTOR" rotulo="Recusar" />
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {mexeNaEscala
                  ? 'Aprovar registra a sua decisão; a escala não muda neste momento. O pedido volta ao Planejamento, que lança os dias e confirma.'
                  : 'Este tipo não altera a escala — a aprovação encerra o pedido como registro formal.'}
                {tipo.fila && ' A lista de espera guarda o pedido na ordem de chegada, em vez de descartá-lo.'}
              </span>
            </>
          )}

          {papel === 'planejamento' && s.status === 'GESTOR' && (
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {s.abertaPeloPlanejamento
                ? 'Aberta por você e enviada ao gestor da equipe. Aprovada, ela volta para cá com "A implantar".'
                : 'Encaminhada — a decisão agora é do gestor da equipe.'}
            </span>
          )}

          {/* A volta do pedido que o Planejamento abriu.
              O gestor já decidiu; o que falta é o trabalho de lançar na escala.
              Confirmar é o que aplica o efeito — grava a ausência e trava os
              dias —, e não a aprovação do gestor: aplicar antes faria o pedido
              aparecer como "a implantar" com a implantação já feita. */}
          {papel === 'planejamento' && s.status === 'IMPLANTAR' && (
            <>
              <form action={decidirSolicitacao}>
                <Volta busca={busca} />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="acao" value="CONFIRMAR_IMPLANTACAO" />
                <button type="submit" className="esc-btn esc-btn-sucesso esc-btn-sm">Confirmar implantação</button>
              </form>
              <Link
                href={`/calendario?competencia=${s.data.slice(0, 8)}01&dia=${s.data}`}
                className="esc-btn esc-btn-outline esc-btn-sm"
              >
                Ver o dia no calendário
              </Link>
              <span className="text-[11px] w-full" style={{ color: 'var(--muted)' }}>
                Aprovada pelo gestor. Confirmar
                {mexeNaEscala
                  ? ' lança o período na escala e trava os dias, inclusive numa escala já publicada.'
                  : ' encerra o pedido — este tipo não altera a escala.'}
              </span>
            </>
          )}
        </div>
      </div>
    </Bloco>
  );
}
