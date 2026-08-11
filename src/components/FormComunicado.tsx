'use client';

import { useState } from 'react';
import { TIPOS_ANEXO, LIMITE_BYTES } from '@/lib/anexos';

/**
 * Campos do comunicado.
 *
 * Cliente por causa de duas dependências entre campos: a equipe só faz sentido
 * quando o público é "colaboradores", e o tamanho dos anexos precisa ser
 * conferido antes do envio — descobrir que o arquivo passou de 2 MB depois de
 * subir 8 MB e perder o texto digitado é o pior jeito de aprender o limite.
 */
export function FormComunicado({
  podeEscolherPublico, equipes,
}: {
  podeEscolherPublico: boolean;
  equipes: { id: number; nome: string }[];
}) {
  const [publico, setPublico] = useState<'colaboradores' | 'gestores'>('colaboradores');
  const [erroAnexo, setErroAnexo] = useState('');

  const conferirTamanho = (e: React.ChangeEvent<HTMLInputElement>) => {
    const grandes = [...(e.target.files ?? [])].filter(f => f.size > LIMITE_BYTES);
    setErroAnexo(grandes.length
      ? `${grandes.map(f => f.name).join(', ')}: passa de 2 MB. Reduza antes de enviar.`
      : '');
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block lg:col-span-2">
          <span className="esc-rotulo">Título</span>
          <input name="titulo" required className="esc-input" placeholder="Ex.: Manutenção do ar-condicionado no Morumbi" />
        </label>

        {podeEscolherPublico ? (
          <label className="block">
            <span className="esc-rotulo">Para quem</span>
            <select
              name="publico"
              value={publico}
              onChange={e => setPublico(e.target.value as 'colaboradores' | 'gestores')}
              className="esc-input"
            >
              <option value="colaboradores">Colaboradores</option>
              <option value="gestores">Gestores</option>
            </select>
          </label>
        ) : (
          // O gestor publica para a equipe dele; mostrar um seletor com uma
          // opção só seria pergunta sem escolha.
          <input type="hidden" name="publico" value="colaboradores" />
        )}

        {publico === 'colaboradores' && (
          <label className="block">
            <span className="esc-rotulo">Equipe</span>
            <select name="equipeId" className="esc-input" defaultValue={equipes.length === 1 ? String(equipes[0].id) : ''}>
              {podeEscolherPublico && <option value="">Todas as equipes</option>}
              {equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
        )}
      </div>

      <label className="block">
        <span className="esc-rotulo">Comunicado</span>
        <textarea name="corpo" required rows={4} className="esc-input" placeholder="O texto que a equipe vai ler." />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="esc-rotulo">Anexos (imagem ou PDF)</span>
          <input
            type="file"
            name="anexos"
            multiple
            accept={TIPOS_ANEXO.join(',')}
            onChange={conferirTamanho}
            className="esc-input py-1.5"
          />
          <span className="esc-ajuda mt-1 block">
            Até 2 MB por arquivo. PNG, JPEG, WEBP, GIF ou PDF.
          </span>
          {erroAnexo && (
            <span className="text-[11.5px] mt-1 block" style={{ color: 'var(--rose)' }}>{erroAnexo}</span>
          )}
        </label>

        <label className="flex items-center gap-2 text-[12.5px] pt-6">
          <input type="checkbox" name="fixado" />
          Fixar no topo do mural
        </label>
      </div>

      <button type="submit" className="esc-btn" disabled={!!erroAnexo}>Publicar comunicado</button>
    </div>
  );
}
