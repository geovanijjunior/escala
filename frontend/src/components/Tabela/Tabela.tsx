import type { ReactNode } from 'react';

/**
 * Tabela de dados.
 *
 * Genérica na linha para que a coluna diga de onde tira o valor sem
 * `item as any`: trocar o tipo da lista passa a quebrar o typecheck em vez de
 * devolver `undefined` na tela.
 *
 * O estado VAZIO é parte do componente, não do chamador. Deixado por conta de
 * quem usa, ele é esquecido — e uma tabela sem linhas e sem explicação parece
 * defeito de carregamento para quem olha, que então recarrega a página.
 */
export interface Coluna<T> {
  chave: string;
  titulo: string;
  /** O que mostrar na célula. */
  conteudo: (item: T) => ReactNode;
  alinhamento?: 'esquerda' | 'direita';
}

export interface PropsDaTabela<T> {
  colunas: Coluna<T>[];
  itens: T[];
  /** Identidade da linha. `index` como chave embaralha o React quando a lista reordena. */
  chaveDaLinha: (item: T) => string | number;
  vazio?: ReactNode;
  carregando?: boolean;
}

export function Tabela<T>({
  colunas, itens, chaveDaLinha, vazio = 'Nada por aqui ainda.', carregando = false,
}: PropsDaTabela<T>) {
  return (
    <div className="jor-tabela-rolo">
      <table className="jor-tabela">
        <thead>
          <tr>
            {colunas.map(c => (
              <th key={c.chave} style={c.alinhamento === 'direita' ? { textAlign: 'right' } : undefined}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {carregando ? (
            <tr><td className="jor-tabela__vazia" colSpan={colunas.length}>Carregando…</td></tr>
          ) : itens.length === 0 ? (
            <tr><td className="jor-tabela__vazia" colSpan={colunas.length}>{vazio}</td></tr>
          ) : itens.map(item => (
            <tr key={chaveDaLinha(item)}>
              {colunas.map(c => (
                <td key={c.chave} style={c.alinhamento === 'direita' ? { textAlign: 'right' } : undefined}>
                  {c.conteudo(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
