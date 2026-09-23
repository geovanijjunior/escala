import { useEffect, useRef, type ReactNode } from 'react';
import { MdClose } from 'react-icons/md';
import { Botao } from '../Botao/Botao';

/**
 * Janela sobreposta.
 *
 * Três comportamentos que parecem detalhe e são o que separa um modal usável
 * de uma armadilha:
 *
 *  · `Esc` fecha. É o primeiro reflexo de quem abriu sem querer;
 *  · o clique no fundo fecha, mas só quando começou NO fundo — sem essa
 *    conferência, selecionar um texto dentro e soltar o mouse fora fecha a
 *    janela e perde o que a pessoa estava escrevendo;
 *  · o corpo da página para de rolar enquanto está aberto, senão a rolagem
 *    "atravessa" o modal e move a página atrás dele.
 */
export interface PropsDoModal {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  /** Botões do rodapé. Sem eles o rodapé não aparece. */
  acoes?: ReactNode;
}

export function Modal({ aberto, titulo, aoFechar, children, acoes }: PropsDoModal) {
  const comecouNoFundo = useRef(false);

  useEffect(() => {
    if (!aberto) return;

    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', aoTeclar);

    const rolagemAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = rolagemAnterior;
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div
      className="jor-modal__fundo"
      onMouseDown={e => { comecouNoFundo.current = e.target === e.currentTarget; }}
      onMouseUp={e => {
        if (comecouNoFundo.current && e.target === e.currentTarget) aoFechar();
        comecouNoFundo.current = false;
      }}
    >
      <div className="jor-modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="jor-modal__topo">
          <h2 className="jor-modal__titulo">{titulo}</h2>
          <Botao variante="discreto" tamanho="pequeno" onClick={aoFechar} aria-label="Fechar">
            <MdClose size={16} />
          </Botao>
        </div>
        <div className="jor-modal__corpo">{children}</div>
        {acoes && <div className="jor-modal__rodape">{acoes}</div>}
      </div>
    </div>
  );
}
