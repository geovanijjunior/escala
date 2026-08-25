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
  aberta_pelo_planejamento: '0027_implantacao_pelo_planejamento.sql',
  na_escala: '0019_equipe_fora_da_escala.sql',
  saida: '0020_entrada_saida_e_ciclo.sql',
  minimo: '0021_cota_minima_e_posto_da_equipe.sql',
  feriados: '0002_escalas.sql',
};

/**
 * Cada regra de unicidade do esquema, dita como a pessoa que preenche entende.
 *
 * Mantenha em dia ao criar constraint `unique`: sem entrada aqui, a mensagem cai
 * no nome cru da regra, que não diz qual campo mudar.
 */
const DUPLICADO: Record<string, string> = {
  unidades_conta_id_codigo_key: 'Já existe outra unidade com esse código.',
  equipes_conta_id_codigo_key: 'Já existe outra equipe com esse código.',
  colaboradores_conta_id_matricula_key: 'Já existe outro colaborador com essa matrícula.',
  colaboradores_perfil_uniq: 'Esse usuário do sistema já está vinculado a outro colaborador.',
  feriados_conta_id_data_key: 'Já existe um feriado cadastrado nessa data.',
  postos_unidade_id_nome_key: 'Essa unidade já tem um posto com esse nome.',
  plano_posto_plano_id_posto_id_key: 'Esse posto já está no plano do mês dessa pessoa.',
  planos_colaborador_id_competencia_key: 'Esse colaborador já tem plano nesse mês.',
  pins_colaborador_id_data_key: 'Essa pessoa já tem uma alocação travada nesse dia.',
  alocacoes_geracao_id_colaborador_id_data_key:
    'Essa pessoa já tem alocação nesse dia dentro desta geração.',
  geracoes_conta_id_competencia_versao_key:
    'Já existe uma geração com esse número de versão para o mês.',
  geracoes_atual_uniq: 'Esse mês já tem uma escala marcada como vigente.',
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
    const constraint = texto.match(/unique constraint "([^"]+)"/i)?.[1] ?? '';

    // O nome da regra que barrou é conhecido e finito — vale traduzir cada um.
    // Nem o nome cru (`equipes_conta_id_codigo_key`) nem a lista de colunas do
    // Postgres (`conta_id + codigo`) dizem a quem preenche o formulário qual
    // campo mudar; e `conta_id` sequer aparece na tela.
    if (DUPLICADO[constraint]) return DUPLICADO[constraint];

    // Chave primária: não é erro de preenchimento, é a sequência de ids do
    // banco atrás dos dados — acontece depois de uma carga com ids explícitos.
    if (constraint.endsWith('_pkey') || /_id_conta_id_key$/.test(constraint)) {
      const tabela = constraint.replace(/_pkey$|_id_conta_id_key$/, '');
      return `A sequência de ids de \`${tabela}\` está atrás dos dados já gravados, então o novo `
        + 'registro tentou um id que já existe. Isso não se resolve pelo formulário: rode '
        + `\`select setval(pg_get_serial_sequence('${tabela}','id'), (select max(id) from ${tabela}));\` `
        + 'no SQL Editor.';
    }

    // Último recurso: o Postgres diz o campo em `details`, quando vem.
    const chave = detalhe.match(/Key \(([^)]+)\)=\(([^)]*)\)/i);
    if (chave) {
      const campos = chave[1].split(',').map(c => c.trim()).filter(c => c !== 'conta_id');
      if (campos.length) return `Já existe um registro com ${campos.join(' + ')} = ${chave[2]}. Use outro valor.`;
    }
    return constraint
      ? `Já existe um registro que conflita com este (regra \`${constraint}\`). Revise os campos únicos.`
      : 'Já existe um registro com esse identificador. Use um valor diferente.';
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
