/**
 * Traduz erros do PostgREST/Postgres para português, dizendo o que fazer.
 *
 * O caso que motivou: salvar uma unidade devolvia "Could not find the 'pai_id'
 * column of 'unidades' in the schema cache". O sistema sabia exatamente o que
 * faltava — uma migration não aplicada — e mesmo assim repassou o texto cru,
 * em inglês, obrigando quem lê a saber o que é schema cache do PostgREST.
 */

/**
 * De onde vem cada coisa que o app usa mas pode não existir ainda no banco.
 * Mantenha em dia ao criar migrations: é o que transforma um erro opaco numa
 * instrução exata.
 */
const ORIGEM: Record<string, string> = {
  pai_id: '0004_subunidades.sql',
  cotas_equipe: '0003_cota_equipe.sql',
  capacidades: '0002_escalas.sql',
  unidades: '0002_escalas.sql',
  perfis: '0001_init.sql',
  contas: '0001_init.sql',
};

function ondeMora(nome: string): string {
  const arquivo = ORIGEM[nome];
  return arquivo
    ? `Rode a migration \`supabase/migrations/${arquivo}\` no SQL Editor do Supabase.`
    : 'Rode as migrations pendentes de `supabase/migrations/` no SQL Editor do Supabase, na ordem numérica.';
}

/** Aceita o erro do supabase-js, ou qualquer coisa com `code`/`message`. */
export function mensagemErroBanco(
  erro: { code?: string; message?: string; details?: string | null } | null | undefined,
): string {
  if (!erro) return 'Não foi possível concluir. Tente de novo.';
  const texto = erro.message ?? '';
  const detalhe = erro.details ?? '';

  // PGRST204 — coluna ausente no cache de esquema do PostgREST.
  const coluna = texto.match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (coluna) {
    return `O banco desta instalação ainda não tem a coluna \`${coluna[1]}\` em \`${coluna[2]}\`. ${ondeMora(coluna[1])} Se você acabou de rodar, execute \`notify pgrst, 'reload schema';\` para atualizar o cache.`;
  }

  // PGRST205 — tabela ausente.
  const tabela = texto.match(/Could not find the table '(?:public\.)?([^']+)'/i);
  if (tabela) {
    return `O banco desta instalação ainda não tem a tabela \`${tabela[1]}\`. ${ondeMora(tabela[1])} Se você acabou de rodar, execute \`notify pgrst, 'reload schema';\` para atualizar o cache.`;
  }

  const faltante = texto.match(/relation "([^"]+)" does not exist|column "([^"]+)" does not exist/i);
  if (faltante) {
    const nome = faltante[1] ?? faltante[2] ?? '';
    return `O banco desta instalação não tem \`${nome}\`. ${ondeMora(nome)}`;
  }

  if (/duplicate key value|already exists/i.test(texto)) {
    // O Postgres diz exatamente qual campo colidiu, em `details`:
    // "Key (codigo)=(MOR) already exists." Mandar sempre "use um código ou
    // sigla diferente" jogava a pessoa no campo errado quando a colisão era de
    // matrícula, de data de feriado ou da chave primária.
    const chave = detalhe.match(/Key \(([^)]+)\)=\(([^)]*)\)/i);
    if (chave) {
      const campos = chave[1].split(',').map(c => c.trim()).join(' + ');
      return `Já existe um registro com ${campos} = ${chave[2]}. Use outro valor.`;
    }
    // Sem `details`, o nome da constraint ainda diz a tabela e, quase sempre,
    // a coluna: `unidades_codigo_key`, `colaboradores_matricula_key`.
    const constraint = texto.match(/unique constraint "([^"]+)"/i);
    if (constraint?.[1].endsWith('_pkey')) {
      return `A chave primária de \`${constraint[1].replace(/_pkey$/, '')}\` colidiu. `
        + 'Isso acontece quando a sequência de ids do banco está atrás dos dados já gravados — '
        + 'normalmente depois de uma carga com ids explícitos.';
    }
    if (constraint) return `Já existe um registro com esse valor (\`${constraint[1]}\`). Use outro.`;
    return 'Já existe um registro com esse identificador. Use um valor diferente.';
  }
  if (/violates foreign key constraint/i.test(texto)) {
    return 'O registro está em uso por outros dados e não pode ser removido ou alterado assim.';
  }
  if (/violates row-level security/i.test(texto)) {
    return 'Você não tem permissão para essa alteração nesta conta.';
  }
  if (/violates check constraint/i.test(texto)) {
    return 'Algum valor está fora do permitido para este campo. Revise os números informados.';
  }
  // Exceções levantadas pelos nossos triggers já vêm em português e explicadas.
  if (/sub-unidade|unidade principal|não pode ser sub-unidade/i.test(texto)) return texto;

  return texto ? `Erro do banco: ${texto}` : 'Não foi possível concluir. Tente de novo.';
}
