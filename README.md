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

## Manual de operação

[`docs/manual.html`](docs/manual.html) é o manual de quem vai usar o sistema, não
de quem o programa: implantação passo a passo, a rotina de cada mês, o que cada
papel enxerga, as doze regras do motor e o que fazer quando algo dá errado. Abre
no navegador com dois cliques.

Para distribuir em papel ou anexo, [`docs/manual.pdf`](docs/manual.pdf), em A4.
Ele sai do **mesmo arquivo** que a versão web — o que difere entre tela e papel
é só o bloco `@media print` do próprio manual, então não há uma segunda cópia do
texto para sair de sincronia.

Regenerar depois de editar o HTML: abra o arquivo no navegador e imprima em PDF
(`Ctrl+P`), ou use o script, que faz a mesma coisa sem abrir janela:

```bash
npm i -D playwright && npx playwright install chromium   # só na primeira vez
npm run manual:pdf
```

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

## Áreas e papéis

Uma **área** é uma instância isolada do sistema: colaboradores, escalas,
solicitações e comunicados próprios, invisíveis para as outras áreas. No banco
ela é a tabela `contas` — o nome mudou na interface, o isolamento é o mesmo de
sempre.

Um perfil tem exatamente um papel, e ele é a única dimensão de permissão:

| Papel | Vê | Pode |
|---|---|---|
| **Administrador Geral** | As áreas, quem tem login em cada uma, e nada mais de dentro delas | Cadastrar áreas, nomear e bloquear o Administrador de cada uma, desativar e reativar uma área, ler as contagens de cada área (pessoas, usuários, mês publicado) e a lista de usuários dela |
| **Administrador da Área** | Toda a área | Cadastrar o Planejamento e os demais usuários, manter colaboradores, equipes, unidades, postos, feriados e parâmetros, acompanhar os indicadores |
| **Planejamento** | Toda a área | Tudo do Administrador da Área, mais: editar planos, gerar/publicar/encerrar a escala, fazer a triagem das solicitações, travar alocações, publicar comunicados para qualquer público |
| **Gestor** | Só as equipes que gerencia | Acompanhar escala e indicadores da equipe, decidir sozinho o que a triagem encaminhou (aprovar, enfileirar ou recusar), lançar ocorrências, ajustar a escala já publicada, publicar comunicados para a equipe |
| **Colaborador** | Só a si mesmo | Consultar a própria escala publicada, abrir solicitações, aceitar/recusar convites de troca, ler o mural |

O cadastro é uma corrente, e cada elo só cria o próximo: Administrador Geral →
Administrador da Área → Planejamento → gestores e colaboradores. A regra vive na
RLS, não na tela — esconder o botão não impede um POST.

Duas assimetrias merecem nota. O **Administrador Geral não tem área**: o
`conta_id` do perfil dele é nulo, e como toda policy do domínio compara
`conta_id = conta_id()`, a comparação resulta em nulo, que em RLS nega. O papel
com mais alcance é o que menos enxerga, e cada permissão dele foi concedida uma
a uma. E o **Administrador da Área não opera a escala**: ele tem o mesmo alcance
de leitura do Planejamento — precisa poder auditar a própria área —, mas as
telas de plano, geração, calendário e solicitações ficam fora do alcance dele, e
as Server Actions correspondentes recusam o papel.

A exceção concedida ao Geral é **ver os usuários** de todas as áreas (`0016`):
quem responde pelo sistema precisa saber quem tem acesso a ele. É leitura de
`perfis` — nome, e-mail, papel, bloqueado — e nada além disso: a ficha do
colaborador, a escala e as solicitações continuam fechadas, e ele não altera
esses usuários. Ver não é gerir; quem cria, bloqueia e troca o papel de quem
está dentro de uma área é o Administrador dela.

**Área não se apaga.** Não há policy de delete em `contas`, e não é esquecimento:
o cascade levaria junto o histórico de meses fechados, que é registro
trabalhista. Para tirar do ar existe `ativa`, que fecha a porta para todo mundo
de dentro — inclusive o administrador local — e preserva o que aconteceu.

**Ninguém se cadastra sozinho.** Não há tela de auto-cadastro: todo acesso é
concedido por alguém acima na corrente, e por isso a tela de login pede
credencial e mais nada. O trigger `handle_novo_usuario` continua tratando o
signup sem `conta_id` — é a última linha de defesa se alguém chamar a API de
Auth por fora, não o caminho de ninguém pela interface.

