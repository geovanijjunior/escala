import { useState } from 'react';
import { MdPersonOff, MdVerifiedUser } from 'react-icons/md';
import { Tabela, type Coluna } from '../../components/Tabela/Tabela';
import { Campo } from '../../components/Campo/Campo';
import { useBusca } from '../../hooks/useBusca';
import { colaboradores, type Colaborador } from '../../services/api/colaboradores';
import { cores } from '../../config/tema';

/**
 * A lista de quem entra na escala.
 *
 * Primeira tela ligada à API nova — existe tanto para servir quanto para provar
 * o caminho inteiro: React → fetch → Fastify → serviço → repositório → Prisma →
 * Postgres, com a autorização decidida no backend.
 *
 * O filtro por texto é do lado do cliente de propósito. São dezenas de pessoas,
 * não dezenas de milhares: uma ida ao servidor a cada tecla digitada custaria
 * mais do que economiza, e ainda piscaria a tabela a cada letra.
 */
export function Colaboradores() {
  const [busca, setBusca] = useState('');
  const { dados, carregando, erro } = useBusca(() => colaboradores.listar(), []);

  const termo = busca.trim().toLowerCase();
  const lista = (dados ?? []).filter(c =>
    !termo
    || c.nome.toLowerCase().includes(termo)
    || c.matricula.toLowerCase().includes(termo)
    || c.equipe.toLowerCase().includes(termo));

  const colunas: Coluna<Colaborador>[] = [
    {
      chave: 'pessoa',
      titulo: 'Pessoa',
      conteudo: c => (
        <>
          <div style={{ fontWeight: 500 }}>{c.nome}</div>
          <div style={{ fontSize: 11, color: cores.textoSuave }}>{c.email || '—'}</div>
        </>
      ),
    },
    { chave: 'matricula', titulo: 'Matrícula', conteudo: c => c.matricula },
    { chave: 'equipe', titulo: 'Equipe', conteudo: c => c.equipe },
    { chave: 'unidade', titulo: 'Unidade base', conteudo: c => c.unidadeBase },
    { chave: 'jornada', titulo: 'Jornada', conteudo: c => `${c.regime} · ${c.entrada}–${c.saida}` },
    {
      chave: 'acesso',
      titulo: 'Acesso',
      conteudo: c => c.temAcesso
        ? <span style={{ color: cores.sucesso, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <MdVerifiedUser size={14} /> tem login
          </span>
        : <span style={{ color: cores.textoSuave, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <MdPersonOff size={14} /> sem login
          </span>,
    },
  ];

  return (
    <div className="jor-pagina">
      <div>
        <h1 style={{ margin: 0, fontSize: 17 }}>Colaboradores</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: cores.textoSuave }}>
          {carregando ? 'Carregando…' : `${lista.length} de ${(dados ?? []).length} pessoa(s)`}
        </p>
      </div>

      {erro && <div className="jor-faixa-erro" role="alert">{erro}</div>}

      <div className="jor-cartao" style={{ padding: 16 }}>
        <div style={{ maxWidth: 320, marginBottom: 12 }}>
          <Campo
            rotulo="Procurar"
            placeholder="nome, matrícula ou equipe"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
        <Tabela
          colunas={colunas}
          itens={lista}
          chaveDaLinha={c => c.id}
          carregando={carregando}
          vazio={termo ? `Ninguém encontrado para "${busca}".` : 'Nenhum colaborador cadastrado ainda.'}
        />
      </div>
    </div>
  );
}
