import type { Meta, StoryObj } from '@storybook/react-vite';
import { Campo } from './Campo';

/**
 * **Finalidade.** Entrada de texto com rótulo, apoio e erro — o tijolo de todo
 * formulário.
 *
 * **Acessibilidade.** O `id` é gerado e ligado ao `<label>`; o erro entra com
 * `aria-invalid` e `role="alert"`. Sem esse par, clicar no rótulo não foca o
 * campo e o leitor de tela anuncia "campo de edição" sem dizer de quê — e nada
 * na tela denuncia o problema.
 *
 * **Estados.** Normal, com ajuda, com erro, desabilitado. O texto de ajuda some
 * quando há erro: dois textos sob o mesmo campo competem pela atenção, e o que
 * importa é o erro.
 */
const meta: Meta<typeof Campo> = {
  title: 'Componentes/Campo',
  component: Campo,
  args: { rotulo: 'Matrícula', placeholder: 'DRT00000' },
  parameters: { layout: 'centered' },
  decorators: [Historia => <div style={{ width: 320 }}><Historia /></div>],
};
export default meta;

type Historia = StoryObj<typeof Campo>;

export const Normal: Historia = {};

export const ComAjuda: Historia = {
  args: { ajuda: 'A matrícula é a identidade da pessoa na importação.' },
};

export const ComErro: Historia = {
  args: { defaultValue: '123', erro: 'Essa matrícula já pertence a outro colaborador.' },
};

export const Desabilitado: Historia = {
  args: { disabled: true, defaultValue: 'DRT90411', ajuda: 'Matrícula não muda depois de criada.' },
};
