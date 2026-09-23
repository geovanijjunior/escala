import { variaveisCss } from '../config/tema';

/**
 * Põe as cores do tema no documento, como variáveis CSS.
 *
 * Existe porque o CSS precisa das cores e não enxerga o objeto do TypeScript.
 * A alternativa — escrever os mesmos hexadecimais num arquivo `.css` — cria
 * duas listas que precisam concordar, e elas param de concordar no primeiro
 * ajuste feito só de um lado. O defeito daí não é visual: é a marca com dois
 * azuis diferentes na mesma tela, e ninguém sabe qual é o certo.
 *
 * Idempotente: chamar duas vezes substitui, não acumula. O Storybook e o app
 * chamam cada um por sua conta, e em desenvolvimento o módulo recarrega.
 */
const ID = 'tema-da-jornada';

export function aplicarTema(): void {
  if (typeof document === 'undefined') return;

  let etiqueta = document.getElementById(ID);
  if (!etiqueta) {
    etiqueta = document.createElement('style');
    etiqueta.id = ID;
    // No `head`, antes das folhas de estilo dos componentes: variável tem de
    // existir quando quem a usa é lido.
    document.head.prepend(etiqueta);
  }
  etiqueta.textContent = variaveisCss();
}
