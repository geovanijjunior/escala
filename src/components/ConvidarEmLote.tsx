'use client';

import { useState, useTransition } from 'react';
import { conferirConvites, convidarEmLote, type RelatorioConvite } from '@/app/actions-convites';
import { ExportarCsv } from '@/components/ExportarCsv';

/**
 * Criar o login de quem já está na escala, em lote.
 *
 * Cliente por causa do segundo passo. As senhas voltam do servidor e precisam
 * aparecer uma única vez, na tela e num arquivo — um formulário comum as
 * mandaria pela query string, onde ficariam no histórico do navegador e no log
 * de qualquer proxy no caminho.
 *
 * A busca é por botão, e não ao abrir a tela: esta lista custa três consultas e
 * interessa a quem acabou de importar uma planilha, não a quem veio a Usuários
 * trocar o papel de alguém.
 */
export function ConvidarEmLote() {
  const [relatorio, setRelatorio] = useState<RelatorioConvite | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [criou, setCriou] = useState(false);
  const [pendente, iniciar] = useTransition();

  const procurar = () => iniciar(async () => {
    const r = await conferirConvites();
    setRelatorio(r);
    setMarcados(new Set(r.linhas.filter(l => l.situacao === 'pronto').map(l => l.colaboradorId)));
    setCriou(false);
  });

  const criar = () => iniciar(async () => {
    setRelatorio(await convidarEmLote([...marcados]));
    setCriou(true);
  });

  const alternar = (id: number) => setMarcados(atual => {
    const novo = new Set(atual);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  const prontas = relatorio?.linhas.filter(l => l.situacao === 'pronto') ?? [];
  const todasMarcadas = prontas.length > 0 && prontas.every(l => marcados.has(l.colaboradorId));
  const criadas = relatorio?.linhas.filter(l => l.situacao === 'criado') ?? [];

  const senhas = [
    ['Nome', 'Matrícula', 'E-mail', 'Senha temporária'],
    ...criadas.map(l => [l.nome, l.matricula, l.email, l.senha]),
  ];

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={procurar} disabled={pendente} className="esc-btn esc-btn-outline esc-btn-sm">
          {relatorio ? 'Procurar de novo' : 'Procurar quem está sem acesso'}
        </button>
        {pendente && <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>trabalhando…</span>}
      </div>

      {!relatorio && (
        <p className="esc-ajuda">
          Quem entra por planilha vira <strong>ficha na escala</strong>, e não login — são dois registros
          diferentes. Isto aqui cria o login de cada um com papel <strong>Colaborador</strong>, gera uma senha
          temporária por pessoa e devolve a lista para você distribuir. Todos trocam a senha no primeiro acesso.
        </p>
      )}

      {relatorio?.erros.length ? (
        <div className="rounded-md px-3 py-2.5 text-[12px]" style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}>
          {relatorio.erros.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      ) : null}

      {relatorio && !relatorio.erros.length && relatorio.linhas.length === 0 && (
        <div className="rounded-md px-3 py-2.5 text-[12px]" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
          Todo colaborador ativo já tem acesso ao sistema.
        </div>
      )}

      {relatorio && !relatorio.erros.length && relatorio.linhas.length > 0 && (
        <>
          {criou ? (
            <>
              <div
                className="rounded-md px-3 py-2.5 text-[12px]"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                <strong className="font-semibold">{relatorio.criados} acesso(s) criado(s).</strong>{' '}
                As senhas estão na tabela abaixo e <strong>não serão mostradas de novo</strong> — baixe a lista
                antes de sair desta tela.
              </div>
              {criadas.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <ExportarCsv
                    linhas={senhas}
                    nomeArquivo="senhas-temporarias.csv"
                    rotulo={`Baixar as ${criadas.length} senha(s)`}
                  />
                  <span className="text-[11.5px]" style={{ color: 'var(--rose)' }}>
                    O arquivo é uma lista de senhas: entregue a cada pessoa a dela e apague o arquivo depois.
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={criar}
                disabled={pendente || marcados.size === 0}
                className="esc-btn"
              >
                Criar {marcados.size} acesso(s)
              </button>
              <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                {relatorio.prontos} pronto(s), {relatorio.fora} fora.
                {relatorio.prontos > 20 && ' Leva alguns segundos por pessoa — não feche a página.'}
              </span>
            </div>
          )}

          <div className="tabela-rolo overflow-x-auto">
            <table className="esc-tabela">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    {!criou && (
                      <input
                        type="checkbox"
                        aria-label="Marcar todos"
                        checked={todasMarcadas}
                        onChange={() => setMarcados(
                          todasMarcadas ? new Set() : new Set(prontas.map(l => l.colaboradorId)),
                        )}
                      />
                    )}
                  </th>
                  <th>Pessoa</th>
                  <th>Matrícula</th>
                  <th>Equipe</th>
                  <th>E-mail</th>
                  <th>{criou ? 'Senha temporária' : 'Situação'}</th>
                </tr>
              </thead>
              <tbody>
                {relatorio.linhas.map(l => (
                  <tr
                    key={l.colaboradorId}
                    style={l.situacao === 'fora' ? { background: 'var(--rose-bg)' } : undefined}
                  >
                    <td>
                      {!criou && l.situacao === 'pronto' && (
                        <input
                          type="checkbox"
                          aria-label={`Criar acesso de ${l.nome}`}
                          checked={marcados.has(l.colaboradorId)}
                          onChange={() => alternar(l.colaboradorId)}
                        />
                      )}
                    </td>
                    <td className="font-medium">{l.nome}</td>
                    <td className="esc-num" style={{ color: 'var(--muted)' }}>{l.matricula}</td>
                    <td style={{ color: 'var(--muted)' }}>{l.equipe}</td>
                    <td className="font-mono text-[11px]">
                      {l.email || <span style={{ color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td>
                      {l.situacao === 'criado' ? (
                        <span className="font-mono font-semibold text-[12.5px]">{l.senha}</span>
                      ) : l.situacao === 'fora' ? (
                        <span className="text-[11px]" style={{ color: 'var(--rose)' }}>{l.motivo}</span>
                      ) : (
                        <span className="esc-badge" style={{ color: 'var(--green)', background: 'var(--green-bg)' }}>
                          pronto
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
