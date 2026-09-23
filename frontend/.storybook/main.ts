import type { StorybookConfig } from '@storybook/react-vite';

/**
 * O Storybook é obrigatório pelo padrão de infraestrutura, e serve a um
 * propósito concreto: é onde se vê o componente em todos os estados sem
 * precisar montar o cenário na aplicação. O estado de erro de um campo, ou uma
 * tabela vazia, custa cinco cliques e um dado inventado para reproduzir na
 * tela real — e por isso quase nunca é conferido.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
