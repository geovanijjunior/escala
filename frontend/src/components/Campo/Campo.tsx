import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Campo de texto com rótulo, ajuda e erro.
 *
 * O `id` é gerado por `useId` e ligado ao `<label>` por `htmlFor`. Sem esse
 * par, clicar no rótulo não foca o campo e o leitor de tela anuncia "campo de
 * edição" sem dizer de quê — o formulário fica inutilizável para quem depende
 * dele, e nada na tela denuncia isso.
 */
export interface PropsDoCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  rotulo: string;
  /** Texto de apoio. Some quando há erro — dois textos sob o campo competem. */
  ajuda?: ReactNode;
  erro?: string;
}

export function Campo({ rotulo, ajuda, erro, className = '', ...resto }: PropsDoCampo) {
  const id = useId();
  const idDaMensagem = `${id}-msg`;

  return (
    <div className={`jor-campo ${erro ? 'jor-campo--com-erro' : ''} ${className}`}>
      <label className="jor-campo__rotulo" htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        className="jor-campo__entrada"
        // `aria-invalid` é o que faz o leitor de tela anunciar o erro; a borda
        // vermelha sozinha não chega a quem não a vê.
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro || ajuda ? idDaMensagem : undefined}
        {...resto}
      />
      {erro
        ? <span id={idDaMensagem} className="jor-campo__erro" role="alert">{erro}</span>
        : ajuda ? <span id={idDaMensagem} className="jor-campo__ajuda">{ajuda}</span> : null}
    </div>
  );
}
