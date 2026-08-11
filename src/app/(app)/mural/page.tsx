import { getSessao, podeAprovar, ehPlanejamento } from '@/lib/sessao';
import { createClient } from '@/lib/supabase/server';
import { listarEquipes } from '@/lib/data/escalas';
import { publicarComunicado, removerComunicado } from '@/app/actions-mural';
import { texto, type Busca } from '@/lib/pagina';
import { Aviso, Badge, Bloco, Vazio } from '@/components/Ui';
import { FormComunicado } from '@/components/FormComunicado';

interface LinhaComunicado {
  id: number;
  titulo: string;
  corpo: string;
  publico: 'colaboradores' | 'gestores';
  equipe_id: number | null;
  fixado: boolean;
  autor_id: string | null;
  autor_nome: string;
  criado_em: string;
  comunicado_anexos: { id: number; nome: string; tipo: string; tamanho: number }[] | null;
}

const quando = (iso: string) => {
  const [d, h] = iso.split('T');
  return `${d.split('-').reverse().join('/')} às ${(h ?? '').slice(0, 5)}`;
};

// Arredondar tudo para KB fazia um anexo pequeno aparecer como "0 KB", que se
// lê como arquivo quebrado.
const tamanho = (b: number) => {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};

export default async function MuralPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  const supabase = await createClient();

  // A policy já recorta: o colaborador vê o que é da equipe dele, o gestor vê o
  // mural dos gestores e o da equipe, o Planejamento vê tudo. A consulta não
  // repete esse filtro — repetir seria a chance de os dois discordarem.
  const { data, error } = await supabase
    .from('comunicados')
    .select('*, comunicado_anexos(id, nome, tipo, tamanho)')
    .order('fixado', { ascending: false })
    .order('criado_em', { ascending: false });

  if (error) console.error('[escala] mural:', error.message);
  const comunicados = (data ?? []) as unknown as LinhaComunicado[];

  const publica = podeAprovar(sessao.papel);
  const planeja = ehPlanejamento(sessao.papel);

  // Carregado para todo mundo, e não só para quem publica: sem os nomes, o
  // selo de um comunicado de equipe caía no rótulo "Todos os colaboradores" e
  // dizia ao colaborador o contrário do que o comunicado é.
  const equipes = await listarEquipes();
  const minhasEquipes = planeja
    ? equipes
    : equipes.filter(e => e.gestorId === sessao.usuario.id);

  return (
    <>
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Mural de comunicados</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {planeja
            ? 'Avisos para as equipes e para os gestores.'
            : publica
              ? 'Avisos da sua equipe e os que o Planejamento manda aos gestores.'
              : 'Avisos da sua equipe e da operação.'}
        </p>
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      {publica && (
        <Bloco
          titulo="Publicar comunicado"
          desc="Todo mundo do público escolhido recebe um aviso no sino."
        >
          <form action={publicarComunicado} className="px-4 py-4" encType="multipart/form-data">
            <FormComunicado
              podeEscolherPublico={planeja}
              equipes={minhasEquipes.map(e => ({ id: e.id, nome: e.nome }))}
            />
          </form>
        </Bloco>
      )}

      <Bloco titulo={`${comunicados.length} comunicado(s)`}>
        {comunicados.length === 0 ? (
          <Vazio
            titulo="Mural vazio"
            desc={publica ? 'Publique o primeiro comunicado acima.' : 'Quando houver um aviso, ele aparece aqui.'}
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {comunicados.map(c => {
              const equipe = equipes.find(e => e.id === c.equipe_id);
              const meu = c.autor_id === sessao.usuario.id;
              return (
                <li key={c.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.fixado && <Badge cor="var(--amber)" bg="var(--amber-bg)">Fixado</Badge>}
                    <span className="text-[13.5px] font-semibold">{c.titulo}</span>
                    <Badge
                      cor={c.publico === 'gestores' ? 'var(--green)' : 'var(--brand-700)'}
                      bg={c.publico === 'gestores' ? 'var(--green-bg)' : 'var(--brand-100)'}
                    >
                      {c.publico === 'gestores'
                        ? 'Gestores'
                        : c.equipe_id === null
                          ? 'Todos os colaboradores'
                          : equipe?.nome ?? 'Uma equipe'}
                    </Badge>
                    <span className="text-[11px] ml-auto" style={{ color: 'var(--muted)' }}>
                      {c.autor_nome} · {quando(c.criado_em)}
                    </span>
                  </div>

                  <p className="text-[12.5px] mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                    {c.corpo}
                  </p>

                  {(c.comunicado_anexos ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {(c.comunicado_anexos ?? []).map(a => (
                        <a
                          key={a.id}
                          href={`/mural/anexo/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="esc-btn esc-btn-outline esc-btn-sm"
                        >
                          {a.tipo === 'application/pdf' ? 'PDF' : 'Imagem'} · {a.nome} ({tamanho(a.tamanho)})
                        </a>
                      ))}
                    </div>
                  )}

                  {(planeja || meu) && (
                    <form action={removerComunicado} className="mt-2">
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">Remover</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Bloco>
    </>
  );
}
