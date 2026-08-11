/**
 * Cliente Supabase falso, apoiado no Postgres local — só para tirar as fotos do
 * manual.
 *
 * Não é um emulador de PostgREST: implementa exatamente o subconjunto que este
 * app usa, e QUEBRA ALTO em qualquer coisa fora dele. Um emulador silencioso e
 * incompleto produziria telas sutilmente erradas, que é o pior resultado
 * possível para um manual — a pessoa confia na imagem.
 *
 * Ele existe porque o Supabase de verdade precisa de Docker, indisponível aqui.
 * Vive em scripts/, nunca em src/, e o app só o enxerga durante a captura.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

// `date` volta como Date e vira UTC ao serializar, deslocando o dia. O domínio
// inteiro trata data como texto ISO; devolver texto mantém isso.
pg.types.setTypeParser(1082, v => v);

// `timestamp`/`timestamptz` também: o PostgREST entrega texto ISO, e o app faz
// `.slice(0, 10)` em cima. Um Date aqui quebraria a tela — mas por culpa do
// shim, não do app. Só falta trocar o espaço pelo `T` que o Postgres não põe.
pg.types.setTypeParser(1114, v => v.replace(' ', 'T'));
pg.types.setTypeParser(1184, v => v.replace(' ', 'T'));

// `bigint` e `numeric` viram string no node-pg, para não perder precisão. O
// PostgREST os serializa como número JSON, e o app compara `unidade_id` com uma
// lista de números — com string, a comparação falha calada e a tela acusa
// "unidade que não existe mais". Nenhum id aqui chega perto de 2^53.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});

const cita = nome => '"' + String(nome).replace(/"/g, '') + '"';

/**
 * Chaves estrangeiras de uma coluna só, lidas do catálogo.
 *
 * A primeira versão adivinhava a coluna de ligação por convenção — tirava o `s`
 * do nome da tabela e colava `_id`. Em português isso produz `colaboradore_id`
 * e `solicitacoe_id`, que não existem, e a tela vinha vazia. Perguntar ao banco
 * custa uma consulta na subida e acerta sempre, inclusive quando há duas FKs
 * para a mesma tabela (solicitações apontam para colaboradores duas vezes:
 * quem pediu e o parceiro da troca) — aí a dica `!nome_da_constraint` escolhe.
 *
 * Das FKs compostas `(id, conta_id)` da migration 0009 interessa só a coluna
 * que aponta para `id` — a outra existe para barrar vínculo entre contas.
 */
let fks = null;
async function carregarFks() {
  if (fks) return fks;
  const { rows } = await pool.query(`
    select con.conname, filho.relname as filho, pai.relname as pai, att.attname as coluna
    from pg_constraint con
    join pg_class filho on filho.oid = con.conrelid
    join pg_class pai   on pai.oid   = con.confrelid
    cross join lateral unnest(con.conkey, con.confkey) as par(local, referida)
    join pg_attribute att on att.attrelid = con.conrelid   and att.attnum = par.local
    join pg_attribute ref on ref.attrelid = con.confrelid  and ref.attnum = par.referida
    where con.contype = 'f' and ref.attname = 'id'`);
  fks = rows;
  return fks;
}

/**
 * Colunas `json`/`jsonb`, por tabela.
 *
 * Sem isso, um `[]` vindo do app era enviado como literal de array do Postgres
 * (`{}`), que a coluna jsonb aceita — e passa a ler como OBJETO vazio. A tela
 * de geração então quebrava com "conflitos is not iterable", e o erro parecia
 * do app. Adivinhar pelo valor não resolve: `[]` é ambíguo.
 */
