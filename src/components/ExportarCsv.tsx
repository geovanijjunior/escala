'use client';

/**
 * Exportação em CSV gerada no navegador.
 *
 * Separador `;` e BOM UTF-8 são deliberados: é o que o Excel em português abre
 * sem embaralhar acento e sem jogar a linha inteira numa coluna só.
 */
export function ExportarCsv({
  linhas, nomeArquivo, rotulo = 'Exportar CSV',
}: { linhas: string[][]; nomeArquivo: string; rotulo?: string }) {
  const baixar = () => {
    const escapar = (v: string) => {
      const t = String(v ?? '');
      return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = linhas.map(l => l.map(escapar).join(';')).join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button type="button" onClick={baixar} className="esc-btn esc-btn-outline esc-btn-sm">
      {rotulo}
    </button>
  );
}
