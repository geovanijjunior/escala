'use client';

import { useState } from 'react';
import { convidarUsuario } from '@/app/actions-usuarios';
import { REGIMES, TURNOS, TURNOS_EM_ORDEM } from '@/lib/domain/escalas/constantes';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

// Sem `regime`: ele saiu da equipe na 0031 e passou a ser da pessoa.
export interface OpcaoEquipe { id: number; nome: string }
export interface OpcaoUnidade { id: number; nome: string }

/**
 * Criar o acesso e, quando o papel é colaborador, o cadastro da escala junto.
 *
 * Antes eram duas telas em sequência: criava-se o login em Usuários e depois ia
 * a Colaboradores associar a pessoa pelo campo "Usuário do sistema". O passo do
 * meio não tinha nada a decidir — quem acabou de criar o acesso de um
 * colaborador vai, sem exceção, cadastrá-lo na escala — e era justamente o que
 * ficava esquecido: o login existia, a pessoa entrava e não via dia nenhum.
 *
 * É componente de cliente por causa de duas dependências entre campos: os
 * dados da escala só fazem sentido para o papel colaborador, e a sexta reduzida
 * só existe no 5x2. Mostrar tudo sempre pediria ao Planejamento que ignorasse
 * metade do formulário e adivinhasse qual metade.
 *
 * Não há campo de senha: ela é sempre gerada e mostrada uma única vez depois de
 * salvar. Um campo opcional para digitá-la convidava a escolher a mesma senha
 * para todo mundo, e o valor digitado ainda passava pela query string na volta.
 *
 * Também não há ciclo 12x36: quem o define é o plano do mês, que já o exige
 * antes de deixar gerar a escala.
 */
export function FormNovoUsuario({
  papeis, equipes, unidades, cargos,
}: {
  papeis: { valor: PapelEscalas; label: string }[];
  equipes: OpcaoEquipe[];
  unidades: OpcaoUnidade[];
  /** A lista que a área mantém em Parâmetros → Cargos. */
  cargos: { id: number; nome: string }[];
}) {
  const [papel, setPapel] = useState<PapelEscalas>('colaborador');
  const [equipeId, setEquipeId] = useState<string>(equipes[0] ? String(equipes[0].id) : '');
  const [regime, setRegime] = useState<string>('5x2');

  const ehColaborador = papel === 'colaborador';
  // Agora sai do regime DA PESSOA, e não da equipe: é a pessoa que faz
  // plantão, e é dela que depende haver ou não sexta reduzida.
  const ehPlantao = regime === '12x36';

  // Sem equipe ou sem unidade não há cadastro de escala possível, e o formulário
  // não deve fingir que há: o aviso manda para o lugar onde isso se resolve.
  const faltaBase = ehColaborador && (equipes.length === 0 || unidades.length === 0);

  return (
    <form action={convidarUsuario} className="px-4 py-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="esc-rotulo">Nome</span>
          <input name="nome" required className="esc-input" />
        </label>
        <label className="block">
          <span className="esc-rotulo">E-mail</span>
          <input type="email" name="email" required className="esc-input" />
        </label>
        <label className="block">
          <span className="esc-rotulo">Papel</span>
          <select
            name="papel"
            value={papel}
            onChange={e => setPapel(e.target.value as PapelEscalas)}
            className="esc-input"
          >
            {papeis.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {ehColaborador && (
        <div className="rounded-md border px-3.5 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
          <p className="text-[12px] font-semibold">Dados da escala</p>
          <p className="text-[11.5px] mt-0.5 mb-3" style={{ color: 'var(--muted)' }}>
            Um colaborador precisa existir na escala para ter escala. Ele pode nascer junto com o acesso,
            ou já estar cadastrado — nesse caso, é só apontar qual.
          </p>

          {faltaBase ? (
            <p className="text-[12px] font-medium" style={{ color: 'var(--rose)' }}>
              {equipes.length === 0 ? 'Nenhuma equipe cadastrada. ' : ''}
              {unidades.length === 0 ? 'Nenhuma unidade ativa. ' : ''}
              Cadastre em Parâmetros antes de criar um colaborador.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="esc-rotulo">Matrícula</span>
                <input name="matricula" required className="esc-input esc-num" />
              </label>

              <label className="block">
                <span className="esc-rotulo">CPF</span>
                <input
                  name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00"
                  className="esc-input esc-num"
                />
              </label>

              <label className="block">
                <span className="esc-rotulo">Data de nascimento</span>
                <input type="date" name="nascimento" className="esc-input esc-num" />
              </label>

              <label className="block">
                <span className="esc-rotulo">
                  Telefone <span style={{ color: 'var(--faint)' }}>(opcional)</span>
                </span>
                <input
                  name="telefone" inputMode="numeric" maxLength={16} placeholder="(11) 90000-0000"
                  className="esc-input esc-num"
                />
              </label>

              <label className="block">
                <span className="esc-rotulo">Cargo</span>
                <select name="cargo" className="esc-input">
                  <option value="">—</option>
                  {cargos.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="esc-rotulo">Equipe</span>
                <select
                  name="equipeId"
                  value={equipeId}
                  onChange={e => setEquipeId(e.target.value)}
                  required
                  className="esc-input"
                >
                  {equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="esc-rotulo">Unidade base</span>
                <select name="unidadeBaseId" required className="esc-input">
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="esc-rotulo">Turno</span>
                <select name="turno" defaultValue="D" className="esc-input">
                  {TURNOS_EM_ORDEM.map(v => <option key={v} value={v}>{TURNOS[v].label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="esc-rotulo">Regime</span>
                <select
                  name="regime" value={regime}
                  onChange={e => setRegime(e.target.value)}
                  className="esc-input"
                >
                  {Object.entries(REGIMES).map(([v, r]) => <option key={v} value={v}>{r.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="esc-rotulo">Entrada</span>
                <input type="time" name="entrada" defaultValue="08:00" required className="esc-input esc-num" />
              </label>

              <label className="block">
                <span className="esc-rotulo">Saída</span>
                <input type="time" name="saida" defaultValue="17:00" required className="esc-input esc-num" />
              </label>

              <label className="block">
                <span className="esc-rotulo">Admissão</span>
                <input type="date" name="admissao" className="esc-input" />
              </label>

              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="elegHome" defaultChecked /> Elegível a home office
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="elegExterno" /> Elegível a trabalho externo
                </label>
                {!ehPlantao && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="sextaReduzida" /> Sexta reduzida (−1h)
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <button type="submit" className="esc-btn" disabled={faltaBase}>
        {ehColaborador ? 'Criar acesso e cadastrar na escala' : 'Criar acesso'}
      </button>
    </form>
  );
}
