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

Quem cria a organização entra como Planejamento. Os demais entram por convite,
com o papel definido no cadastro do colaborador.

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
8. Cota semanal de home office
9. Distribuição percentual (maior resto)
10. Preferência de home office
11. Balanceamento e cobertura mínima

As sete primeiras são rígidas e nunca são violadas; as demais são otimizadas no
que sobra.

Rode `npm test` para as 27 asserções do motor: regimes, ciclo 12x36, cotas,
capacidade, travas, ausências entre meses e determinismo.

## Rodando localmente

### 1. Crie o projeto no Supabase

Em [supabase.com](https://supabase.com), crie um projeto. Em **SQL Editor**,
rode os arquivos de `supabase/migrations/` na ordem numérica (0001, depois
0002) — o segundo depende do primeiro.

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
2. Em **Colaboradores**, cadastre as pessoas e vincule cada uma ao usuário do
   sistema correspondente — é esse vínculo que faz "Minha escala" funcionar.
3. Em **Planos do mês**, defina distribuição por unidade, unidades fixas por dia
   da semana, home office, ciclo 12x36 e ausências. A geração fica bloqueada
   enquanto houver pendência.
4. Em **Gerar escala**, simule, confirme e publique.

## Modelo de dados

Cada organização é uma **conta**. `perfis` pertencem a uma conta e têm um
`papel`. Todas as tabelas do domínio — `unidades`, `equipes`, `colaboradores`,
`planos`, `ausencias`, `geracoes`, `alocacoes`, `pins`, `solicitacoes`,
`ocorrencias`, `logs` — são isoladas por `conta_id` via Row Level Security.

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
- **Alocação normalizada**: uma linha por (pessoa, dia), com modalidade e unidade
  em colunas separadas. "Quem está no Morumbi dia 12" é uma consulta SQL.
- **Ausência pertence à pessoa, não ao mês.** Um período que começa em um mês e
  termina no seguinte bloqueia os dois. Sobreposições são recusadas na gravação.
- **Ciclo 12x36 pela paridade de dias** desde um mês âncora configurável — exato
  em qualquer direção, inclusive em fevereiro bissexto.
- **Geração determinística**: os critérios de desempate terminam no id, com teste
  garantindo que a mesma entrada produz a mesma escala.
- **Aprovar uma solicitação altera a escala**: troca de unidade, troca de
  plantão, folga e férias gravam a trava e ajustam a alocação do dia — e a trava
  sobrevive à próxima regeração.
- **Estado de navegação na URL**: mês, filtros, dia aberto e aba vivem na query
  string, então o botão voltar funciona e dá para compartilhar o link de um dia.

## O que ainda não existe

Notificações por e-mail ou push na promoção da fila e nas mudanças de status: a
interface indica quando algo aguarda resposta, mas nada é disparado para fora do
sistema. Importação de colaboradores por planilha e exportação em PDF também não
foram implementadas — a exportação disponível é CSV (separador `;` e BOM UTF-8,
que é o que o Excel em português abre sem embaralhar acento).

## Deploy (Vercel)

Importe o repositório na [Vercel](https://vercel.com/new), configure as três
variáveis do `.env.local` em Settings → Environment Variables, e faça o deploy.
