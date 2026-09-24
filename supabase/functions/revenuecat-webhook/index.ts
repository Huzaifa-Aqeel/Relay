import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function activeThrough(entitlement: Record<string, unknown>) {
  if (entitlement.expires_date === null) return null;
  const dates = [entitlement.expires_date, entitlement.grace_period_expires_date]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (!dates.length) return undefined;
  return dates.reduce((latest, value) => value > latest ? value : latest).toISOString();
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  let supabaseUrl: string;
  let serviceRoleKey: string;
  let revenueCatSecret: string;
  let entitlementId: string;
  let webhookAuthorization: string;
  try {
    supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
    serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    revenueCatSecret = requiredEnv('REVENUECAT_SECRET_API_KEY');
    entitlementId = requiredEnv('REVENUECAT_ENTITLEMENT_ID');
    webhookAuthorization = requiredEnv('REVENUECAT_WEBHOOK_AUTHORIZATION');
  } catch {
    return json({ error: 'Webhook configuration is incomplete.' }, 503);
  }
  if (request.headers.get('Authorization') !== webhookAuthorization) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  let revenueCatAppUserId = '';
  try {
    const body = await request.json();
    revenueCatAppUserId = typeof body?.event?.app_user_id === 'string' ? body.event.app_user_id : '';
  } catch {
    return json({ error: 'Invalid webhook payload.' }, 400);
  }
  if (!UUID_PATTERN.test(revenueCatAppUserId)) return json({ received: true });

  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(revenueCatAppUserId)}`, {
      headers: { Authorization: `Bearer ${revenueCatSecret}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('RevenueCat subscriber lookup failed.');
    const body = await response.json();
    const subscriber = body?.subscriber && typeof body.subscriber === 'object' ? body.subscriber : {};
    const rawEntitlement = subscriber?.entitlements?.[entitlementId];
    const entitlement = rawEntitlement && typeof rawEntitlement === 'object'
      ? rawEntitlement as Record<string, unknown>
      : null;
    const expiresAt = entitlement ? activeThrough(entitlement) : undefined;
    const isActive = Boolean(entitlement && (expiresAt === null || (expiresAt && new Date(expiresAt) > new Date())));
    const productIdentifier = entitlement && typeof entitlement.product_identifier === 'string'
      ? entitlement.product_identifier.slice(0, 200)
      : null;
    const subscription = productIdentifier && subscriber?.subscriptions?.[productIdentifier];
    const store = subscription && typeof subscription.store === 'string' ? subscription.store.slice(0, 40) : null;
    const willRenew = subscription && typeof subscription === 'object' && expiresAt !== null
      ? subscription.unsubscribe_detected_at == null
      : null;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: purchaserProfile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .eq('id', revenueCatAppUserId)
      .maybeSingle();
    if (profileError) throw profileError;
    const { data: existing, error: existingError } = await admin
      .from('organization_subscriptions')
      .select('id')
      .eq('revenuecat_app_user_id', revenueCatAppUserId)
      .eq('entitlement_id', entitlementId)
      .maybeSingle();
    if (existingError) throw existingError;

    const refreshed = {
      purchaser_user_id: purchaserProfile?.id ?? null,
      revenuecat_app_user_id: revenueCatAppUserId,
      entitlement_id: entitlementId,
      status: isActive ? 'active' : 'inactive',
      product_identifier: productIdentifier,
      store,
      expires_at: expiresAt ?? null,
      will_renew: willRenew,
      revenuecat_checked_at: new Date().toISOString(),
    };
    const write = existing
      ? admin.from('organization_subscriptions').update(refreshed).eq('id', existing.id)
      : admin.from('organization_subscriptions').insert({ ...refreshed, organization_id: null });
    const { error } = await write;
    if (error) throw error;
    return json({ received: true });
  } catch {
    return json({ error: 'Subscription state could not be refreshed.' }, 503);
  }
});
