'use client';

import { useState } from 'react';

/**
 * Campos de "lançar férias ou folga", que mudam conforme o tipo.
 *
 * Férias não têm motivo a escolher — são férias — e exigem a data final.
 * Folga e afastamento pedem grupo e motivo, e aceitam fim vazio para o caso
 * mais comum, que é um dia só. Mostrar os dois conjuntos ao mesmo tempo, com
 * metade deles inerte, é o convite clássico a preencher o campo errado.
 */
export function LancarAusencia({
  grupos, primeiroDia, ultimoDia,
}: {
  grupos: { grupo: string; motivos: string[] }[];
  primeiroDia: string;
  ultimoDia: string;
}) {
  const [tipo, setTipo] = useState<'FERIAS' | 'AUSENCIA'>('AUSENCIA');
  const [grupo, setGrupo] = useState(grupos[0]?.grupo ?? '');
  const motivos = grupos.find(g => g.grupo === grupo)?.motivos ?? [];

  return (
    <>
      <label className="block">
        <span className="esc-rotulo">O que é</span>
        <select
          name="tipo"
          value={tipo}
          onChange={e => setTipo(e.target.value as 'FERIAS' | 'AUSENCIA')}
          className="esc-input w-full"
        >
          <option value="AUSENCIA">Folga ou afastamento</option>
          <option value="FERIAS">Férias</option>
        </select>
      </label>

      {tipo === 'AUSENCIA' && (
        <>
          <label className="block">
            <span className="esc-rotulo">Grupo</span>
            <select
              name="grupo"
              value={grupo}
              onChange={e => setGrupo(e.target.value)}
              className="esc-input w-full"
            >
              {grupos.map(g => <option key={g.grupo} value={g.grupo}>{g.grupo}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="esc-rotulo">Motivo</span>
            <select name="motivo" className="esc-input w-full">
              {motivos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="esc-rotulo">Início</span>
          <input
            type="date" name="inicio" required className="esc-input w-full esc-num"
            min={primeiroDia} max={ultimoDia} defaultValue={primeiroDia}
          />
        </label>
        <label className="block">
          <span className="esc-rotulo">Fim</span>
          <input
            type="date" name="fim" className="esc-input w-full esc-num"
            min={primeiroDia} required={tipo === 'FERIAS'}
          />
        </label>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {tipo === 'FERIAS'
          ? 'Férias precisam da data final. O período pode passar do fim do mês.'
          : 'Fim vazio significa um dia só.'}
      </p>
    </>
  );
}