### Criar o primeiro Administrador Geral

Não há tela para isso, e não poderia haver: uma tela capaz de criar o papel mais
alto do sistema só faz sentido enquanto ele não existe, e nesse intervalo ela
estaria aberta a qualquer um. O primeiro é feito à mão, uma vez; daí em diante a
corrente cuida do resto.

No SQL Editor do Supabase, com o e-mail de um usuário que já existe em
**Authentication → Users**:

```sql
update perfis set papel = 'admin_geral', conta_id = null
where email = 'voce@exemplo.com';
```

Ou, criando o usuário já no papel, em **Authentication → Users → Add user**,
com este *User Metadata*:

```json
{ "nome": "Seu Nome", "papel": "admin_geral" }
```

O trigger `handle_novo_usuario` reconhece o papel e cria o perfil sem área.

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
8. Mínimo de posições por equipe
9. Cota semanal de home office
10. Preferência de home office (e espalhamento como desempate)
11. Distribuição percentual (maior resto)
12. Balanceamento e cobertura mínima

As nove primeiras são rígidas e nunca são violadas; as demais são otimizadas no
que sobra.

## Testes

```bash
./scripts/testar.sh              # tudo: tipos, lint, motor, propriedades, autorização, build, banco
./scripts/testar.sh propriedades # só o fuzzing
./scripts/testar.sh migracoes    # fora do "tudo": cria e derruba bancos próprios
RODADAS=50000 ./scripts/testar.sh propriedades
```

| Bateria | O que cobre |
|---|---|
| `npm test` | asserções do motor e do leitor de planilha |
| `npm run test:propriedades` | 15 invariantes × milhares de meses aleatórios |
| `supabase/tests/autorizacao.mjs` | toda Server Action abre sessão e checa papel — leitura estática, sem banco |
| `supabase/tests/rls.sql` | quem enxerga o quê, com testes negativos — inclui mural, anexos, avisos e caixa de saída |
| `supabase/tests/rls-avancado.sql` | funções `security definer`, que rodam FORA da RLS, e a superfície das migrations recentes |
| `supabase/tests/integridade.sql` | restrições, cascatas e vínculo entre contas |
| `supabase/tests/feriados.sql` | a Páscoa e os feriados nacionais, ano a ano, de 2000 a 2100 |
| `supabase/tests/migracoes.sh` | instalação do zero, reaplicação, o caminho sem a 0009 e o backfill da 0020 |
| `scripts/manual/hostil.mjs` | dado forjado em cada formulário — o critério é o contrário: precisa NÃO gravar |

Três delas cobrem caminhos que os testes de dado não alcançam, e cada uma nasceu
de um erro real:

- **`autorizacao.mjs`** trata cada função exportada de um `actions-*.ts` como o
  que ela é: um endpoint, que aceita POST de quem tiver o id dela. Esconder o
  botão não fecha nada.
- **`rls-avancado.sql`** olha para as funções `security definer`, que rodam como
  o dono e por isso **não passam por policy nenhuma** — e mantém um inventário
  delas que falha quando aparece uma nova sem exame. Nele o `app_user` entra
  como membro de `authenticated` em vez de receber `grant` em bloco: conceder em
  bloco devolveria justamente o que as migrations revogam, e o teste passaria
  sempre.
- **`migracoes.sh`** exercita a INSTALAÇÃO, não o dado: aplicar duas vezes,
  aplicar sem a 0009, e converter massa no formato antigo. Uma migration só
  roda uma vez na vida de cada banco — ou está certa agora, ou o estrago é
  silencioso.

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

Abra `http://localhost:3000`. Não há auto-cadastro: crie o primeiro
Administrador Geral pelo SQL da seção anterior e, logado nele, cadastre a
primeira área junto com o administrador dela — é ele quem cria o Planejamento.

### 4. Primeiros passos

