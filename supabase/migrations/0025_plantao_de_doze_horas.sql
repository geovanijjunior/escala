-- Jornada — o plantão 12x36 volta a durar doze horas.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- O que estava errado
-- ══════════════════════════════════════════════════════════════
-- Antes da 0020 o fim do turno era calculado como `entrada + jornada + 1h`
-- sempre que a jornada passasse de seis horas, em quatro telas diferentes. A
-- regra vale para o 5x2 — oito horas de trabalho mais uma de almoço fecham um
-- expediente de nove — e NÃO vale para o 12x36, onde o intervalo acontece
-- dentro do plantão. O 12x36 é um turno de doze horas de ponta a ponta.
--
-- Resultado: quem entrava às 19:00 aparecia saindo às 08:00, e não às 07:00. O
-- plantão exibido tinha treze horas. A 0020 foi escrita para PRESERVAR o que a
-- tela mostrava, e por isso carregou o erro para dentro do dado.
--
-- A 0020 já está corrigida para quem instalar de agora em diante. Esta
-- migration é para quem rodou a versão anterior dela.
--
-- ══════════════════════════════════════════════════════════════
-- O que esta migration faz
-- ══════════════════════════════════════════════════════════════
-- Tira uma hora da saída dos colaboradores 12x36 cujo turno hoje mede
-- exatamente treze horas — que é a assinatura do backfill errado. Um plantão de
-- doze horas já está certo e não é tocado; qualquer outra duração foi digitada
-- por alguém e também fica como está.
--
-- É essa condição que torna a migration repetível: depois de rodar, nenhum
-- 12x36 mede treze horas, então a segunda passada não acha o que mudar.
--
-- A conta é feita em minutos, com volta na meia-noite, porque o turno noturno
-- atravessa o dia: de 19:00 a 08:00 são treze horas, e uma subtração direta de
-- `time` daria menos onze.
do $$
declare
  ajustados int;
begin
  with medidos as (
    select id,
           ((extract(epoch from saida::time) - extract(epoch from entrada::time))::int / 60 + 1440) % 1440
             as minutos
      from colaboradores
     where regime = '12x36'
  )
  update colaboradores c
     set saida = to_char(c.saida::time - interval '1 hour', 'HH24:MI')
    from medidos m
   where m.id = c.id
     and m.minutos = 13 * 60;

  get diagnostics ajustados = row_count;
  raise notice 'plantao 12x36: % colaborador(es) ajustado(s) de 13h para 12h', ajustados;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho. Aqui não houve DDL,
-- mas a linha fica para o caso de esta migration ser reaplicada junto das
-- outras — repetir o aviso não custa nada.
notify pgrst, 'reload schema';