let colunasJson = null;
async function carregarColunasJson() {
  if (colunasJson) return colunasJson;
  const { rows } = await pool.query(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and data_type in ('json', 'jsonb')`);
  colunasJson = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
  return colunasJson;
}

/** Quebra "a, b(c, d(e)), f" em ["a", "b(c, d(e))", "f"] sem cair no parêntese. */
function partir(spec) {
  const partes = [];
  let profundidade = 0, atual = '';
  for (const ch of spec.replace(/\s+/g, ' ')) {
    if (ch === '(') profundidade++;
    if (ch === ')') profundidade--;
    if (ch === ',' && profundidade === 0) { partes.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes.filter(Boolean);
}

/**
 * Traduz o `select` do PostgREST em pares nome→expressão. Recursivo, porque
 * embed dentro de embed é usado no sino de notificações.
 */
function campos(tabela, spec, ap, ctx) {
  if (!spec || spec === '*') return [{ nome: '*', expr: `${ap}.*` }];

  return partir(spec).map(parte => {
    const embed = parte.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\(([\s\S]*)\)$/);
    if (!embed) return parte === '*'
      ? { nome: '*', expr: `${ap}.*` }
      : { nome: parte, expr: `${ap}.${cita(parte)}` };

    const [, apelido, alvo, dica, dentro] = embed;
    const f = 'f' + ++ctx.n;
    const casa = k => !dica || k.conname === dica;

    // Muitos-para-um (a FK está na tabela de origem) vira objeto; um-para-muitos
    // vira array. É a mesma distinção que o PostgREST faz.
    const paraUm = fks.find(k => k.filho === tabela && k.pai === alvo && casa(k));
    const paraMuitos = fks.find(k => k.filho === alvo && k.pai === tabela && casa(k));
    if (!paraUm && !paraMuitos) {
      throw new Error(`sem chave estrangeira de uma coluna entre "${tabela}" e "${alvo}"` +
        (dica ? ` com a constraint "${dica}"` : ''));
    }

    const objeto = `json_build_object(${campos(alvo, dentro, f, ctx)
      .map(c => `'${c.nome}', ${c.expr}`).join(', ')})`;

    return {
      nome: apelido || alvo,
      expr: paraUm
        ? `(select ${objeto} from ${cita(alvo)} ${f} where ${f}.id = ${ap}.${cita(paraUm.coluna)})`
        : `(select coalesce(json_agg(${objeto}), '[]'::json) from ${cita(alvo)} ${f}` +
          ` where ${f}.${cita(paraMuitos.coluna)} = ${ap}.id)`,
    };
  });
}

function montaSelect(tabela, spec) {
  return campos(tabela, spec, 'p', { n: 0 })
    .map(c => (c.nome === '*' ? c.expr : `${c.expr} as ${cita(c.nome)}`))
    .join(', ');
}

class Consulta {
  constructor(tabela, admin = false) {
    this.tabela = tabela;
    this.admin = admin;
    this.colunas = '*';
    this.onde = [];
    this.valores = [];
    this.ordem = [];
    this.limite = null;
    this.deslocamento = null;
    this.acao = 'select';
    this.dados = null;
    this.contando = false;
    this.somenteCabeca = false;
  }

  /**
   * Registra um valor e devolve o `$n`. Quando a coluna de destino é json/jsonb,
   * serializa — o PostgREST manda JSON, o node-pg mandaria literal de array.
   */
  _p(v, coluna) {
    const ehJson = coluna && colunasJson?.has(`${this.tabela}.${coluna}`);
    this.valores.push(ehJson && v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
    return '$' + this.valores.length;
  }

  select(spec, opcoes = {}) {
    if (opcoes.count) this.contando = true;
    if (opcoes.head) this.somenteCabeca = true;
    if (this.acao === 'select') this.colunas = spec ?? '*';
    // Depois de insert/update, `.select()` é o que faz o PostgREST devolver a
    // linha. Sem esse pedido ele manda `Prefer: return=minimal` e não há
    // RETURNING nenhum — distinção que importa sob RLS, porque ler a linha
    // recém-inserida passa pela policy de SELECT, não pela de INSERT.
    this.querRetorno = true;
    return this;
  }

  eq(col, val) { this.onde.push(`${cita(col)} = ${this._p(val)}`); return this; }
  neq(col, val) { this.onde.push(`${cita(col)} is distinct from ${this._p(val)}`); return this; }
  gte(col, val) { this.onde.push(`${cita(col)} >= ${this._p(val)}`); return this; }
  lte(col, val) { this.onde.push(`${cita(col)} <= ${this._p(val)}`); return this; }
  gt(col, val) { this.onde.push(`${cita(col)} > ${this._p(val)}`); return this; }
  lt(col, val) { this.onde.push(`${cita(col)} < ${this._p(val)}`); return this; }
  in(col, vals) { this.onde.push(`${cita(col)} = any(${this._p(vals)})`); return this; }
  is(col, val) { this.onde.push(`${cita(col)} is ${val === null ? 'null' : val}`); return this; }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col, o = {}) { this.ordem.push(`${cita(col)} ${o.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this.limite = n; return this; }
  range(de, ate) { this.deslocamento = de; this.limite = ate - de + 1; return this; }
  single() { this.umSo = 'obrigatorio'; this.querRetorno = true; return this; }
  maybeSingle() { this.umSo = 'opcional'; this.querRetorno = true; return this; }

  insert(dados) { this.acao = 'insert'; this.dados = Array.isArray(dados) ? dados : [dados]; return this; }
  update(dados) { this.acao = 'update'; this.dados = dados; return this; }
  upsert(dados, o = {}) { this.acao = 'upsert'; this.conflito = o.onConflict; this.dados = Array.isArray(dados) ? dados : [dados]; return this; }
  delete() { this.acao = 'delete'; return this; }

  _sql() {
    // Memoizado porque montar tem efeito colateral: cada `$n` é criado
    // empilhando em `this.valores`. `_sql()` é chamado duas vezes — na execução
    // e no log de erro —, e sem o cache a segunda chamada duplicava os valores
    // e deslocava os índices, gravando a linha com os campos trocados. O erro
    // resultante (RLS, tipo errado) parecia do app e não era.
    if (this._cache) return this._cache;
    const filtro = this.onde.length ? ' where ' + this.onde.join(' and ') : '';

    if (this.acao === 'select') {
      if (this.contando && this.somenteCabeca) return (this._cache = `select count(*)::int as n from ${cita(this.tabela)}${filtro}`);
      const cols = montaSelect(this.tabela, this.colunas);
      let s = `select ${cols} from ${cita(this.tabela)} p${filtro.replace(/"(\w+)"/g, 'p."$1"')}`;
      if (this.ordem.length) s += ' order by ' + this.ordem.map(o => 'p.' + o).join(', ');
      if (this.limite !== null) s += ` limit ${this.limite}`;
      if (this.deslocamento) s += ` offset ${this.deslocamento}`;
      return (this._cache = s);
    }

    if (this.acao === 'insert' || this.acao === 'upsert') {
      const chaves = [...new Set(this.dados.flatMap(Object.keys))];
      const linhas = this.dados.map(d => '(' + chaves.map(k => this._p(d[k] ?? null, k)).join(', ') + ')');
      let s = `insert into ${cita(this.tabela)} (${chaves.map(cita).join(', ')}) values ${linhas.join(', ')}`;
      if (this.acao === 'upsert' && this.conflito) {
        const alvo = this.conflito.split(',').map(c => cita(c.trim())).join(', ');
        s += ` on conflict (${alvo}) do update set ` + chaves.map(k => `${cita(k)} = excluded.${cita(k)}`).join(', ');
      }
      return (this._cache = s + (this.querRetorno ? ' returning *' : ''));
    }

    if (this.acao === 'update') {
      const sets = Object.entries(this.dados).map(([k, v]) => `${cita(k)} = ${this._p(v, k)}`).join(', ');
      return (this._cache = `update ${cita(this.tabela)} set ${sets}${filtro}${this.querRetorno ? ' returning *' : ''}`);
    }

    return (this._cache = `delete from ${cita(this.tabela)}${filtro}${this.querRetorno ? ' returning *' : ''}`);
  }

  async then(resolver) {
    await carregarFks();
    await carregarColunasJson();
    const conexao = await pool.connect();
    try {
      const sql = this._sql();
      // Cada consulta roda numa transação com `role` e `auth.uid()` da pessoa
      // logada. Sem isso o shim consultaria como superusuário, o RLS não valeria
      // nada e as fotos do papel "colaborador" mostrariam a empresa inteira —
      // exatamente o erro que um manual não pode conter. Com `set local`, o
      // ajuste morre no commit e não vaza para a próxima conexão do pool.
      await conexao.query('begin');
      await conexao.query(`set local role ${this.admin ? 'postgres' : 'app_user'}`);
      await conexao.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuarioAtual().id]);
      const { rows } = await conexao.query(sql, this.valores);
      await conexao.query('commit');
      if (this.contando && this.somenteCabeca) return resolver({ data: null, count: rows[0].n, error: null });
      if (this.umSo) {
        if (rows.length === 0) {
          return resolver(this.umSo === 'opcional'
            ? { data: null, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'Nenhuma linha' } });
        }
        return resolver({ data: rows[0], error: null });
      }
      return resolver({ data: rows, count: rows.length, error: null });
    } catch (e) {
      await conexao.query('rollback').catch(() => {});
      // Nada de falha silenciosa: uma consulta não suportada tem de aparecer.
      // `_sql()` é o que costuma estourar aqui, então o texto da consulta entra
      // com rede: sem isso o log da falha falharia, escondendo a falha original.
      let sql = '(a própria montagem do SQL falhou)';
      try { sql = this._sql(); } catch { /* fica o texto acima */ }
      console.error('\n[supabase-pg] consulta não suportada ou inválida:\n ', e.message, '\n ', sql, '\n');
      return resolver({ data: null, error: { message: e.message, code: e.code } });
    } finally {
      conexao.release();
    }
  }
}

