-- Jornada — o código de unidade e de equipe passa a ser gerado pelo banco.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- `codigo` nasceu como identificador curto digitado por quem cadastra ("MOR",
-- "TEC"). Na prática ele nunca foi usado para nada que o `id` já não resolvesse:
-- é chave só dentro da conta, não aparece na escala — quem aparece é a `sigla`
-- da unidade — e obrigava a inventar três letras únicas a cada cadastro, com
-- direito a erro de duplicidade quando duas unidades começavam igual.
--
-- Ele continua existindo, e continua `unique (conta_id, codigo)`, porque a
-- importação de colaboradores por planilha aceita achar a equipe e a unidade
-- por ele. O que muda é quem o escreve: agora o banco, a partir do `id`.
--
-- A planilha não perde nada. `importacao.ts` indexa por nome, por código E pela
-- sigla da unidade — quem monta a planilha usa o nome, que é o que a pessoa
-- conhece. Os códigos já gravados ficam como estão: o trigger só age quando o
-- valor chega vazio.

create or replace function preencher_codigo() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `tg_argv[0]` é o prefixo, passado na criação do trigger. Um código vazio
  -- também conta como ausente: o formulário que deixou de ter o campo manda
  -- string vazia, não nulo, dependendo de como o cliente serializa.
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := tg_argv[0] || new.id::text;
  end if;
  return new;
end;
$$;

-- BEFORE INSERT, e não um DEFAULT na coluna: o `id` da identity só existe
-- depois que a tupla é construída, e um DEFAULT não enxerga outra coluna da
-- mesma linha. No BEFORE ROW o `new.id` já está preenchido, e o NOT NULL da
-- coluna é conferido depois do trigger — então a coluna segue obrigatória sem
-- que ninguém precise mandar valor.
drop trigger if exists unidades_codigo on unidades;
create trigger unidades_codigo
  before insert on unidades
  for each row execute function preencher_codigo('U');

drop trigger if exists equipes_codigo on equipes;
create trigger equipes_codigo
  before insert on equipes
  for each row execute function preencher_codigo('E');

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
