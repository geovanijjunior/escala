'use client';

import { useId, useRef, useState } from 'react';

export interface PessoaEscolhivel {
  id: number;
  nome: string;
  /** Desempata homônimos e é o que muita gente tem na ponta da língua. */
  matricula?: string;
}

/**
 * Escolher uma pessoa digitando, e não rolando.
 *
 * Um `<select>` resolve dez nomes e atrapalha duzentos: não tem busca, a lista
 * abre com uma fatia do alfabeto na tela e achar "Rezende" custa rolagem no
 * mouse ou a sorte de acertar a tecla certa. Com duzentos colaboradores — que é
 * o tamanho que esta operação já tem — o campo deixa de ser um atalho e vira o
 * passo mais lento do formulário.
 *
 * A troca é por `<input list>` + `<datalist>`: dá para digitar qualquer pedaço
 * do nome e o navegador filtra, e quem prefere continua podendo abrir a lista e
 * escolher. É nativo — sem biblioteca, sem menu desenhado à mão, sem perder o
 * teclado do celular nem a leitura por leitor de tela.
 *
 * ── O que o formulário envia ──────────────────────────────────────────────
 *
 * `<input list>` envia TEXTO, e o servidor precisa de id. Então o texto é só a
 * vitrine: o campo com `name` é um `hidden`, preenchido quando o que foi
 * digitado casa exatamente com alguém da lista. Digitação pela metade não vira
 * escolha — o campo fica inválido com uma mensagem em vez de mandar vazio e
 * deixar o servidor recusar depois de o formulário inteiro ter sido preenchido.
 */
export function EscolherPessoa({
  name, pessoas, obrigatorio = false, placeholder = 'Digite o nome', largura = 'w-full', aoEscolher,
}: {
  name: string;
  pessoas: PessoaEscolhivel[];
  obrigatorio?: boolean;
  placeholder?: string;
  largura?: string;
  /** Rótulo acessível quando o campo não vem dentro de um <label>. */
  aoEscolher?: string;
}) {
  const listaId = useId();
  const [escolhido, setEscolhido] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  // O rótulo é o que a pessoa lê, digita e vê filtrar — e precisa ser único,
  // senão dois homônimos viram uma opção só e a escolha fica ambígua. A
  // matrícula desempata; sem ela, o id entra como último recurso, feio mas
  // correto.
  const rotulos = new Map<string, number>();
  const vistos = new Set<string>();
  const opcoes = pessoas.map(p => {
    let rotulo = p.matricula ? `${p.nome} · ${p.matricula}` : p.nome;
    if (vistos.has(rotulo)) rotulo = `${rotulo} (#${p.id})`;
    vistos.add(rotulo);
    rotulos.set(rotulo, p.id);
    return rotulo;
  });

  const resolver = (texto: string) => {
    const achado = rotulos.get(texto.trim());
    setEscolhido(achado ? String(achado) : '');
    const el = campo.current;
    if (!el) return;
    el.setCustomValidity(
      !texto.trim() || achado ? '' : 'Escolha um nome da lista — pode digitar parte dele para filtrar.',
    );
  };

  return (
    <>
      <input
        ref={campo}
        list={listaId}
        type="text"
        required={obrigatorio}
        placeholder={placeholder}
        aria-label={aoEscolher}
        className={`esc-input ${largura}`}
        onChange={e => resolver(e.target.value)}
        // Sem isto, escolher pelo menu do navegador — que dispara `input`, e
        // nem sempre `change` — deixaria o hidden para trás.
        onInput={e => resolver((e.target as HTMLInputElement).value)}
      />
      <datalist id={listaId}>
        {opcoes.map(r => <option key={r} value={r} />)}
      </datalist>
      <input type="hidden" name={name} value={escolhido} />
    </>
  );
}
