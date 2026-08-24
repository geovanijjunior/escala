import { redirect } from 'next/navigation';
import { competenciaDaBusca, texto, type Busca } from '@/lib/pagina';

/**
 * Rota antiga dos planos do mês, agora a primeira etapa de `/gerar`.
 *
 * Revisar o plano nunca foi um destino em si: é o que se faz antes de gerar a
 * escala, e ter as duas coisas em telas separadas escondia essa ordem. A
 * página foi para dentro do fluxo, e esta rota continua existindo só para não
 * quebrar links guardados, favoritos e o histórico do navegador.
 *
 * O mês e o colaborador em edição são preservados na volta: quem tinha aberto
 * o plano de alguém cai exatamente nele, e não numa lista genérica.
 */
export default async function PlanosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const parametros = new URLSearchParams({
    competencia: competenciaDaBusca(busca),
    etapa: 'plano',
  });

  const colab = texto(busca, 'colab');
  if (colab) parametros.set('colab', colab);

  redirect(`/gerar?${parametros}`);
}
