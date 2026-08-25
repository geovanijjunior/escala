'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Mantém a rolagem onde estava depois de uma Server Action.
 *
 * Toda action desta base termina em `redirect()` — é assim que a tela volta com
 * `ok=1`, com o erro, ou com o filtro que estava aberto. Só que `redirect()` é
 * uma NAVEGAÇÃO, e navegação no App Router rola para o topo. Em tela curta
 * ninguém repara; nas longas — o plano do mês, os ajustes da escala, a lista de
 * solicitações — cada clique jogava a pessoa para o começo da página, e ela
 * tinha de rolar tudo de novo até onde estava para dar o passo seguinte. Não é
 * um detalhe estético: numa triagem de trinta pedidos, são trinta rolagens.
 *
 * `next/form` tem uma prop `scroll`, e ela não serve aqui: a documentação diz
 * que `replace` e `scroll` são ignorados quando a `action` é uma função, que é
 * o caso de todos os formulários desta base. Também não adianta trocar o
 * `redirect` por `revalidatePath`: é o redirect que carrega o `ok`, o `erro` e
 * o contexto da tela. Então a posição é guardada no envio e reposta quando a
 * navegação termina.
 *
 * Três guardas, para não repor rolagem onde o topo é o certo:
 *
 *  - caminho diferente — a action levou para OUTRA tela, e ali a pessoa está
 *    chegando, não voltando;
 *  - âncora na URL — a action apontou um lugar específico (`#editor-plano`,
 *    `#ausencias`), e quem manda é ela;
 *  - já estava no topo — não há o que repor.
 */

const CHAVE = 'jornada:rolagem';

/**
 * Uma posição guardada só vale para a navegação que vem logo em seguida.
 *
 * Sem prazo, um envio que não navegou (erro de validação do próprio navegador,
 * aba trocada no meio) deixaria a marca no storage, e a próxima navegação
 * qualquer — dez minutos depois, vinda de um link — herdaria a rolagem de outro
 * contexto. O usuário leria isso como a tela abrindo no meio, do nada.
 *
 * Poucos segundos, e não meio minuto, porque a marca sobrevive a caminho que
 * não bate (veja o efeito abaixo): esta é a única coisa que a expira quando a
 * action leva mesmo para outra tela. Uma cadeia de redirect resolve em bem
 * menos de um segundo, então a folga aqui é enorme.
 */
const VALIDADE_MS = 8_000;

/**
 * Por quanto tempo a posição é reafirmada depois da navegação.
 *
 * O Next rola para o topo em algum ponto DEPOIS deste componente ser
 * notificado, e o instante exato varia com o tamanho da resposta. Meio segundo
 * cobre com folga o que foi medido, e é curto o bastante para ninguém sentir a
 * página resistindo.
 */
const JANELA_MS = 500;

interface Marca {
  caminho: string;
  y: number;
  quando: number;
}

export function PreservarRolagem() {
  // ── No envio: onde estávamos ───────────────────────────────────
  useEffect(() => {
    const aoEnviar = () => {
      if (window.scrollY <= 0) return;
      const marca: Marca = {
        caminho: window.location.pathname,
        y: window.scrollY,
        quando: Date.now(),
      };
      // Aba anônima, storage cheio, cookies bloqueados: sem preservação, e só.
      // A tela continua funcionando exatamente como funcionava antes disto.
      try { sessionStorage.setItem(CHAVE, JSON.stringify(marca)); } catch { /* segue sem */ }
    };

    // Fase de captura, e no `document`: assim a marca é feita antes de qualquer
    // `preventDefault` de handler mais interno, e vale para todo formulário da
    // página sem cada um precisar saber que isto existe.
    document.addEventListener('submit', aoEnviar, true);
    return () => document.removeEventListener('submit', aoEnviar, true);
  }, []);

  // ── Terminada a navegação: de volta para lá ────────────────────
  //
  // `useSearchParams` junto do caminho porque quase todo redirect daqui muda só
  // a query (`?ok=1`, `?erro=…`): observar apenas o pathname não veria nada
  // acontecer, que é justamente o caso que este componente existe para tratar.
  const caminho = usePathname();
  const busca = useSearchParams();

  useEffect(() => {
    let marca: Marca | null = null;
    try {
      const bruto = sessionStorage.getItem(CHAVE);
      if (bruto) marca = JSON.parse(bruto) as Marca;
    } catch { return; }
    if (!marca) return;

    const vencida = Date.now() - marca.quando > VALIDADE_MS;

    // A marca NÃO é descartada quando o caminho não bate — e é essa a diferença
    // entre funcionar e não funcionar. Vários redirects daqui passam por uma
    // rota de compatibilidade antes do destino: salvar o plano volta para
    // `/planos`, que é só um atalho que redireciona para `/gerar?etapa=plano`.
    // Esse salto intermediário acorda este efeito com o caminho errado, e a
    // primeira versão, que limpava ali, comia a marca antes de o destino real
    // chegar — a rolagem se perdia justamente nas telas mais longas, que são as
    // que motivaram isto. Descartar só quando foi usada, ou quando venceu.
    const usar = !vencida && marca.caminho === caminho && !window.location.hash;
    if (usar || vencida) {
      try { sessionStorage.removeItem(CHAVE); } catch { /* segue sem */ }
    }
    if (!usar) return;

    // Repor uma vez não basta, e não é questão de capricho: medindo, a rolagem
    // do Next para o topo acontece DEPOIS deste efeito. Repor aqui e parar
    // deixava a página exatamente onde ela estava indo parar — no começo.
    //
    // Então a posição é reafirmada a cada quadro por uma janela curta, e a
    // janela termina no primeiro sinal de que a pessoa assumiu a rolagem. Sem
    // essa saída, meio segundo de teimosia brigaria com quem já está rolando.
    const { y } = marca;
    const limite = Date.now() + JANELA_MS;
    let quadro = 0;
    let vivo = true;

    const desistir = () => { vivo = false; };
    const eventos = ['wheel', 'touchstart', 'keydown'] as const;
    for (const e of eventos) window.addEventListener(e, desistir, { passive: true, once: true });

    const insistir = () => {
      if (!vivo) return;
      if (window.scrollY !== y) window.scrollTo(0, y);
      if (Date.now() < limite) quadro = requestAnimationFrame(insistir);
    };
    insistir();

    return () => {
      vivo = false;
      cancelAnimationFrame(quadro);
      for (const e of eventos) window.removeEventListener(e, desistir);
    };
  }, [caminho, busca]);

  return null;
}
