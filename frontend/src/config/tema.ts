/**
 * A paleta e as medidas da interface, num lugar só.
 *
 * O padrão de infraestrutura pede a paleta centralizada, e o motivo aparece
 * quando alguém precisa mudá-la: cor escrita direto no componente vira uma
 * caça a `#1A4E93` por quarenta arquivos, e o que escapa não dá erro — fica
 * um botão da cor antiga, que ninguém vê até a apresentação.
 *
 * As cores seguem a orientação institucional: branco predominante, azul
 * escuro como principal, azul claro como complementar.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ATENÇÃO — os valores abaixo vieram do protótipo que já está no ar e  │
 * │ NÃO passaram por validação de marca. O padrão diz explicitamente que │
 * │ a governança visual não substitui essa validação. Antes de produção, │
 * │ confirme os hexadecimais com quem responde pela identidade visual e  │
 * │ troque aqui — é o único lugar que precisa mudar.                     │
 * └──────────────────────────────────────────────────────────────────────┘
 */

export const cores = {
  /** Azul escuro: logo, botões principais, navegação e destaques. */
  primaria: '#1A4E93',
  primariaEscura: '#123C74',
  primariaMaisEscura: '#0B2D5B',
  /** Azul claro: contraste, estados e elementos secundários. */
  primariaClara: '#DCEAF8',
  primariaMaisClara: '#F0F6FD',
  /** Ação e foco — separado da marca porque marca e ação não são a mesma coisa. */
  acao: '#2463B5',

  /** Branco predominante, como manda a identidade. */
  fundo: '#FFFFFF',
  superficie: '#FFFFFF',
  fundoDaPagina: '#F7F9FC',

  texto: '#16202E',
  textoSuave: '#5A6B80',
  textoTenue: '#93A1B2',
  borda: '#E2E8F0',

  /**
   * Estados. Não são cor de marca: são semáforo, e trocá-los por tons de azul
   * para "ficar bonito" apaga a única diferença entre confirmação e erro para
   * quem lê rápido.
   */
  erro: '#BE123C',
  erroFundo: '#FFE4E9',
  sucesso: '#15803D',
  sucessoFundo: '#DCFCE7',
  atencao: '#B45309',
  atencaoFundo: '#FEF3C7',
} as const;

export const espacos = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

export const tipografia = {
  familia: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** Tamanhos em px, como a interface os usa. */
  minusculo: 11,
  pequeno: 12.5,
  corpo: 14,
  titulo: 17,
  destaque: 22,
} as const;

export const raios = { sm: '4px', md: '8px', lg: '12px' } as const;

export const sombras = {
  cartao: '0 1px 2px rgba(16, 32, 46, 0.06), 0 1px 3px rgba(16, 32, 46, 0.04)',
  flutuante: '0 8px 24px rgba(16, 32, 46, 0.14)',
} as const;

/**
 * As mesmas cores como variáveis CSS, aplicadas no `:root`.
 *
 * Existe porque nem tudo é estilo em linha: pseudo-classes (`:hover`,
 * `:focus-visible`), media queries e o CSS de base precisam das cores, e não
 * alcançam o objeto acima. Uma segunda lista escrita à mão divergiria da
 * primeira no primeiro ajuste; esta é gerada da mesma fonte.
 */
export function variaveisCss(): string {
  const linhas = Object.entries(cores).map(([nome, valor]) => `  --${paraTracos(nome)}: ${valor};`);
  return `:root {\n${linhas.join('\n')}\n}`;
}

const paraTracos = (s: string) => s.replace(/[A-Z]/g, letra => `-${letra.toLowerCase()}`);
