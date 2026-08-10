'use client';

import { useEffect, useRef } from 'react';

/**
 * Faz o formulário de filtros se aplicar sozinho: selects e caixas de marcação
 * na hora, texto depois de uma pausa na digitação. Sem isso o usuário monta o
 * filtro e não vê nada acontecer até achar o botão.
 *
 * Colocado dentro de um <form method="get">, envia o próprio formulário — a
 * navegação continua sendo do servidor, o estado continua na URL.
 */
export function FiltrosAuto({ atrasoMs = 400 }: { atrasoMs?: number }) {
  const marcador = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = marcador.current?.closest('form');
    if (!form) return;

    let timer: ReturnType<typeof setTimeout>;
    const enviar = () => form.requestSubmit();

    const aoMudar = (e: Event) => {
      const alvo = e.target as HTMLElement;
      if (alvo.tagName === 'SELECT' || (alvo as HTMLInputElement).type === 'checkbox') enviar();
    };
    const aoDigitar = () => {
      clearTimeout(timer);
      timer = setTimeout(enviar, atrasoMs);
    };

    form.addEventListener('change', aoMudar);
    form.addEventListener('input', aoDigitar);
    return () => {
      clearTimeout(timer);
      form.removeEventListener('change', aoMudar);
      form.removeEventListener('input', aoDigitar);
    };
  }, [atrasoMs]);

  return <span ref={marcador} hidden />;
}
