# Escala

Sistema de gestão de escalas de trabalho para equipes em regime **12x36** e
**5x2**: planejamento mensal, presença distribuída entre unidades físicas, home
office, férias e ausências, e um fluxo de solicitações com triagem, lista de
espera e aprovação.

Construído a partir de um protótipo React de tela única. Aqui o motor de geração
roda no servidor, o dado é persistido e o recorte por papel é garantido no
banco.

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack)
- **Supabase** — Postgres, Auth e Row Level Security
- **Tailwind CSS v4** — tema claro corporativo, Inter + IBM Plex Mono

## Experimente antes de instalar

[`docs/prototipo-escalas.html`](docs/prototipo-escalas.html) é um arquivo único
que abre no navegador com dois cliques, sem banco e sem servidor. Carrega 60
colaboradores de exemplo em duas unidades e roda o **mesmo motor de geração**
deste repositório, transliterado para JavaScript — as alocações que aparecem ali
são calculadas de verdade.

Dá para trocar o perfil de acesso no canto superior direito e percorrer as três
experiências, simular e gravar uma geração, publicar a escala, travar alocações,
editar planos e levar uma solicitação da triagem até a aprovação. Nada é
persistido: recarregar a página devolve tudo ao estado inicial.

Ele não reproduz o isolamento entre contas nem o recorte por papel via RLS (sem
banco, isso vira filtro de tela), nem o histórico de versões de geração.

## Papéis

Um perfil tem exatamente um papel, e ele é a única dimensão de permissão:

| Papel | Vê | Pode |
|---|---|---|
| **Planejamento** | Toda a conta | Configurar parâmetros, editar planos, gerar/publicar/encerrar a escala, fazer a triagem das solicitações, travar alocações |
| **Gestor** | Só as equipes que gerencia | Acompanhar escala e indicadores da equipe, aprovar/recusar o que chega até ele, lançar ocorrências |
| **Colaborador** | Só a si mesmo | Consultar a própria escala publicada, abrir solicitações, aceitar/recusar convites de troca |

Quem cria a organização entra como Planejamento. Os demais são criados na tela
de **Usuários**, com o papel definido ali.

## Como o motor decide

`src/lib/domain/escalas/motor.ts` é uma função pura: recebe o retrato do mês e
devolve alocações, conflitos e aderência, sem tocar em banco. É a **mesma
chamada** usada na simulação (dry-run) e na geração definitiva — a única
diferença é gravar ou não o resultado. É isso que permite à tela de geração
mostrar exatamente o que vai acontecer antes de qualquer escrita.

A precedência, documentada em `REGRAS_MOTOR` e exibida na própria interface:

1. Travas manuais
2. Férias
3. Ausências
4. Regime de trabalho
5. Home office fixo
6. Unidade fixa por dia da semana
7. Capacidade da unidade
8. Cota de posições por equipe
9. Cota semanal de home office
10. Preferência de home office (e espalhamento como desempate)
11. Distribuição percentual (maior resto)
12. Balanceamento e cobertura mínima

As nove primeiras são rígidas e nunca são violadas; as demais são otimizadas no
que sobra.

## Testes

```bash
./scripts/testar.sh              # tudo: tipos, lint, motor, propriedades, build, banco
./scripts/testar.sh propriedades # só o fuzzing
RODADAS=50000 ./scripts/testar.sh propriedades
```

| Bateria | O que cobre |
|---|---|
| `npm test` | 57 asserções de casos concretos do motor |
| `npm run test:propriedades` | 14 invariantes × milhares de meses aleatórios |
| `supabase/tests/rls.sql` | quem enxerga o quê, com testes negativos |
| `supabase/tests/integridade.sql` | restrições, cascatas e vínculo entre contas |

As **propriedades** são o que pega o que ninguém imaginou. Em vez de conferir um
caso escolhido a dedo, geram-se meses inteiros ao acaso — equipes, capacidades,
cotas, postos, férias que atravessam o mês, travas, feriados — e verifica-se que
o que precisa ser sempre verdade continua sendo: ninguém trabalha nas próprias
férias, capacidade só é estourada com conflito registrado, trava manual é
sempre respeitada, a mesma entrada dá sempre a mesma escala. O gerador é
semeado; a falha imprime a semente e `SEMENTE=<n>` reproduz aquele mês exato.

As partes de banco usam `PGDATABASE`/`PGHOST` como qualquer ferramenta libpq, e
são puladas com aviso se não houver Postgres conectável.

## Rodando localmente

### 1. Crie o projeto no Supabase

