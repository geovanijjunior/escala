import { MdLogout } from 'react-icons/md';
import { ProvedorDeSessao, useSessao } from './auth/SessaoContexto';
import { Login } from './pages/Login/Login';
import { Colaboradores } from './pages/Colaboradores/Colaboradores';
import { Botao } from './components/Botao/Botao';
import { cores } from './config/tema';

/**
 * A casca da aplicação.
 *
 * Ainda sem roteador: enquanto só existe uma tela migrada, um roteador seria
 * estrutura sem conteúdo. Ele entra junto com a segunda — é o momento em que
 * passa a resolver alguma coisa em vez de antecipar uma decisão.
 */
function Conteudo() {
  const { usuario, carregando, sair } = useSessao();

  // O terceiro estado importa: sem ele, todo mundo que recarrega a página vê a
  // tela de login piscar antes de a sessão ser confirmada.
  if (carregando) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: cores.textoSuave }}>
        Carregando…
      </div>
    );
  }

  if (!usuario) return <Login />;

  return (
    <>
      <header style={{
        background: cores.primaria,
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <strong style={{ fontSize: 14 }}>Jornada</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
          <span>{usuario.nome}</span>
          <Botao
            variante="discreto"
            tamanho="pequeno"
            onClick={() => void sair()}
            icone={<MdLogout size={14} />}
            style={{ color: '#fff' }}
          >
            Sair
          </Botao>
        </div>
      </header>
      <Colaboradores />
    </>
  );
}

export function App() {
  return (
    <ProvedorDeSessao>
      <Conteudo />
    </ProvedorDeSessao>
  );
}

export default App;
