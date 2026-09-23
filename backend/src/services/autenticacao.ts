import type { Ambiente } from '../config/ambiente.ts';
import * as perfis from '../repositories/perfis.ts';
import * as sessoes from '../repositories/sessoes.ts';
import { ErroSso, type IdentidadeSso, type ServicoSso } from './sso.ts';

/**
 * A regra de quem entra — a orquestração entre o provedor de identidade e o
 * cadastro daqui.
 *
 * A decisão que mais importa neste arquivo: **autenticar no SSO não dá
 * acesso**. Quem entra no Keycloak corporativo é qualquer pessoa do hospital,
 * e a escala é de uma área. Se o primeiro login criasse o perfil, bastaria
 * existir na rede para entrar aqui — e a lista de usuários, que é o controle
 * de acesso desta aplicação, deixaria de significar alguma coisa.
 *
 * Então o SSO responde "quem é você"; quem responde "você pode" é o cadastro:
 * a pessoa precisa já ter perfil, criado por quem administra a área. O
 * primeiro login apenas LIGA os dois.
 */

export class AcessoNegado extends Error {
  constructor(mensagem: string, readonly motivo: 'sem_cadastro' | 'bloqueado' | 'vinculo_duplicado') {
    super(mensagem);
    this.name = 'AcessoNegado';
  }
}

export interface ResultadoDoLogin {
  valorDoCookie: string;
  perfil: perfis.Perfil;
}

export class ServicoAutenticacao {
  constructor(
    private readonly amb: Ambiente,
    private readonly sso: ServicoSso,
  ) {}

  /**
   * Fecha o ciclo do login: valida o que voltou do provedor, encontra a pessoa
   * aqui dentro e abre a sessão.
   */
  async concluirLogin(dados: {
    codigo: string;
    verificador: string;
    nonce: string;
    ip: string;
    agente: string;
  }): Promise<ResultadoDoLogin> {
    const tokens = await this.sso.trocarCodigo(dados.codigo, dados.verificador);
    const identidade = await this.sso.identidadeDoToken(tokens.idToken, dados.nonce);

    const perfil = await this.encontrarOuLigar(identidade);

    if (perfil.bloqueado) {
      throw new AcessoNegado(
        'Seu acesso está bloqueado. Fale com o Planejamento.',
        'bloqueado',
      );
    }

    const valorDoCookie = await sessoes.abrirSessao({
      perfilId: perfil.id,
      horas: this.amb.sessao.horas,
      ssoSid: identidade.sid,
      ssoRefresh: tokens.refreshToken,
      ip: dados.ip,
      agente: dados.agente,
    });

    // O nome vem do RH pelo provedor e é mais confiável que o digitado aqui.
    await perfis.atualizarNome(perfil.id, identidade.nome);

    return { valorDoCookie, perfil };
  }

  /**
   * Quem é esta pessoa no nosso cadastro.
   *
   * Três situações, nesta ordem:
   *
   *  1. já ligada ao provedor — o caminho de todos os dias;
   *  2. cadastrada, sem vínculo — o primeiro login, que cria o vínculo;
   *  3. não cadastrada — recusa, dizendo o que fazer.
   */
  private async encontrarOuLigar(identidade: IdentidadeSso): Promise<perfis.Perfil> {
    const ligado = await perfis.porSsoSub(identidade.sub);
    if (ligado) return ligado;

    const porEmail = await perfis.porEmail(identidade.email);
    if (!porEmail) {
      throw new AcessoNegado(
        `${identidade.email} não tem cadastro nesta aplicação. `
        + 'Peça ao Planejamento para criar o seu acesso e entre de novo.',
        'sem_cadastro',
      );
    }

    // O perfil achado pelo e-mail já pertence a OUTRA identidade do provedor:
    // é o endereço reaproveitado depois que alguém saiu. Ligar por cima
    // entregaria a conta da pessoa anterior a quem entrou agora.
    if (porEmail.ssoSub && porEmail.ssoSub !== identidade.sub) {
      throw new AcessoNegado(
        `O e-mail ${identidade.email} já está ligado a outra identidade corporativa. `
        + 'Fale com o Planejamento.',
        'vinculo_duplicado',
      );
    }

    const ligou = await perfis.ligarAoSso(porEmail.id, identidade.sub);
    if (!ligou) {
      // Perdeu a corrida para outro login simultâneo. Reler resolve — e se o
      // vínculo que venceu for de outra identidade, a leitura abaixo devolve
      // nada e a recusa é a certa.
      const relido = await perfis.porSsoSub(identidade.sub);
      if (!relido) {
        throw new AcessoNegado(
          'Não foi possível ligar seu acesso à identidade corporativa. Tente de novo.',
          'vinculo_duplicado',
        );
      }
      return relido;
    }

    return { ...porEmail, ssoSub: identidade.sub };
  }

  async encerrar(valorDoCookie: string): Promise<void> {
    await sessoes.encerrarSessao(valorDoCookie);
  }
}

export { ErroSso };
