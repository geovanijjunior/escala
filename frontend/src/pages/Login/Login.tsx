import { MdBadge } from 'react-icons/md';
import { Botao } from '../../components/Botao/Botao';
import { useSessao } from '../../auth/SessaoContexto';
import { cores } from '../../config/tema';

/**
 * A porta de entrada.
 *
 * Não há campo de senha, e isso é o ponto: a senha corporativa é digitada na
 * tela do provedor de identidade, nunca aqui. Um formulário de usuário e senha
 * nesta página significaria que a aplicação vê a senha de rede de todo mundo —
 * exatamente o que o SSO existe para evitar.
 */
export function Login() {
  const { entrar } = useSessao();
  const erro = new URLSearchParams(window.location.search).get('erro');

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 16,
      background: cores.fundoDaPagina,
    }}>
      <div className="jor-cartao" style={{ padding: 28, width: '100%', maxWidth: 380 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: cores.primariaMaisEscura }}>Jornada</h1>
        <p style={{ marginTop: 6, marginBottom: 22, fontSize: 13, color: cores.textoSuave }}>
          Escala de trabalho — Soluções Digitais em Saúde
        </p>

        {erro && <div className="jor-faixa-erro" style={{ marginBottom: 16 }} role="alert">{erro}</div>}

        <Botao onClick={() => entrar('/')} icone={<MdBadge size={16} />} style={{ width: '100%' }}>
          Entrar com o login corporativo
        </Botao>

        <p style={{ marginTop: 16, marginBottom: 0, fontSize: 11.5, color: cores.textoSuave }}>
          Você será levado à tela de autenticação da instituição. Sua senha não passa por esta aplicação.
        </p>
      </div>
    </div>
  );
}
