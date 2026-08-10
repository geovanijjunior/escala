'use client';

import { useState } from 'react';

/** Grupo e motivo da ausência: trocar o grupo recarrega a lista de motivos. */
export function MotivoDependente({ grupos }: { grupos: { grupo: string; motivos: string[] }[] }) {
  const [grupo, setGrupo] = useState(grupos[0]?.grupo ?? '');
  const motivos = grupos.find(g => g.grupo === grupo)?.motivos ?? [];

  return (
    <>
      <label className="block">
        <span className="esc-rotulo">Grupo</span>
        <select name="grupo" value={grupo} onChange={e => setGrupo(e.target.value)} className="esc-input w-36">
          {grupos.map(g => <option key={g.grupo} value={g.grupo}>{g.grupo}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="esc-rotulo">Motivo</span>
        <select name="motivo" className="esc-input w-52" required>
          {motivos.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
    </>
  );
}
