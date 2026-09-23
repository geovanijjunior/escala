import { useCallback, useEffect, useState } from 'react';

/**
 * Consulta à API com os três estados que toda tela precisa.
 *
 * Escrito à mão em cada tela, o trio "carregando / erro / dados" sai diferente
 * a cada vez, e o que costuma faltar é o mesmo: a tela que não trata o erro
 * fica eternamente em "Carregando…", e quem olha conclui que o sistema travou.
 *
 * O `cancelado` fecha uma corrida real: quem sai da tela antes da resposta
 * chegar teria o `setState` disparado sobre um componente desmontado — e, pior,
 * uma resposta lenta de um filtro antigo poderia sobrescrever a do filtro novo.
 */
export interface Busca<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

export function useBusca<T>(consultar: () => Promise<T>, dependencias: unknown[] = []): Busca<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const executar = useCallback(consultar, dependencias);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    executar()
      .then(r => { if (!cancelado) setDados(r); })
      .catch((e: Error) => { if (!cancelado) setErro(e.message); })
      .finally(() => { if (!cancelado) setCarregando(false); });

    return () => { cancelado = true; };
  }, [executar, gatilho]);

  return { dados, carregando, erro, recarregar: () => setGatilho(n => n + 1) };
}
