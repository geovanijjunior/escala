import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Modal } from './Modal';
import { Botao } from '../Botao/Botao';
import { Campo } from '../Campo/Campo';

/**
 * **Finalidade.** Janela sobreposta para confirmação e formulário curto.
 *
 * **Comportamentos.** `Esc` fecha. O clique no fundo fecha, mas só quando
 * COMEÇOU no fundo — sem essa conferência, selecionar texto dentro e soltar o
 * mouse fora fecha a janela e perde o que a pessoa estava escrevendo. E o corpo
 * da página trava a rolagem enquanto está aberto, senão ela "atravessa" o modal
 * e move a página atrás.
 *
 * **Altura.** Limitada à janela, com o corpo rolando por dentro. Sem isso, um
 * modal com muito conteúdo empurra os botões para fora da tela e não há como
 * confirmar nem cancelar.
 */
const meta: Meta<typeof Modal> = { title: 'Componentes/Modal', component: Modal };
export default meta;

type Historia = StoryObj<typeof Modal>;

export const Confirmacao: Historia = {
  render: () => {
    const [aberto, setAberto] = useState(true);
    return (
      <>
        <Botao onClick={() => setAberto(true)}>Abrir</Botao>
        <Modal
          aberto={aberto}
          titulo="Remover equipe"
          aoFechar={() => setAberto(false)}
          acoes={
            <>
              <Botao variante="contorno" onClick={() => setAberto(false)}>Cancelar</Botao>
              <Botao variante="perigo" onClick={() => setAberto(false)}>Remover</Botao>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            A equipe <strong>Equipe Dados</strong> será removida. Esta ação não pode ser desfeita.
          </p>
        </Modal>
      </>
    );
  },
};

export const ComFormulario: Historia = {
  render: () => {
    const [aberto, setAberto] = useState(true);
    return (
      <>
        <Botao onClick={() => setAberto(true)}>Abrir</Botao>
        <Modal
          aberto={aberto}
          titulo="Nova equipe"
          aoFechar={() => setAberto(false)}
          acoes={
            <>
              <Botao variante="contorno" onClick={() => setAberto(false)}>Cancelar</Botao>
              <Botao onClick={() => setAberto(false)}>Adicionar</Botao>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Campo rotulo="Nome da equipe" placeholder="Equipe Dados" />
            <Campo rotulo="Sigla" placeholder="DAD" ajuda="Até quatro letras, usada na grade." />
          </div>
        </Modal>
      </>
    );
  },
};
