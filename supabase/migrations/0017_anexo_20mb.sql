-- Jornada — o anexo do mural vai de 5 MB para 20 MB.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- O conteúdo continua em `bytea`, e não no Storage — ver o comentário da 0011.
-- O teto continua existindo porque é ele que mantém essa escolha honesta: com
-- 20 MB cabem a circular escaneada inteira e a foto em resolução de celular,
-- que é o que de fato se anexa; uma gravação de reunião, não.
--
-- O mesmo número vive em `src/lib/anexos.ts` (LIMITE_BYTES). Os dois precisam
-- andar juntos: com o CHECK menor que o código, o usuário passa pela validação
-- que tem mensagem boa e esbarra num erro de restrição do Postgres.
alter table comunicado_anexos drop constraint if exists comunicado_anexos_tamanho_check;
alter table comunicado_anexos add constraint comunicado_anexos_tamanho_check
  check (tamanho > 0 and tamanho <= 20971520);

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
