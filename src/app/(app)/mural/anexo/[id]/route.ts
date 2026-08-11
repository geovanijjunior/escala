import { createClient } from '@/lib/supabase/server';

/**
 * Entrega o anexo de um comunicado.
 *
 * A leitura passa pelo client da sessão, então a policy de
 * `comunicado_anexos` decide: quem não enxerga o comunicado recebe 404. Não há
 * URL pública nem token — o anexo herda exatamente o recorte do comunicado,
 * sem um segundo caminho por onde vazar.
 */
/**
 * `bytea` chega como texto hexadecimal `\x…` pelo PostgREST, mas como Buffer
 * quando o app roda contra o Postgres direto (o shim das capturas do manual).
 * Aceitar as duas formas evita um anexo corrompido conforme o ambiente.
 */
function paraBytes(valor: unknown): Buffer {
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) return Buffer.from(valor);
  return Buffer.from(String(valor).replace(/^\\x/, ''), 'hex');
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numero = Number(id);
  if (!Number.isInteger(numero)) return new Response('Anexo inválido', { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase
    .from('comunicado_anexos')
    .select('nome, tipo, conteudo')
    .eq('id', numero)
    .maybeSingle();

  if (!data) return new Response('Anexo não encontrado', { status: 404 });

  const bytes = paraBytes(data.conteudo);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': data.tipo,
      // `inline` para a imagem e o PDF abrirem na aba; o nome vale para quem
      // escolher baixar.
      'Content-Disposition': `inline; filename="${encodeURIComponent(data.nome)}"`,
      'Content-Length': String(bytes.length),
      // Privado: é conteúdo recortado por sessão, não pode ficar em cache
      // compartilhado.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
