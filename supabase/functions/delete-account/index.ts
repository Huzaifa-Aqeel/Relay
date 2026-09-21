import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function listFiles(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...await listFiles(admin, bucket, path));
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return paths;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return Response.json({ error: 'Authentication required.' }, { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return Response.json({ error: 'Server configuration is incomplete.' }, { status: 500, headers: corsHeaders });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: 'Your session is no longer valid.' }, { status: 401, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    const { data: organizations, error: organizationsError } = await admin
      .from('organizations')
      .select('id')
      .eq('created_by', userData.user.id);
    if (organizationsError) throw organizationsError;

    const organizationIds = organizations.map((organization) => organization.id);
    if (organizationIds.length > 0) {
      const { count: otherMemberCount, error: membersError } = await admin
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .in('organization_id', organizationIds)
        .neq('user_id', userData.user.id);
      if (membersError) throw membersError;
      if ((otherMemberCount ?? 0) > 0) {
        return Response.json(
          { error: 'Transfer or remove organization members before deleting this account.' },
          { status: 409, headers: corsHeaders },
        );
      }
    }

    for (const organization of organizations) {
      const paths = await listFiles(admin, 'organization-logos', organization.id);
      if (paths.length > 0) {
        const { error } = await admin.storage.from('organization-logos').remove(paths);
        if (error) throw error;
      }
    }
    const { error } = await admin.auth.admin.deleteUser(userData.user.id);
    if (error) throw error;
    return Response.json({ deleted: true }, { headers: corsHeaders });
  } catch {
    return Response.json(
      { error: 'The account could not be fully deleted. No partial success is being reported.' },
      { status: 500, headers: corsHeaders },
    );
  }
});