1. Em **Parâmetros**, cadastre as **unidades** (capacidade total e posições
   reservadas), as **equipes** (regime e gestor) e os **feriados**. O código de
   unidade e de equipe não é pedido: o banco o gera a partir do id. Uma equipe
   pode ficar **fora da escala** — usa só o fluxo de solicitações, e seus
   colaboradores não são alocados nem ocupam posição nas unidades. Os feriados
   nacionais do ano em curso já vêm criados junto com a área; o botão *Trazer
   feriados nacionais* repete isso para qualquer outro ano, e nunca sobrescreve
   um feriado que alguém já cadastrou à mão. O que é ponto facultativo —
   Carnaval e Corpus Christi — fica de fora de propósito: cada operação decide.
   Cada **posto** pode ficar reservado a uma equipe; deixando em branco, serve a
   qualquer uma. E a **cota por equipe** é o *mínimo* de pessoas daquela equipe
   naquela unidade, não o máximo.
2. Em **Usuários**, crie o acesso das pessoas. A senha temporária é gerada pelo
   sistema e mostrada uma única vez — entregue a ela. Escolhendo o papel
   **colaborador**, o formulário abre os campos da escala (matrícula, equipe,
   unidade base, entrada e saída, admissão) e cria o login e o cadastro já
   vinculados, sem passar por outra tela. O ciclo do 12x36 não é pedido aqui:
   ele é decidido a cada **plano do mês**.
3. **Colaboradores** continua sendo o caminho do caso inverso: a pessoa já está
   na escala — veio de uma planilha importada, por exemplo — e só agora ganha
   login. O campo *Usuário do sistema* liga os dois. É esse vínculo que faz
   "Minha escala" mostrar os dias certos e que permite ao gestor ver a própria
   equipe. Nem todo colaborador precisa de login, e nem todo usuário precisa
   estar na escala.
4. Em **Planos do mês**, defina distribuição por unidade, unidades fixas por dia
   da semana, home office, ciclo 12x36 e ausências. A geração fica bloqueada
   enquanto houver pendência.
5. Em **Gerar escala**, simule, confirme e publique.

## Modelo de dados

Cada área é uma linha em **`contas`**. `perfis` pertencem a uma conta e têm um
`papel` — exceto o Administrador Geral, cujo `conta_id` é nulo justamente para
que nenhuma policy do domínio o alcance. Todas as tabelas do domínio — `unidades`, `equipes`, `colaboradores`,
`planos`, `ausencias`, `geracoes`, `alocacoes`, `pins`, `solicitacoes`,
`cotas_equipe`, `postos`, `ocorrencias`, `avisos`, `comunicados`,
`comunicado_anexos`, `alteracoes_pendentes`, `logs` — são isoladas por `conta_id`
via Row Level Security.

O recorte por papel também é do banco, não da tela: o gestor lê apenas
colaboradores das equipes que gerencia, o colaborador lê apenas a própria linha,
e uma escala em rascunho é invisível para o colaborador até ser publicada. Ver
`pode_ver_colaborador()` em `0002_escalas.sql`.

Para verificar, com um Postgres local já migrado:

```bash
psql -d escala -f supabase/tests/rls.sql
```

Os blocos `do $$ ... $$` são testes negativos: lançam exceção se a operação
**passar**. Cobrem escalonamento de privilégio (inclusive para os dois papéis de
administração), adulteração de solicitação por terceiro, escrita na escala por
quem não é Planejamento, e a corrente de cadastro — o Administrador Geral não
cria Planejamento direto, a área não nomeia o próprio administrador, e nenhum
dos dois enxerga o que não lhe cabe.

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
- **Cota por equipe é piso, não teto.** O número diz quantas pessoas daquela
  equipe *precisam* estar na unidade, e o motor as coloca antes de distribuir o
  resto — mesmo que a distribuição percentual preferisse mandá-las para outro
  lugar. Acima do piso ninguém é barrado: quem quer ficar, fica, até a
  capacidade acabar. Piso que não deu para cumprir — porque faltou gente da
  equipe ou lugar na unidade — vira **alerta**, não conflito: a escala continua
  válida e o Planejamento decide o que fazer.
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
- **O intervalo é acréscimo no 5x2 e parte do turno no 12x36.** Oito horas de
  trabalho a partir das 08:00 terminam às 17:00 — o almoço estica o expediente.
  O plantão 12x36 são doze horas de ponta a ponta, 19:00 às 07:00, com o
  intervalo dentro. Tratar os dois igual esticava o plantão para treze horas.
