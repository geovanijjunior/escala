import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Figtree tem números de altura uniforme e boa leitura em 11px, que é o tamanho
// da maior parte do texto de apoio aqui.
const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  display: 'swap',
});

// Números que se alinham em coluna — grade do mês, capacidades, horários.
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Jornada — gestão de equipes',
  description:
    'Planejamento de turnos, presença por unidade, home office e solicitações para equipes em regime 12x36 e 5x2.',
};

export const viewport: Viewport = {
  themeColor: '#0B2D5B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${figtree.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}
