/**
 * Mostrado enquanto a próxima tela busca os dados no servidor.
 *
 * Sem este arquivo o Next segura a navegação inteira: o clique não produz nada
 * visível e a tela anterior fica congelada até a nova terminar de montar, o que
 * se lê como travamento. Com ele, o menu lateral responde na hora e só a área
 * de conteúdo espera — a navegação passa a parecer instantânea mesmo quando a
 * consulta demora igual.
 */
export default function Carregando() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5">
      <span className="sr-only">Carregando…</span>

      <div className="space-y-2">
        <div className="esc-esqueleto h-[18px] w-48" />
        <div className="esc-esqueleto h-[12px] w-72" />
      </div>

      {[0, 1].map(bloco => (
        <div key={bloco} className="esc-card overflow-hidden">
          <div className="px-4 py-3.5 border-b space-y-2" style={{ borderColor: 'var(--line)' }}>
            <div className="esc-esqueleto h-[13px] w-40" />
            <div className="esc-esqueleto h-[11px] w-64" />
          </div>
          <div className="px-4 py-3 space-y-2.5">
            {[0, 1, 2, 3].map(linha => (
              <div key={linha} className="flex gap-3">
                <div className="esc-esqueleto h-[13px] flex-[3]" />
                <div className="esc-esqueleto h-[13px] flex-[2]" />
                <div className="esc-esqueleto h-[13px] flex-1" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
