import type { Meta, StoryObj } from '@storybook/react-vite';
import { MdAdd, MdDelete } from 'react-icons/md';
import { Botao } from './Botao';

/**
 * **Finalidade.** A ação clicável da interface. Toda ação passa por aqui — um
 * `<button>` solto em alguma tela sai da paleta e do tamanho, e a diferença só
 * aparece quando alguém compara duas telas lado a lado.
 *
 * **Comportamentos.** Nasce `type="button"`, e não `submit`: dentro de um
 * formulário, o padrão do HTML faria um botão auxiliar enviar tudo sem que
 * ninguém pedisse. Em `carregando`, ele se desabilita sozinho — sem isso, o
 * segundo clique repete a ação e o servidor grava duas vezes.
 *
 * **Quando usar cada variante.** `primario` é a ação principal, uma por tela;
 * `contorno` para as secundárias; `discreto` para ações de linha de tabela;
 * `perigo` só para o que destrói algo.
 */
const meta: Meta<typeof Botao> = {
  title: 'Componentes/Botao',
  component: Botao,
  args: { children: 'Salvar' },
  argTypes: {
    variante: { control: 'inline-radio', options: ['primario', 'contorno', 'discreto', 'perigo'] },
    tamanho: { control: 'inline-radio', options: ['normal', 'pequeno'] },
  },
};
export default meta;

type Historia = StoryObj<typeof Botao>;

export const Primario: Historia = {};

export const Variantes: Historia = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Botao>Primário</Botao>
      <Botao variante="contorno">Contorno</Botao>
      <Botao variante="discreto">Discreto</Botao>
      <Botao variante="perigo" icone={<MdDelete size={15} />}>Remover</Botao>
    </div>
  ),
};

export const ComIcone: Historia = {
  args: { icone: <MdAdd size={15} />, children: 'Adicionar colaborador' },
};

/** Trava e troca o rótulo. É o estado de toda ação que fala com o servidor. */
export const Carregando: Historia = { args: { carregando: true } };

export const Desabilitado: Historia = { args: { disabled: true } };

export const Pequeno: Historia = { args: { tamanho: 'pequeno', variante: 'contorno', children: 'Editar' } };
