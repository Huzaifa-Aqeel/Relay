import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import {
  replacePublicationKnowledgeIndex,
  type AstraPublicationConfig,
  type PublicationVectorItem,
} from '../_shared/publication-vectors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ServerConfig = AstraPublicationConfig & {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function readConfig(): ServerConfig {
  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    astraEndpoint: requiredEnv('ASTRA_DB_API_ENDPOINT').replace(/\/$/, ''),
    astraToken: requiredEnv('ASTRA_DB_APPLICATION_TOKEN'),
    astraKeyspace: requiredEnv('ASTRA_DB_KEYSPACE'),
    astraCollection: requiredEnv('ASTRA_DB_COLLECTION'),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let config: ServerConfig;
  try {
    config = readConfig();
  } catch {
    return json({ error: 'Publication indexing is not configured.' }, 503);
  }
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let handoffId = '';
  try {
    const body = await request.json();
    handoffId = typeof body?.handoffId === 'string' ? body.handoffId : '';
  } catch {
    return json({ error: 'A handoff ID is required.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handoffId)) {
    return json({ error: 'A valid handoff ID is required.' }, 400);
  }
  const { data: authorized, error: authorizationError } = await client.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: handoffId,
  });
  if (authorizationError || !authorized) return json({ error: 'Handoff unavailable.' }, 403);

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { data: publication, error: publicationError } = await admin
    .from('handoff_publications')
    .select('id, organization_id, handoff_id')
    .eq('handoff_id', handoffId)
    .eq('status', 'active')
    .maybeSingle();
  if (publicationError || !publication) return json({ error: 'Published handoff unavailable.' }, 404);
  const { data: itemRows, error: itemError } = await admin
    .from('handoff_publication_items')
    .select('id, source_knowledge_item_id, knowledge_type, title, content')
    .eq('publication_id', publication.id);
  if (itemError || !itemRows?.length) return json({ error: 'Published knowledge unavailable.' }, 422);

  try {
    const indexedCount = await replacePublicationKnowledgeIndex({
      config,
      publicationId: publication.id,
      organizationId: publication.organization_id,
      handoffId: publication.handoff_id,
      items: itemRows as PublicationVectorItem[],
    });
    return json({ indexed: true, publicationId: publication.id, indexedCount });
  } catch (error) {
    console.error('Publication knowledge indexing failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Relay published the handoff but could not prepare Ask Relay semantic search yet.' }, 503);
  }
});