Em [supabase.com](https://supabase.com), crie um projeto. Em **SQL Editor**,
rode os arquivos de `supabase/migrations/` na ordem numérica — cada um depende
dos anteriores. Abra cada arquivo, copie o **conteúdo inteiro** e cole no
editor; o nome do arquivo não é o comando.

As migrations são **idempotentes**: rodar de novo não quebra nada e não duplica
nada. Na dúvida sobre o que já foi aplicado, rode tudo de novo na ordem — é o
caminho mais seguro. (Verificado rodando a sequência inteira três vezes seguidas
no mesmo banco.)

Em **Authentication → Providers**, deixe **Email** habilitado. Para testar sem
confirmar e-mail, desative "Confirm email" nas configurações de Auth.

### 2. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha com os valores de **Project Settings → API**.

### 3. Instale e rode

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`, clique em "Criar agora" — isso cria uma
organização com você como Planejamento.

### 4. Primeiros passos

1. Em **Parâmetros**, cadastre as **unidades** (capacidade total e posições
   reservadas), as **equipes** (regime e gestor) e os **feriados**.
2. Em **Usuários**, crie o acesso das pessoas que vão operar o sistema. Cada uma
   recebe uma senha temporária, mostrada uma única vez — entregue a ela.
3. Em **Colaboradores**, cadastre as pessoas da escala e vincule cada uma ao
   usuário do sistema pelo campo *Usuário do sistema*. É esse vínculo que faz
   "Minha escala" mostrar os dias certos e que permite ao gestor ver a própria
   equipe. Nem todo colaborador precisa de login, e nem todo usuário precisa
   estar na escala.
4. Em **Planos do mês**, defina distribuição por unidade, unidades fixas por dia
   da semana, home office, ciclo 12x36 e ausências. A geração fica bloqueada
   enquanto houver pendência.
5. Em **Gerar escala**, simule, confirme e publique.

## Modelo de dados

Cada organização é uma **conta**. `perfis` pertencem a uma conta e têm um
`papel`. Todas as tabelas do domínio — `unidades`, `equipes`, `colaboradores`,
`planos`, `ausencias`, `geracoes`, `alocacoes`, `pins`, `solicitacoes`,
`cotas_equipe`, `postos`, `ocorrencias`, `logs` — são isoladas por `conta_id` via Row
Level Security.

O recorte por papel também é do banco, não da tela: o gestor lê apenas
colaboradores das equipes que gerencia, o colaborador lê apenas a própria linha,
e uma escala em rascunho é invisível para o colaborador até ser publicada. Ver
`pode_ver_colaborador()` em `0002_escalas.sql`.

Para verificar, com um Postgres local já migrado:

```bash
psql -d escala -f supabase/tests/rls.sql
```

Os três blocos `do $$ ... $$` são testes negativos: lançam exceção se a operação
**passar**. Cobrem escalonamento de privilégio, adulteração de solicitação por
terceiro e escrita na escala por quem não é Planejamento.

## Decisões que valem conhecer

- **Unidades são dados, não código.** A conta cadastra quantas quiser, com cor,
  sigla e capacidade próprias; o rateio por maior resto funciona para N unidades.
- **Posto é função, não lugar.** O Corpo Clínico não concorre com o Morumbi:
  quem o cobre ocupa uma posição normal do Morumbi e a escala só registra o que
  a pessoa faz ali. Por isso capacidade e rateio não mudam. A cobertura é
  semanal e contígua — 5 dias é a semana inteira, 3 é de segunda a quarta.
- **Preferência de home office manda; o espalhamento desempata.** Quem marcou
  sexta vai na sexta, ainda que isso concentre gente. O espalhamento age dentro
  do que foi marcado — entre dois dias preferidos, ganha o menos cheio — e só
  decide sozinho para quem não marcou preferência. Dia proibido continua sendo
  barreira absoluta.
- **Prioridade por cargo:** analista tem preferência no home office, técnico na
  posição presencial — é quem precisa estar perto do equipamento.
- **Cota por equipe é teto, não reserva ociosa.** Quando as cotas de uma unidade
  somam a capacidade livre, o teto vira garantia — um analista não ocupa o lugar
  que sobrou de técnico. Quem quer só limitar deixa folga; quem quer garantir faz
  as cotas fecharem o total.
- **Alocação normalizada**: uma linha por (pessoa, dia), com modalidade e unidade
  em colunas separadas. "Quem está no Morumbi dia 12" é uma consulta SQL.
- **Vínculo entre contas é impossível no banco, não só na tela.** Cada pai tem
  unicidade `(id, conta_id)` e cada filho referencia o par. Sem isso, um id
  sequencial adivinhado bastaria para um colaborador de uma conta apontar para a
  equipe de outra — e `pode_ver_colaborador()` navega justamente por esse
  caminho.
- **Unidade com escala gerada não se apaga, se desativa.** A alocação é
  histórico: "no dia 10/11 o Felipe estava no Morumbi". Por isso a exclusão é
  recusada por chave estrangeira, com mensagem clara, em vez de anular o
  registro.
- **Aprovar férias marca o mês inteiro.** O pedido carrega início e fim, e a
  aprovação vira uma ausência do período completo — então o plano do mês já abre
  com as férias marcadas, sem ninguém relançar à mão. Um período que atravessa o
  mês trava os dias nas duas gerações, não só na do mês inicial.
- **Ausência pertence à pessoa, não ao mês.** Um período que começa em um mês e
  termina no seguinte bloqueia os dois. Sobreposições são recusadas na gravação.
- **Ciclo 12x36 pela paridade de dias** desde um mês âncora configurável — exato
  em qualquer direção, inclusive em fevereiro bissexto.
- **Geração determinística**: os critérios de desempate terminam no id, com teste
  garantindo que a mesma entrada produz a mesma escala.
- **Aprovar uma solicitação altera a escala**: troca de unidade, troca de
  plantão, folga e férias gravam a trava e ajustam a alocação do dia — e a trava
  sobrevive à próxima regeração.
- **Notificações sem tabela de notificações.** O sino do cabeçalho é derivado de
  `solicitacao_eventos`, que já registra cada passo com autor e horário. Quem
  deve receber o quê já está resolvido pela RLS daquela tabela: o colaborador vê
  os eventos dos próprios pedidos e das trocas em que é parceiro, o gestor os da
  equipe, o planejamento os da conta. Uma tabela de notificações seria uma
  segunda fonte de verdade a manter em sincronia. Só o estado de leitura é
  gravado, como um instante em `perfis.notificacoes_vistas_em`.
- **Estado de navegação na URL**: mês, filtros, dia aberto e aba vivem na query
  string, então o botão voltar funciona e dá para compartilhar o link de um dia.

## O que ainda não existe

Notificações por e-mail ou push: o sino no cabeçalho avisa dentro do sistema, mas
nada é disparado para fora dele. Importação de colaboradores por planilha e exportação em PDF também não
foram implementadas — a exportação disponível é CSV (separador `;` e BOM UTF-8,
que é o que o Excel em português abre sem embaralhar acento).

## Colocando no ar

### Supabase (banco e autenticação)

1. Crie um projeto em [supabase.com](https://supabase.com). Escolha a região
   mais próxima dos usuários — `South America (São Paulo)`, se for o caso.
2. Rode as duas migrações em **SQL Editor**. Para cada uma: abra o arquivo no
   GitHub, clique em **Raw**, selecione tudo (`Ctrl+A`), copie, cole no editor e
   clique em **Run**. É o texto do arquivo que vai no editor, não o caminho dele
   — colar `0001_init.sql` devolve `ERROR: 42601: trailing junk after numeric
   literal`, que é o Postgres tentando ler `0001` como número.

   | Ordem | Arquivo | Começa com | Cria |
   |---|---|---|---|
   | 1º | `supabase/migrations/0001_init.sql` | `-- Escala — base multi-tenant` | `contas`, `perfis`, helpers e o trigger de cadastro |
   | 2º | `supabase/migrations/0002_escalas.sql` | `-- Escala — domínio:` | as 17 tabelas do domínio e as policies |

   A ordem importa: o segundo depende das tabelas e dos helpers do primeiro. Se
   rodar fora de ordem, o erro será `relation "perfis" does not exist` ou
   `function conta_id() does not exist` — nesse caso rode o `0001` e repita o
   `0002`.
3. Em **Authentication → Sign In / Providers**, mantenha **Email** habilitado e
   desative **Confirm email**. O sistema cria os acessos pela tela de Usuários,
   com senha temporária entregue em mãos — não há fluxo de confirmação por
   e-mail, então deixá-lo ligado impede o primeiro login.
4. Em **Authentication → URL Configuration**, ponha a URL do site em **Site
   URL** depois que a Vercel te der o domínio.

Quem preferir não copiar e colar pode usar a CLI, que envia os dois arquivos na
ordem certa sozinha:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

O `project-ref` é o trecho do meio da URL do painel
(`https://supabase.com/dashboard/project/SEU_PROJECT_REF`).

### Vercel (aplicação)

1. Importe o repositório em [vercel.com/new](https://vercel.com/new). O
   framework é detectado sozinho; não há nada para ajustar no build.
2. Em **Settings → Environment Variables**, configure as três variáveis do
   `.env.example`, com os valores de **Project Settings → API** do Supabase:

   | Variável | Onde achar | Exposta ao navegador |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | sim |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key | sim |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **não** |

   A `service_role` ignora toda a RLS. Ela é usada só em Server Actions, para
   criar e bloquear logins. Nunca a prefixe com `NEXT_PUBLIC_` e nunca a
   coloque em código do cliente.
3. Faça o deploy. Cada `git push` na branch de produção republica o site.
4. Acesse o domínio, clique em **Criar agora** e siga os primeiros passos acima.

### Antes de usar para valer

- Volte no Supabase e preencha o **Site URL** com o domínio da Vercel.
- Faça um backup ou ative o *Point in Time Recovery* se o plano permitir.
- Rode `supabase/tests/rls.sql` num banco de teste (nunca no de produção — ele
  apaga a tabela `perfis`) sempre que mexer nas policies.
