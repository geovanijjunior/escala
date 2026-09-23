import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * O botão da aplicação.
 *
 * `type="button"` é o padrão de propósito. O padrão do HTML é `submit`, e um
 * botão auxiliar dentro de um formulário — "adicionar linha", "limpar filtro" —
 * envia o formulário sem que ninguém tenha pedido. O defeito só aparece quando
 * o botão está dentro de um `<form>`, então passa por todos os testes de tela
 * isolada e falha na integração.
 */
export interface PropsDoBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Peso visual. `primario` é a ação principal da tela — só uma por tela. */
  variante?: 'primario' | 'contorno' | 'discreto' | 'perigo';
  tamanho?: 'normal' | 'pequeno';
  /** Ícone à esquerda do rótulo. Use React Icons. */
  icone?: ReactNode;
  /** Trava o botão e troca o rótulo, para ação que demora. */
  carregando?: boolean;
  children?: ReactNode;
}

const CLASSE_DA_VARIANTE: Record<string, string> = {
  primario: '',
  contorno: 'jor-botao--contorno',
  discreto: 'jor-botao--discreto',
  perigo: 'jor-botao--perigo',
};

export function Botao({
  variante = 'primario',
  tamanho = 'normal',
  icone,
  carregando = false,
  disabled,
  children,
  className = '',
  type = 'button',
  ...resto
}: PropsDoBotao) {
  const classes = [
    'jor-botao',
    CLASSE_DA_VARIANTE[variante],
    tamanho === 'pequeno' ? 'jor-botao--pequeno' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      // Carregando também desabilita: sem isso, o segundo clique manda a
      // mesma ação de novo, e do lado do servidor viram dois registros.
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...resto}
    >
      {carregando ? null : icone}
      {carregando ? 'Aguarde…' : children}
    </button>
  );
}