- **Geração determinística**: os critérios de desempate terminam no id, com teste
  garantindo que a mesma entrada produz a mesma escala.
- **Aprovar uma solicitação altera a escala**: troca de unidade, troca de
  plantão, folga e férias gravam a trava e ajustam a alocação do dia — e a trava
  sobrevive à próxima regeração.
- **O sino mostra só o não lido, e a leitura é por item.** `notificacoes_lidas`
  guarda a chave de cada item aberto; `perfis.notificacoes_vistas_em` continua
  existindo para o "marcar todas", que é um corte em massa e não merece N
  linhas. As duas formas compõem. O carimbo sozinho não servia mais: com o sino
  mostrando apenas o que falta ler, abrir UM aviso esvaziava a lista inteira.
- **O sino tem duas fontes, e só uma delas é uma tabela de avisos.** O
  andamento das solicitações é derivado de `solicitacao_eventos`, que já
  registra cada passo com autor e horário: quem deve receber o quê está
  resolvido pela RLS daquela tabela, e duplicar isso numa tabela de
  notificações seria uma segunda fonte de verdade a manter em sincronia. Já
  alteração de escala e comunicado não têm um destinatário dedutível — quem
  altera *escolhe* se avisa só quem mudou ou a escala inteira —, então esses
  vão para `avisos`, com o destinatário escrito. O sino junta as duas por data.
  Só o estado de leitura é gravado, como um instante em
  `perfis.notificacoes_vistas_em`.
- **Alteração depois de publicada é permitida, nunca silenciosa, e comunicada
  em lote.** Escala publicada continua editável pelo Planejamento e pelo gestor
  da equipe. Cada movimento altera a escala na hora e entra no log, mas o aviso
  vai para uma caixa de saída (`alteracoes_pendentes`) e só sai quando alguém
  confirma — com a escolha, feita ali, entre avisar quem mudou ou a escala
  inteira. Avisar a cada clique mandava dez avisos por reorganização, alguns
  descrevendo estados intermediários que não duraram cinco minutos, e o efeito
  prático era ninguém reorganizar nada. Escala em rascunho não avisa ninguém.
- **Conflito durante a reorganização informa, não bloqueia.** Para chegar num
  estado válido às vezes é preciso passar por um inválido — mover A antes de
  mover B lota a unidade no meio do caminho —, e travar a primeira metade da
  operação impediria a segunda. Na geração é o contrário: lá o conflito
  bloqueia, porque não há segunda metade vindo. A conferência
  (`domain/escalas/conferencia.ts`) roda sobre as alocações que estão no banco,
  e não sobre os conflitos gravados na geração, que descrevem uma escala que
  qualquer movimento manual já tornou obsoleta.
- **O plano do mês se carrega para os meses seguintes.** Distribuição, home
  office, unidade fixa e posto são configuração recorrente: quem não tem plano
  do mês continua com o do mês anterior, marcado como herdado. Férias e
  ausências ficam de fora — são eventos datados, vindos de solicitação
  aprovada, e repeti-las marcaria de férias quem já voltou.
- **A importação de planilha confere antes de gravar.** `lerPlanilha` é função
  pura — texto do arquivo e cadastros entram, o que seria gravado e os erros de
  cada linha saem —, o que permite testá-la com trinta arquivos malformados sem
  subir banco, e é o que torna viável mostrar o resultado antes de confirmar.
  A matrícula é a identidade: reimportar o mesmo arquivo atualiza em vez de
  duplicar, então corrigir uma linha e mandar tudo de novo é seguro.
- **Anexo do mural mora no banco, em `bytea`, com teto de 20 MB por arquivo e
  40 MB por comunicado.** É uma troca deliberada contra o Storage: o mural
  recebe foto de aviso e PDF escaneado, e guardar no banco dispensa bucket,
  políticas de storage e URL assinada — o anexo herda exatamente o recorte do
  comunicado, sem um segundo caminho por onde vazar. Os dois tetos existem
  porque medem coisas diferentes: o CHECK da tabela vale por arquivo, e o
  `serverActions.bodySizeLimit` do `next.config.ts` vale para a requisição
  inteira. Mexer num sem o outro troca uma mensagem clara por um erro de rede.
- **Estado de navegação na URL**: mês, filtros, dia aberto e aba vivem na query
  string, então o botão voltar funciona e dá para compartilhar o link de um dia.

