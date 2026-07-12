import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Edge Function do PSN CRM: só o super admin consegue criar login novo
// (gerente/consultor) ou redefinir senha de alguém, direto da aba
// Config → Controle de Acesso do CRM. Nunca expõe a service_role key
// ao navegador — ela só existe aqui, no ambiente da função.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerToken = authHeader.replace(/^Bearer\s+/i, '')
    if (!callerToken) {
      return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Cliente "como o chamador" — só pra confirmar quem é e checar o papel dele.
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await supabaseCaller.auth.getUser()
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Sessão inválida.' }, 401)
    }

    const { data: perfilCaller, error: perfilError } = await supabaseCaller
      .from('perfis')
      .select('papel,status')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (perfilError || !perfilCaller || perfilCaller.papel !== 'superadmin' || perfilCaller.status !== 'ativo') {
      return jsonResponse({ error: 'Só o super admin pode gerenciar acessos.' }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Payload inválido.' }, 400)
    }

    const { action } = body as { action?: string }

    // Cliente admin (service_role bypassa RLS e faz operações de Auth) —
    // só é usado depois de confirmar acima que quem chamou é superadmin.
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (action === 'create') {
      const { email, senha, nome, papel } = body as {
        email?: string; senha?: string; nome?: string; papel?: string
      }
      if (!email || !senha || !nome || !papel) {
        return jsonResponse({ error: 'Preencha nome, email, senha e papel.' }, 400)
      }
      if (papel !== 'gerente' && papel !== 'consultor') {
        return jsonResponse({ error: 'Papel inválido (só gerente ou consultor por aqui).' }, 400)
      }
      if (senha.length < 6) {
        return jsonResponse({ error: 'Senha precisa ter pelo menos 6 caracteres.' }, 400)
      }

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      })
      if (createError || !created?.user) {
        return jsonResponse({ error: `Erro ao criar login: ${createError?.message ?? 'desconhecido'}` }, 400)
      }

      const { error: perfilInsertError } = await supabaseAdmin
        .from('perfis')
        .upsert({
          id: created.user.id,
          email,
          nome,
          papel,
          status: 'ativo',
          criado_por: userData.user.id,
        })
      if (perfilInsertError) {
        return jsonResponse({
          error: `Login criado, mas falha ao salvar o perfil: ${perfilInsertError.message}`,
        }, 500)
      }

      return jsonResponse({ ok: true, id: created.user.id }, 200)
    }

    if (action === 'reset_password') {
      const { id, senha } = body as { id?: string; senha?: string }
      if (!id || !senha) {
        return jsonResponse({ error: 'Faltou o id do usuário ou a nova senha.' }, 400)
      }
      if (senha.length < 6) {
        return jsonResponse({ error: 'Senha precisa ter pelo menos 6 caracteres.' }, 400)
      }
      const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(id, { password: senha })
      if (resetError) {
        return jsonResponse({ error: `Erro ao redefinir senha: ${resetError.message}` }, 400)
      }
      return jsonResponse({ ok: true }, 200)
    }

    return jsonResponse({ error: 'Ação desconhecida.' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno desconhecido.'
    return jsonResponse({ error: message }, 500)
  }
})