/**
 * Usuário da sessão. Vem de um arquivo, e não de uma variável de ambiente,
 * porque o roteiro de captura troca de papel no meio da execução — por env
 * seria preciso derrubar e subir o dev server a cada troca.
 */
const ARQUIVO_USUARIO = process.env.FOTO_USUARIO_ARQUIVO || '/tmp/foto-usuario.json';
const PADRAO = { id: '00000000-0000-0000-0000-000000000001', email: 'ana.ribeiro@saolucas.com' };

function usuarioAtual() {
  try {
    return JSON.parse(readFileSync(ARQUIVO_USUARIO, 'utf8'));
  } catch {
    return PADRAO;
  }
}

function cliente(admin = false) {
  return {
    from: t => new Consulta(t, admin),
    auth: {
      getUser: async () => ({ data: { user: usuarioAtual() }, error: null }),
      getSession: async () => ({ data: { session: { user: usuarioAtual() } }, error: null }),
      signInWithPassword: async () => ({ data: { user: usuarioAtual() }, error: null }),
      signUp: async () => ({ data: { user: usuarioAtual(), session: {} }, error: null }),
      signOut: async () => ({ error: null }),
      admin: {
        createUser: async () => ({ data: { user: usuarioAtual() }, error: null }),
        updateUserById: async () => ({ data: { user: usuarioAtual() }, error: null }),
      },
    },
  };
}

export async function createClient() { return cliente(false); }
export function createAdminClient() { return cliente(true); }