## O que ainda não existe

Notificações por e-mail ou push: o sino no cabeçalho avisa dentro do sistema, mas
nada é disparado para fora dele. Exportação em PDF também não foi implementada — a
exportação disponível é CSV (separador `;` e BOM UTF-8, que é o que o Excel em
português abre sem embaralhar acento).

## Colocando no ar

### Supabase (banco e autenticação)

1. Crie um projeto em [supabase.com](https://supabase.com). Escolha a região
   mais próxima dos usuários — `South America (São Paulo)`, se for o caso.
2. Rode os arquivos de `supabase/migrations/` em **SQL Editor**, na ordem
   numérica. Para cada um: abra o arquivo no GitHub, clique em **Raw**,
   selecione tudo (`Ctrl+A`), copie, cole no editor e clique em **Run**. É o
   texto do arquivo que vai no editor, não o caminho dele — colar
   `0001_init.sql` devolve `ERROR: 42601: trailing junk after numeric literal`,
   que é o Postgres tentando ler `0001` como número.

   | Ordem | Arquivo | Cria |
   |---|---|---|
   | 1º | `0001_init.sql` | `contas`, `perfis`, helpers e o trigger de cadastro |
   | 2º | `0002_escalas.sql` | as 17 tabelas do domínio e as policies |
   | 3º | `0003_cota_equipe.sql` | cota de posições por equipe em cada unidade |
   | 4º | `0004_subunidades.sql` | hierarquia de unidades |
   | 5º | `0005_postos.sql` | postos internos das unidades |
   | 6º | `0006_correcoes.sql` | correções de índices e de policies |
   | 7º | `0007_notificacoes.sql` | eventos de solicitação e o carimbo de leitura do sino |
   | 8º | `0008_solicitacao_periodo.sql` | data final nas solicitações de período |
   | 9º | `0009_vinculo_por_conta.sql` | chaves compostas `(id, conta_id)` |
   | 10º | `0010_ocorrencias_e_ferias.sql` | motivo de inativação, opções de férias, campos por tipo de ocorrência |
   | 11º | `0011_mural_e_avisos.sql` | avisos do sino, mural de comunicados e anexos |
   | 12º | `0012_alteracoes_pendentes.sql` | caixa de saída das alterações em escala publicada |
   | 13º | `0013_anexo_5mb_e_caixa_de_saida.sql` | anexo até 5 MB e correção do recorte da caixa de saída |
   | 14º | `0014_notificacoes_lidas.sql` | leitura por item no sino e última visita ao mural |
   | 15º | `0015_areas_e_administradores.sql` | áreas, Administrador Geral e Administrador da Área |
   | 16º | `0016_geral_ve_usuarios.sql` | o Administrador Geral passa a ver os usuários de todas as áreas |
   | 17º | `0017_anexo_20mb.sql` | anexo do mural de 5 MB para 20 MB |
   | 18º | `0018_codigo_gerado.sql` | código de unidade e de equipe gerado pelo banco |
   | 19º | `0019_equipe_fora_da_escala.sql` | equipe que só usa solicitações e não ocupa posição |
   | 20º | `0020_entrada_saida_e_ciclo.sql` | horário de saída no lugar da jornada em horas; ciclo 12x36 deixa de ser obrigatório no cadastro |
   | 21º | `0021_cota_minima_e_posto_da_equipe.sql` | cota por equipe vira mínimo; posto passa a ter equipe |
   | 22º | `0022_feriados_nacionais.sql` | feriados nacionais do ano vigente já criados com a área |
   | 23º | `0023_semeadura_de_feriados_fechada.sql` | a semeadura deixa de aceitar a área por parâmetro; feriados coincidentes viram uma linha |
   | 24º | `0024_horario_valido.sql` | entrada e saída precisam ser horários que existem no relógio |
   | 25º | `0025_plantao_de_doze_horas.sql` | tira do 12x36 a hora de intervalo que a fórmula antiga somava — o plantão volta a medir doze horas |

   A ordem importa: cada um depende dos anteriores. Se rodar fora de ordem, o
   erro será `relation "perfis" does not exist` ou `function conta_id() does not
   exist` — nesse caso volte ao primeiro que faltou e siga daí. As migrations
   são idempotentes, então repetir uma já aplicada não faz mal.
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
