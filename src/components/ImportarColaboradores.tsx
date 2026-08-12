'use client';

import { useRef, useState, useTransition } from 'react';
import { conferirPlanilha, importarPlanilha, type Relatorio } from '@/app/actions-importacao';
import { CABECALHO_MODELO } from '@/lib/domain/escalas/importacao';

/**
 * Importação de colaboradores: escolher o arquivo, conferir, confirmar.
 *
 * Cliente porque o passo do meio é a razão de tudo. Um formulário comum
 * gravaria direto e devolveria "importou 187 linhas", que não é resposta para
 * quem precisa saber QUAIS 187 e o que houve com as outras treze. Aqui o
 * arquivo é lido, o resultado é mostrado linha a linha, e só então existe um
 * botão de gravar.
 *
 * O conteúdo do arquivo fica no estado e é enviado duas vezes — uma para
 * conferir, outra para gravar. O servidor relê e revalida na segunda: o que a
 * conferência mostrou é informação para a pessoa, não autorização para o
 * servidor.
 */
export function ImportarColaboradores() {
  const [conteudo, setConteudo] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [gravou, setGravou] = useState(false);
  const [pendente, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  const escolher = async (arquivo: File) => {
    const texto = await arquivo.text();
    setConteudo(texto);
    setNomeArquivo(arquivo.name);
    setGravou(false);
    iniciar(async () => setRelatorio(await conferirPlanilha(texto)));
  };

  const gravar = () => iniciar(async () => {
    setRelatorio(await importarPlanilha(conteudo));
    setGravou(true);
  });

  const limpar = () => {
    if (campo.current) campo.current.value = '';
    setConteudo('');
    setNomeArquivo('');
    setRelatorio(null);
    setGravou(false);
  };

  const modelo = `data:text/csv;charset=utf-8,${encodeURIComponent(
    '﻿' + CABECALHO_MODELO.join(';') + '\n'
    + 'Ana Ribeiro;1001;ana@empresa.com;Analista Sr;TEC;MOR;D;;08:00;8;sim;nao;sim;01/03/2024\n',
  )}`;

  const aproveitaveis = relatorio ? relatorio.criar + relatorio.atualizar : 0;

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={campo}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) void escolher(f); }}
        />
        <button type="button" onClick={() => campo.current?.click()} className="esc-btn esc-btn-outline esc-btn-sm">
          {nomeArquivo ? 'Trocar planilha' : 'Escolher planilha'}
        </button>
        <a href={modelo} download="modelo-colaboradores.csv" className="esc-btn esc-btn-ghost esc-btn-sm">
          Baixar modelo
        </a>
        {nomeArquivo && (
          <>
            <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{nomeArquivo}</span>
            <button type="button" onClick={limpar} className="esc-btn esc-btn-ghost esc-btn-sm">Descartar</button>
          </>
        )}
        {pendente && <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>lendo…</span>}
      </div>

      {!relatorio && (
        <p className="esc-ajuda">
          CSV separado por <strong>ponto e vírgula</strong> ou por vírgula. Obrigatórias:
          nome, matrícula, equipe, unidade base e admissão. A matrícula é a identidade —
          quem já existe é atualizado, não duplicado.
        </p>
      )}

      {relatorio?.erros.length ? (
        <div className="rounded-md px-3 py-2.5 text-[12px]" style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}>
          {relatorio.erros.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      ) : null}

      {relatorio && !relatorio.erros.length && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Placar rotulo={gravou ? 'Criados' : 'A criar'} valor={relatorio.criar} cor="var(--green)" bg="var(--green-bg)" />
            <Placar rotulo={gravou ? 'Atualizados' : 'A atualizar'} valor={relatorio.atualizar} cor="var(--brand-700)" bg="var(--brand-100)" />
            <Placar rotulo="Fora, com erro" valor={relatorio.recusadas} cor="var(--rose)" bg="var(--rose-bg)" />
          </div>

          {relatorio.ignoradas.length > 0 && (
            <p className="esc-ajuda">
              Colunas do arquivo que o sistema não usa, e que foram ignoradas:{' '}
              <strong>{relatorio.ignoradas.join(', ')}</strong>.
            </p>
          )}

          {gravou ? (
            <div className="rounded-md px-3 py-2.5 text-[12px]" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
              <strong className="font-semibold">{relatorio.gravadas} colaborador(es) gravado(s).</strong>{' '}
              {relatorio.recusadas > 0
                ? 'As linhas com erro ficaram de fora — corrija e importe o arquivo de novo, que o que já entrou apenas se atualiza.'
                : 'A planilha inteira entrou.'}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={gravar} disabled={pendente || aproveitaveis === 0} className="esc-btn">
                Importar {aproveitaveis} colaborador(es)
              </button>
              {relatorio.recusadas > 0 && (
                <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  As {relatorio.recusadas} linha(s) com erro não entram.
                </span>
              )}
              {aproveitaveis === 0 && (
                <span className="text-[11.5px]" style={{ color: 'var(--rose)' }}>
                  Nenhuma linha aproveitável. Corrija os erros abaixo e escolha o arquivo de novo.
                </span>
              )}
            </div>
          )}

          <div className="tabela-rolo overflow-x-auto">
            <table className="esc-tabela">
              <thead>
                <tr>
                  <th className="text-right">Linha</th>
                  <th>O que acontece</th>
                  <th>Nome</th>
                  <th>Matrícula</th>
                  <th>Equipe</th>
                  <th>Unidade base</th>
                  <th>Admissão</th>
                </tr>
              </thead>
              <tbody>
                {relatorio.linhas.map(l => (
                  <tr key={l.linha} style={l.acao === 'recusada' ? { background: 'var(--rose-bg)' } : undefined}>
                    <td className="text-right esc-num" style={{ color: 'var(--muted)' }}>{l.linha}</td>
                    <td>
                      <span
                        className="esc-badge"
                        style={
                          l.acao === 'recusada' ? { color: 'var(--rose)', background: 'var(--surface)' }
                          : l.acao === 'atualizar' ? { color: 'var(--brand-700)', background: 'var(--brand-100)' }
                          : { color: 'var(--green)', background: 'var(--green-bg)' }
                        }
                      >
                        {l.acao === 'recusada' ? 'fora' : gravou ? (l.acao === 'criar' ? 'criado' : 'atualizado') : l.acao}
                      </span>
                      {l.erros.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {l.erros.map((e, i) => (
                            <li key={i} className="text-[11px]" style={{ color: 'var(--rose)' }}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{l.nome || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td className="esc-num">{l.matricula || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td style={{ color: 'var(--muted)' }}>{l.equipeNome}</td>
                    <td style={{ color: 'var(--muted)' }}>{l.unidadeNome}</td>
                    <td className="esc-num" style={{ color: 'var(--muted)' }}>
                      {l.admissao ? l.admissao.split('-').reverse().join('/') : '—'}
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

function Placar({ rotulo, valor, cor, bg }: { rotulo: string; valor: number; cor: string; bg: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: bg }}>
      <div className="esc-rotulo" style={{ color: cor }}>{rotulo}</div>
      <div className="text-[22px] font-semibold esc-num" style={{ color: cor }}>{valor}</div>
    </div>
  );
}
