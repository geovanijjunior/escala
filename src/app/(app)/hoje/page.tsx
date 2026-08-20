import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import {
  carregarContextoMes, getGeracaoAtual, listarAlocacoes, listarSolicitacoes, listarUnidades,
} from '@/lib/data/escalas';
import {
  DIAS_ABREV, diaSemana, fimDoTurno, formatarData, iso,
} from '@/lib/domain/escalas/datas';
import { TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { texto, type Busca } from '@/lib/pagina';
import { decidirSolicitacao } from '@/app/actions-solicitacoes';
import { Aviso, Bloco, Vazio, aparencia } from '@/components/Ui';
import { FormRecusa } from '@/components/FormRecusa';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_EXTENSO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * A primeira tela do colaborador: onde eu trabalho hoje.
 *
 * Existe porque "Minha escala" respondia isso em terceiro lugar. A pessoa
 * abria o app no ônibus, via o mês inteiro numa grade de 30 células e tinha de
 * achar o dia de hoje ali dentro. A pergunta que traz alguém ao app às sete da
 * manhã tem uma resposta só, e ela agora ocupa a metade de cima da tela em
 * 26px.
 *
 * O que sobra da tela responde às duas perguntas seguintes, nesta ordem: o que
 * vem pela frente, e o que está esperando por mim.
 */
export default async function HojePage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel !== 'colaborador') redirect('/');

  if (!sessao.colaboradorId) {
    return (
      <Bloco>
        <Vazio
          titulo="Seu usuário não está vinculado a um colaborador"
          desc="A escala é montada por colaborador. Peça ao Planejamento para vincular o seu login ao seu cadastro em Colaboradores."
        />
      </Bloco>
    );
  }

  const agora = new Date();
  const hoje = iso(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const competencia = iso(agora.getFullYear(), agora.getMonth(), 1);

  const [ctx, geracao, unidades, solicitacoes] = await Promise.all([
    carregarContextoMes(competencia, sessao.conta.id),
    getGeracaoAtual(competencia),
    listarUnidades(),
    listarSolicitacoes(),
  ]);

  const eu = ctx.colaboradores.find(c => c.id === sessao.colaboradorId);
  const alocacoes = geracao ? await listarAlocacoes(geracao.id) : [];
  const minhas = alocacoes
    .filter(a => a.colaboradorId === sessao.colaboradorId)
    .sort((a, b) => a.data.localeCompare(b.data));

  const postoPorId = new Map(ctx.postos.map(p => [p.id, p]));
  const equipe = ctx.equipes.find(e => e.id === eu?.equipeId);

  const faixaDe = (dow: number) => {
    if (!eu) return '';
    return `${eu.entrada}–${fimDoTurno(eu.saida, eu.sextaReduzida, dow)}`;
  };

  const doDia = minhas.find(a => a.data === hoje);
  const proximos = minhas.filter(a => a.data > hoje && a.modalidade !== 'DESCANSO').slice(0, 4);

  // Só o que exige resposta desta pessoa. Um pedido dela mesma esperando o
  // gestor não "espera por ela" — mostrar tudo aqui devolveria a lista
  // completa de solicitações, que é a outra aba.
  const esperando = solicitacoes.filter(
    s => s.status === 'AGUARDA_PARCEIRO' && s.parceiroId === sessao.colaboradorId,
  );

  const ap = doDia ? aparencia(doDia.modalidade, doDia.unidadeId, unidades) : null;
  const dowHoje = diaSemana(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const ausenteHoje = doDia ? ['FERIAS', 'FOLGA', 'AFAST', 'FERIADO', 'DESCANSO'].includes(doDia.modalidade) : false;
  const postoHoje = doDia?.postoId ? postoPorId.get(doDia.postoId)?.nome : null;

  return (
    <>
      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <section className="space-y-2">
        <h2 className="esc-rotulo" style={{ letterSpacing: '.15em' }}>Agora</h2>

        {!geracao || !doDia ? (
          <div className="esc-card px-4 py-5">
            <p className="text-[13px] font-semibold">
              {DIAS_EXTENSO[dowHoje]}, {agora.getDate()} de {MESES[agora.getMonth()]}
            </p>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>
              {geracao
                ? 'Você não está escalado hoje.'
                : 'A escala deste mês ainda não foi publicada.'}
            </p>
          </div>
        ) : (
          <div className="rounded-[16px] overflow-hidden" style={{ background: ap!.bg }}>
            <div className="px-4 pt-4 pb-3.5">
              <div className="flex items-start justify-between gap-2">
                <p
                  className="text-[11.5px] font-semibold uppercase"
                  style={{ letterSpacing: '.1em', color: ap!.cor, opacity: .75 }}
                >
                  Hoje · {DIAS_ABREV[dowHoje]}, {agora.getDate()} {MESES[agora.getMonth()].slice(0, 3)}
                </p>
                {doDia.travado && (
                  <span
                    className="esc-badge shrink-0"
                    style={{ background: 'rgba(255,255,255,.65)', color: ap!.cor }}
                  >
                    ajustado
                  </span>
                )}
              </div>

              <p
                className="mt-1.5 font-bold leading-none"
                style={{ fontSize: 26, letterSpacing: '-.03em', color: ap!.cor }}
              >
                {ap!.label}
              </p>
              {postoHoje && (
                <p className="text-[12.5px] font-semibold mt-1.5" style={{ color: ap!.cor, opacity: .85 }}>
                  {postoHoje}
                </p>
              )}
            </div>

            {!ausenteHoje && (
              <div
                className="grid grid-cols-2 border-t"
                style={{ background: 'rgba(255,255,255,.55)', borderColor: 'rgba(255,255,255,.7)' }}
              >
                <div className="px-4 py-2.5" style={{ borderRight: '1px solid var(--line-soft)' }}>
                  <div className="esc-rotulo mb-0.5">Jornada</div>
                  <div className="text-[13.5px] font-semibold esc-num">{faixaDe(dowHoje)}</div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="esc-rotulo mb-0.5">Equipe</div>
                  <div className="text-[13.5px] font-semibold truncate">{equipe?.nome ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {proximos.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="esc-rotulo" style={{ letterSpacing: '.15em' }}>Próximos dias</h2>
            <Link href="/minha-escala" className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
              Ver o mês
            </Link>
          </div>

          <div className="esc-card divide-y" style={{ borderColor: 'var(--line-soft)' }}>
            {proximos.map(a => {
              const cor = aparencia(a.modalidade, a.unidadeId, unidades);
              const dia = Number(a.data.slice(8));
              const dow = diaSemana(Number(a.data.slice(0, 4)), Number(a.data.slice(5, 7)) - 1, dia);
              const posto = a.postoId ? postoPorId.get(a.postoId)?.nome : null;
              const fora = ['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade);
              return (
                <div key={a.data} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="w-[38px] shrink-0 text-center">
                    <div
                      className="text-[9.5px] font-semibold uppercase"
                      style={{ color: 'var(--faint)' }}
                    >
                      {DIAS_ABREV[dow]}
                    </div>
                    <div className="text-[17px] font-semibold esc-num leading-none">{dia}</div>
                  </div>
                  <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: cor.cor }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold truncate">{cor.label}</div>
                    <div className="text-[11.5px] truncate" style={{ color: 'var(--accent)' }}>
                      {[posto, fora ? null : faixaDe(dow)].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <span className="esc-badge shrink-0" style={{ background: cor.bg, color: cor.cor }}>
                    {cor.sigla}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {esperando.length > 0 && (
        <section className="space-y-2">
          <h2 className="esc-rotulo" style={{ letterSpacing: '.15em' }}>Esperando você</h2>
          {esperando.map(s => (
            <div
              key={s.id}
              className="rounded-[14px] px-4 py-3.5 space-y-2.5"
              style={{ background: 'var(--surface)', border: '1px solid #F0DFB8' }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">
                  {TIPOS_SOLICITACAO[s.tipo].label} · {formatarData(s.data)}
                </span>
                <span className="text-[11.5px] font-semibold esc-num shrink-0" style={{ color: 'var(--amber)' }}>
                  SLA {TIPOS_SOLICITACAO[s.tipo].sla}h
                </span>
              </div>
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {s.colaboradorNome} quer trocar com você. {s.detalhe}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <form action={decidirSolicitacao}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="acao" value="ACEITAR_PARCEIRO" />
                  <input type="hidden" name="volta" value="/hoje" />
                  <button type="submit" className="esc-btn w-full" style={{ minHeight: 44, background: 'var(--brand-900)' }}>
                    Aceitar
                  </button>
                </form>
                <FormRecusa volta="/hoje" id={s.id} acao="RECUSAR_PARCEIRO" rotulo="Recusar" />
              </div>
            </div>
          ))}
        </section>
      )}

      <Link
        href="/solicitacoes"
        className="esc-btn w-full"
        style={{ minHeight: 48, background: 'var(--accent)', borderRadius: 13, boxShadow: 'var(--sombra-acao)' }}
      >
        Abrir solicitação
      </Link>
    </>
  );
}
