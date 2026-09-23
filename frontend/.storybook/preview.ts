import type { Preview } from '@storybook/react-vite';
import { aplicarTema } from '../src/estilos/aplicarTema';
import '../src/estilos/base.css';

// A mesma paleta da aplicação, da mesma fonte. Um Storybook com cores próprias
// mostraria componentes que não existem — bonitos aqui e diferentes lá.
aplicarTema();

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i } },
    backgrounds: {
      options: {
        // Branco predominante, como manda a identidade institucional.
        branco: { name: 'Branco', value: '#FFFFFF' },
        pagina: { name: 'Fundo de página', value: '#F7F9FC' },
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'branco' } },
};

export default preview;
