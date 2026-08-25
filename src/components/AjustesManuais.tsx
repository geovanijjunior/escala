import { DIAS_ABREV, diaSemana, diasNoMes, iso } from '@/lib/domain/escalas/datas';
import { GRUPOS_AUSENCIA, MODALIDADES } from '@/lib/domain/escalas/constantes';
import { reposicionarAlocacao } from '@/app/actions-geracao';
import { salvarAusencia } from '@/app/actions-planos';
import { Bloco } from './Ui';
import { LancarAusencia } from './LancarAusencia';
import { EscolherPessoa } from './EscolherPessoa';
import type { Colaborador, Unidade } from '@/lib/domain/escalas/tipos';

interface Props {
  competencia: string;
  ano: number;
  mes: number;
  colaboradores: Colaborador[];
  unidades: Unidade[];
  volta: string;
}

/**
 * As três coisas que se faz à mão numa escala, cada uma com o nome que se
 * procura: acrescentar alguém num dia, tirar alguém de um dia, e lançar férias
 * ou folga.
 *
 * Elas já eram possíveis — pela célula da grade, pelo painel do dia, pelo
 * editor do plano — e mesmo assim três pessoas seguidas não as acharam. O
 * motivo é sempre o mesmo: a tela oferecia "ajustar", genérico, e quem chega
 * procura o verbo que tem na cabeça. Nenhuma interface esperta compensa a
 * palavra errada.
 *
 * Aqui não há descoberta a fazer: três formulários, três títulos, e cada botão
 * faz exatamente o que o rótulo diz.
 *
 * FÉRIAS E FOLGA SÃO OUTRA COISA. Acrescentar e remover mexem na ESCALA
 * daquele dia; férias e folga criam uma AUSÊNCIA, que vale por período, entra
 * no histórico e é respeitada por todas as gerações seguintes — inclusive nos
 * meses à frente. Por isso o terceiro formulário grava em outro lugar e pede
 * um intervalo, não um dia.
 */
export function AjustesManuais({
  competencia, ano, mes, colaboradores, unidades, volta,
}: Props) {
  const nDias = diasNoMes(ano, mes);
  const pessoas = [...colaboradores].sort((a, b) => a.nome.localeCompare(b.nome));
  const ativas = unidades.filter(u => u.ativa);
  const primeiroDia = iso(ano, mes, 1);
  const ultimoDia = iso(ano, mes, nDias);

  // `id` continua no parâmetro para não mexer em quem chama, mas o campo agora
  // é o `EscolherPessoa`: com duzentos nomes, rolar a lista era o passo mais
  // lento do ajuste, e é justamente o ajuste que se faz com pressa.
  const seletorPessoa = (id: string) => (
    <label className="block" htmlFor={id}>
      <span className="esc-rotulo">Quem</span>
      <EscolherPessoa
        name="colaboradorId"
        obrigatorio
        pessoas={pessoas.map(c => ({ id: c.id, nome: c.nome, matricula: c.matricula }))}
      />
    </label>
  );

  const seletorDia = (
    <label className="block">
      <span className="esc-rotulo">Em que dia</span>
      <select name="data" defaultValue="" required className="esc-input w-full">
        <option value="" disabled>Escolha o dia</option>
        {Array.from({ length: nDias }, (_, i) => {
          const data = iso(ano, mes, i + 1);
          return (
            <option key={data} value={data}>
              {DIAS_ABREV[diaSemana(ano, mes, i + 1)]}, dia {i + 1}
            </option>
          );
        })}
      </select>
    </label>
  );

  return (
    <Bloco
      titulo="Ajustes manuais"
      desc="Cada botão faz o que o nome diz. O que muda a escala de um dia é comunicado à equipe quando você mandar; férias e folga valem por período e entram no histórico."
    >
      <div className="grid gap-0 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: 'var(--line)' }}>

        {/* ── Acrescentar alguém num dia ── */}
        <form action={reposicionarAlocacao} className="px-4 py-4 space-y-3">
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="volta" value={volta} />
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--green)' }}>Adicionar pessoa a um dia</h3>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
              Escala quem estava de folga naquele dia.
            </p>
          </div>
          {seletorPessoa('add-quem')}
          {seletorDia}
          <label className="block">
            <span className="esc-rotulo">Onde</span>
            <select name="destino" defaultValue="" required className="esc-input w-full">
              <option value="" disabled>Escolha a unidade</option>
              {ativas.map(u => <option key={u.id} value={`UNIDADE:${u.id}`}>{u.nome}</option>)}
              {(['HOME', 'EXTERNO', 'EVENTO', 'TREINA'] as const).map(m => (
                <option key={m} value={m}>{MODALIDADES[m].label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="esc-btn esc-btn-sm w-full">Adicionar à escala</button>
        </form>

        {/* ── Tirar alguém de um dia ── */}
        <form action={reposicionarAlocacao} className="px-4 py-4 space-y-3">
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="volta" value={volta} />
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--rose)' }}>Remover pessoa de um dia</h3>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
              Tira da escala só naquele dia, sem criar ausência.
            </p>
          </div>
          {seletorPessoa('rem-quem')}
          {seletorDia}
          <label className="block">
            <span className="esc-rotulo">Passa a constar como</span>
            <select name="destino" defaultValue="FOLGA" required className="esc-input w-full">
              {(['FOLGA', 'AFAST'] as const).map(m => (
                <option key={m} value={m}>{MODALIDADES[m].label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm w-full">Remover do dia</button>
        </form>

        {/* ── Férias e folga, que valem por período ── */}
        <form action={salvarAusencia} className="px-4 py-4 space-y-3">
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="volta" value={volta} />
          {/* A etapa volta junto: sem ela, a resposta cai na etapa que o estado
              do mês sugere, que numa escala publicada é a de publicar. */}
          <input type="hidden" name="etapa" value="revisar" />
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--amber)' }}>Lançar férias ou folga</h3>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
              Vale por período e o motor respeita nas próximas gerações.
            </p>
          </div>
          {seletorPessoa('aus-quem')}
          <LancarAusencia grupos={GRUPOS_AUSENCIA} primeiroDia={primeiroDia} ultimoDia={ultimoDia} />
          <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm w-full">Lançar</button>
        </form>
      </div>
    </Bloco>
  );
}
