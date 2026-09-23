import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, SemSessao } from '../services/api/cliente';
import { configuracao } from '../config/ambiente';

/**
 * Quem está logado, para a aplicação inteira.
 *
 * O padrão pede a autenticação em módulo separado, e a razão prática aparece
 * quando a regra muda: com cada tela perguntando à API quem é a pessoa, um
 * ajuste no tratamento de sessão vencida precisa ser repetido em todas — e a
 * que ficar para trás não dá erro, apenas deixa a pessoa numa tela vazia sem
 * explicação.
 *
 * O estado tem TRÊS valores, não dois. "Ainda não sei" é diferente de "não tem
 * ninguém": tratá-los como a mesma coisa manda ao login todo mundo que
 * recarrega a página, no instante entre o React montar e a API responder.
 */

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: string;
  contaId: string | null;
}

interface ValorDaSessao {
  usuario: Usuario | null;
  /** `true` enquanto a primeira consulta não voltou. */
  carregando: boolean;
  entrar: (destino?: string) => void;
  sair: () => Promise<void>;
  reconsultar: () => Promise<void>;
}

const Contexto = createContext<ValorDaSessao | null>(null);

export function ProvedorDeSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  const reconsultar = useCallback(async () => {
    try {
      setUsuario(await api.buscar<Usuario>('/auth/eu'));
    } catch (e) {
      // 401 aqui é o caso normal de quem não entrou ainda — não é falha.
      if (!(e instanceof SemSessao)) console.error('não foi possível consultar a sessão', e);
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void reconsultar(); }, [reconsultar]);

  /**
   * Manda ao provedor de identidade.
   *
   * Navegação de página inteira, e não `fetch`: o fluxo passa pela tela do
   * Keycloak, que precisa da barra de endereços do navegador. Uma chamada por
   * `fetch` bateria no CORS e, mesmo que não batesse, não teria onde mostrar a
   * tela de login nem o segundo fator.
   */
  const entrar = useCallback((destino?: string) => {
    const alvo = destino ?? window.location.pathname;
    window.location.href = `${configuracao.urlDaApi}/auth/entrar?destino=${encodeURIComponent(alvo)}`;
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.criar('/auth/sair', {});
    } finally {
      // Limpa mesmo se a chamada falhar: quem clicou em sair espera sair, e
      // manter a tela como estava depois de um erro de rede é pior do que
      // limpar — do lado do servidor o cookie já pode ter sido invalidado.
      setUsuario(null);
    }
  }, []);

  const valor = useMemo<ValorDaSessao>(
    () => ({ usuario, carregando, entrar, sair, reconsultar }),
    [usuario, carregando, entrar, sair, reconsultar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * A sessão, de dentro de qualquer componente.
 *
 * Estoura quando usado fora do provedor, em vez de devolver `null`: o erro
 * aparece na primeira renderização, e não como uma tela vazia inexplicável
 * meses depois.
 */
export function useSessao(): ValorDaSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao precisa estar dentro de <ProvedorDeSessao>.');
  return valor;
}
