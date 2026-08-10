-- Escala — sub-unidades: um posto dentro de uma unidade física.
--
-- O caso que motivou: no Morumbi, um técnico fica no Corpo Clínico dando
-- suporte aos médicos. Ele não está em outro prédio — está no Morumbi, num
-- posto específico. Tratar Corpo Clínico como unidade irmã do Morumbi mentiria
-- na conta: o Morumbi apareceria com um lugar livre que não existe.
--
-- Por isso a hierarquia é rasa e a ocupação sobe para o pai. Quem está numa
-- sub-unidade ocupa lugar nela E na unidade que a contém.

alter table unidades
  add column if not exists pai_id bigint references unidades(id) on delete restrict;

create index if not exists unidades_pai_idx on unidades(pai_id);

-- Um nível só. Sub-unidade de sub-unidade transformaria a soma de capacidade
-- numa árvore, e nada no domínio pede isso: um posto pertence a um prédio.
create or replace function checa_hierarquia_unidade() returns trigger
language plpgsql as $$
begin
  if new.pai_id is null then
    -- Virar raiz é sempre permitido; deixar de ser pai, não, se houver filhos.
    return new;
  end if;

  if new.pai_id = new.id then
    raise exception 'Uma unidade não pode ser sub-unidade de si mesma.';
  end if;

  if exists (select 1 from unidades u where u.id = new.pai_id and u.pai_id is not null) then
    raise exception 'Sub-unidade só pode pertencer a uma unidade principal, não a outra sub-unidade.';
  end if;

  if exists (select 1 from unidades u where u.pai_id = new.id) then
    raise exception 'Esta unidade já tem sub-unidades e por isso não pode virar sub-unidade de outra.';
  end if;

  if exists (select 1 from unidades u where u.id = new.pai_id and u.conta_id <> new.conta_id) then
    raise exception 'A unidade principal precisa ser da mesma conta.';
  end if;

  return new;
end;
$$;

drop trigger if exists unidades_hierarquia on unidades;
create trigger unidades_hierarquia
  before insert or update of pai_id on unidades
  for each row execute function checa_hierarquia_unidade();
