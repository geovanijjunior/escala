import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Client com a service_role key — ignora RLS.
 * Use SOMENTE em Server Actions, e só depois de checar o perfil do usuário logado.
 * Nunca importe este arquivo em código que roda no browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
