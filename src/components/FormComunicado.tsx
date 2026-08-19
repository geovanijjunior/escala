'use client';

import { useRef, useState } from 'react';
import {
  TIPOS_ANEXO, LIMITE_BYTES, LIMITE_ROTULO, LIMITE_TOTAL_BYTES, LIMITE_TOTAL_ROTULO,
} from '@/lib/anexos';

const tamanho = (b: number) => {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};

/**
 * Campos do comunicado.
 *
 * Cliente por causa de duas dependências entre campos: a equipe só faz sentido
 * quando o público é "colaboradores", e o tamanho dos anexos precisa ser
 * conferido antes do envio — descobrir que o arquivo passou do limite depois de
 * subir 20 MB e perder o texto digitado é o pior jeito de aprender o teto.
 */
export function FormComunicado({
  podeEscolherPublico, equipes,
}: {
  podeEscolherPublico: boolean;
  equipes: { id: number; nome: string }[];
}) {
  const [publico, setPublico] = useState<'colaboradores' | 'gestores'>('colaboradores');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const campo = useRef<HTMLInputElement>(null);

  const grandes = arquivos.filter(f => f.size > LIMITE_BYTES);
  // A soma importa por si: cada arquivo pode caber e o conjunto estourar o
  // corpo da requisição, que é onde o Next corta.
  const total = arquivos.reduce((n, f) => n + f.size, 0);
  const totalEstourou = total > LIMITE_TOTAL_BYTES;

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

      <div>
        <span className="esc-rotulo">Anexos (imagem ou PDF)</span>

        {/* O `<input type=file>` cru desenha um botão do sistema operacional,
            em inglês e fora do estilo de todo o resto. Aqui ele fica escondido
            e quem aparece é um botão de verdade, com a lista do que já foi
            escolhido — que o controle nativo também não mostra além do
            "2 arquivos". */}
        <input
          ref={campo}
          type="file"
          name="anexos"
          multiple
          accept={TIPOS_ANEXO.join(',')}
          onChange={e => setArquivos([...(e.target.files ?? [])])}
          className="sr-only"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => campo.current?.click()}
            className="esc-btn esc-btn-outline esc-btn-sm"
          >
            {arquivos.length ? 'Trocar arquivos' : 'Escolher arquivos'}
          </button>
          <span className="text-[11.5px]" style={{ color: totalEstourou ? 'var(--rose)' : 'var(--muted)' }}>
            {arquivos.length === 0
              ? `Nenhum arquivo escolhido · até ${LIMITE_ROTULO} por arquivo`
              : `${arquivos.length} arquivo(s) · ${tamanho(total)} no total`}
          </span>
          {arquivos.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (campo.current) campo.current.value = '';
                setArquivos([]);
              }}
              className="esc-btn esc-btn-ghost esc-btn-sm"
            >
              Remover
            </button>
          )}
        </div>

        {arquivos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {arquivos.map(f => {
              const grande = f.size > LIMITE_BYTES;
              return (
                <li
                  key={f.name}
                  className="text-[11.5px] flex flex-wrap items-baseline gap-x-2"
                  style={{ color: grande ? 'var(--rose)' : 'var(--text)' }}
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="esc-num">{tamanho(f.size)}</span>
                  {grande && <span>passa de {LIMITE_ROTULO} — reduza ou remova</span>}
                </li>
              );
            })}
          </ul>
        )}

        {totalEstourou && (
          <p className="text-[11.5px] mt-1.5 font-medium" style={{ color: 'var(--rose)' }}>
            Os anexos somam {tamanho(total)} e o limite por comunicado é {LIMITE_TOTAL_ROTULO}. Remova algum ou
            publique em dois comunicados.
          </p>
        )}

        <span className="esc-ajuda mt-1 block">
          Até {LIMITE_ROTULO} por arquivo e {LIMITE_TOTAL_ROTULO} somando todos. PNG, JPEG, WEBP, GIF ou PDF.
        </span>
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" name="fixado" />
        Fixar no topo do mural
      </label>

      <button type="submit" className="esc-btn" disabled={grandes.length > 0 || totalEstourou}>
        Publicar comunicado
      </button>
    </div>
  );
}
