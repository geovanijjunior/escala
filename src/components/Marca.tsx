/**
 * A marca Jornada.
 *
 * O símbolo é o "Encaixe": dois quadrados que se encaixam na diagonal sem se
 * sobrepor — presencial e remoto, Morumbi e Paulista. O vão entre eles é a
 * folga. Só isso: dois `<span>` posicionados, sem SVG e sem imagem, porque uma
 * forma feita de CSS escala sem perda, muda de cor por variável e pode ser
 * reproduzida em qualquer material sem abrir um editor.
 *
 * Os raios caem proporcionalmente ao tamanho, e no favicon de 16px somem: um
 * canto de 2px em 5px de bloco vira sujeira, não arredondamento.
 */

interface Props {
  /** Lado da ficha em px. Os blocos e os raios saem daqui. */
  tamanho?: number;
  /** Sobre o azul da marca a ficha precisa clarear, não escurecer. */
  sobreEscuro?: boolean;
}

export function Simbolo({ tamanho = 34, sobreEscuro = false }: Props) {
  // Proporções do lockup de referência: ficha 52 → símbolo 26 → bloco 16, r 5.
  const interno = tamanho * (26 / 52);
  const bloco = interno * (16 / 26);
  const raio = tamanho >= 28 ? Math.round(bloco * 0.31) : tamanho >= 20 ? 2 : 0;

  return (
    <div
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: tamanho >= 40 ? 14 : tamanho >= 24 ? 9 : 5,
        background: sobreEscuro ? 'rgba(255,255,255,.12)' : 'var(--brand-900)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative', width: interno, height: interno }}>
        <span
          style={{
            position: 'absolute', left: 0, top: 0, width: bloco, height: bloco,
            borderRadius: `${raio}px ${raio}px 0 ${raio}px`,
            background: '#FFFFFF',
          }}
        />
        <span
          style={{
            position: 'absolute', right: 0, bottom: 0, width: bloco, height: bloco,
            borderRadius: `${raio}px 0 ${raio}px ${raio}px`,
            background: 'var(--accent-soft)',
          }}
        />
      </div>
    </div>
  );
}

/**
 * Símbolo mais assinatura. O descritor muda conforme o lugar: no console é o
 * nome da conta (é o que distingue duas abas abertas), no app do colaborador é
 * quem está logado.
 */
export function Marca({
  descritor,
  tamanho = 34,
  sobreEscuro = true,
  nome = 'Jornada',
}: Props & { descritor?: string; nome?: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Simbolo tamanho={tamanho} sobreEscuro={sobreEscuro} />
      <div className="leading-none min-w-0">
        <div
          className="font-bold truncate"
          style={{ fontSize: tamanho >= 34 ? 14 : 13.5, letterSpacing: '-.025em' }}
        >
          {nome}
        </div>
        {descritor && (
          <div
            className="mt-1 truncate"
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.15em',
              textTransform: 'uppercase',
              color: sobreEscuro ? 'rgba(255,255,255,.45)' : 'var(--faint)',
            }}
          >
            {descritor}
          </div>
        )}
      </div>
    </div>
  );
}
