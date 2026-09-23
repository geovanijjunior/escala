import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabela, type Coluna } from './Tabela';

interface Pessoa { id: number; nome: string; matricula: string; equipe: string; }

const COLUNAS: Coluna<Pessoa>[] = [
  { chave: 'nome', titulo: 'Pessoa', conteudo: p => p.nome },
  { chave: 'matricula', titulo: 'Matrícula', conteudo: p => p.matricula },
  { chave: 'equipe', titulo: 'Equipe', conteudo: p => p.equipe },
];

const PESSOAS: Pessoa[] = [
  { id: 1, nome: 'Alany Gusmão dos Santos Fontes', matricula: 'DRT90411', equipe: 'Equipe Dados' },
  { id: 2, nome: 'Alex Fructo Enedino de Oliveira', matricula: 'DRT55592', equipe: 'Equipe Dados' },
  { id: 3, nome: 'Renato de Azevedo Junior', matricula: 'DRT31887', equipe: 'Equipe Produto' },
];

/**
 * **Finalidade.** Listagem tabular. As colunas são declaradas com uma função
 * que tira o valor da linha, então trocar o tipo da lista quebra o typecheck em
 * vez de devolver `undefined` na tela.
 *
 * **Estados.** Carregando, vazia e com dados — os três no componente, e não por
 * conta de quem usa. Deixado de fora, o estado vazio é esquecido, e uma tabela
 * sem linhas e sem explicação parece falha de carregamento: quem olha recarrega
 * a página em vez de entender que não há nada ali.
 *
 * **Chave da linha.** `chaveDaLinha` é obrigatória de propósito. Com o índice,
 * o React embaralha as linhas quando a lista reordena, e o que estava
 * selecionado passa a ser outra pessoa.
 */
const meta: Meta<typeof Tabela<Pessoa>> = {
  title: 'Componentes/Tabela',
  component: Tabela,
  args: { colunas: COLUNAS, itens: PESSOAS, chaveDaLinha: (p: Pessoa) => p.id },
};
export default meta;

type Historia = StoryObj<typeof Tabela<Pessoa>>;

export const ComDados: Historia = {};

export const Carregando: Historia = { args: { carregando: true, itens: [] } };

export const Vazia: Historia = {
  args: { itens: [], vazio: 'Nenhum colaborador nesta equipe. Importe a planilha para começar.' },
};
