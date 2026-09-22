import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Config = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  revenueCatSecret: string;
  entitlementId: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function readConfig(): Config {
  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    revenueCatSecret: requiredEnv('REVENUECAT_SECRET_API_KEY'),
    entitlementId: requiredEnv('REVENUECAT_ENTITLEMENT_ID'),
  };
}

function activeThrough(entitlement: Record<string, unknown>) {
  const dates = [entitlement.expires_date, entitlement.grace_period_expires_date]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (entitlement.expires_date === null) return null;
  if (!dates.length) return undefined;
  return dates.reduce((latest, value) => value > latest ? value : latest).toISOString();
}

async function fetchEntitlement(config: Config, revenueCatAppUserId: string) {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(revenueCatAppUserId)}`, {
    headers: {
      Authorization: `Bearer ${config.revenueCatSecret}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error('RevenueCat subscriber lookup failed.');
  const body = await response.json();
  const subscriber = body?.subscriber && typeof body.subscriber === 'object' ? body.subscriber : {};
  const entitlement = subscriber?.entitlements?.[config.entitlementId];
  const entitlementRecord = entitlement && typeof entitlement === 'object' ? entitlement as Record<string, unknown> : null;
  const expiresAt = entitlementRecord ? activeThrough(entitlementRecord) : undefined;
  const isActive = Boolean(entitlementRecord && (expiresAt === null || (expiresAt && new Date(expiresAt) > new Date())));
  const productIdentifier = entitlementRecord && typeof entitlementRecord.product_identifier === 'string'
    ? entitlementRecord.product_identifier.slice(0, 200)
    : null;
  const subscription = productIdentifier && subscriber?.subscriptions?.[productIdentifier];
  const store = subscription && typeof subscription.store === 'string' ? subscription.store.slice(0, 40) : null;
  return { isActive, productIdentifier, store, expiresAt: expiresAt ?? null };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let config: Config;
  try {
    config = readConfig();
  } catch {
    return json({ error: 'Purchases are not configured yet.' }, 503);
  }
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const userClient = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let organizationId: string | null = null;
  try {
    const body = await request.json();
    organizationId = typeof body?.organizationId === 'string' ? body.organizationId : null;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (organizationId && !UUID_PATTERN.test(organizationId)) {
    return json({ error: 'Choose a valid organization.' }, 400);
  }
  if (organizationId) {
    const { data: isAdmin, error: adminError } = await userClient.rpc('is_organization_admin', {
      requested_organization_id: organizationId,
    });
    if (adminError || !isAdmin) return json({ error: 'Organization admin access required.' }, 403);
  }

  try {
    const entitlement = await fetchEntitlement(config, data.user.id);
    const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
    const { data: associatedOrganizationId, error: updateError } = await admin.rpc('sync_verified_organization_subscription', {
      requested_purchaser: data.user.id,
      requested_organization: organizationId,
      requested_entitlement: config.entitlementId,
      requested_active: entitlement.isActive,
      requested_product: entitlement.productIdentifier,
      requested_store: entitlement.store,
      requested_expiry: entitlement.expiresAt,
    });
    if (updateError) return json({ error: updateError.code === '42501'
      ? 'Only the current Organization Owner can attach a purchase.'
      : 'This purchase or Organization is already associated, or could not be verified. Try Restore purchases.' }, 409);

    return json({
      hasActiveEntitlement: entitlement.isActive,
      organizationId: associatedOrganizationId,
      organizationIsPro: Boolean(entitlement.isActive && organizationId && associatedOrganizationId === organizationId),
      expiresAt: entitlement.expiresAt,
    });
  } catch {
    return json({ error: 'Relay could not verify your subscription. Please try again.' }, 503);
  }
});
