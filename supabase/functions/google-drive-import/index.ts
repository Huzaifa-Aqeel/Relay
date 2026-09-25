import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import {
  DRIVE_FILE_SCOPE,
  driveImportSpec,
  driveSourceTitle,
  MAX_DRIVE_FILE_BYTES,
  parsePickedFileIds,
  safeDriveFileName,
  SUPPORTED_DRIVE_MIME_TYPES,
  GOOGLE_NATIVE_EXPORTS,
  type DriveFileMetadata,
} from '../_shared/google-drive-import.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SOURCE_BUCKET = 'handoff-sources';
const STATE_TTL_SECONDS = 10 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Config = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  clientId: string;
  clientSecret: string;
  stateSecret: string;
  callbackUrl: string;
  allowedWebOrigins: Set<string>;
};

type StatePayload = {
  userId: string;
  organizationId: string;
  handoffId: string;
  captureId: string;
  returnUrl: string;
  expiresAt: number;
  nonce: string;
};

type ImportedFile = {
  sourceId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function readConfig(): Config {
  const stateSecret = requiredEnv('GOOGLE_DRIVE_STATE_SECRET');
  if (stateSecret.length < 32) throw new Error('GOOGLE_DRIVE_STATE_SECRET must contain at least 32 characters.');
  const allowedWebOrigins = new Set(
    requiredEnv('GOOGLE_DRIVE_ALLOWED_WEB_ORIGINS')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    clientId: requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    stateSecret,
    callbackUrl: requiredEnv('GOOGLE_DRIVE_CALLBACK_URL'),
    allowedWebOrigins,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function createState(config: Config, payload: StatePayload) {
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = encodeBase64Url(await hmac(config.stateSecret, encodedPayload));
  return `${encodedPayload}.${signature}`;
}

async function readState(config: Config, state: string): Promise<StatePayload | null> {
  const [encodedPayload, providedSignature, extra] = state.split('.');
  if (!encodedPayload || !providedSignature || extra) return null;
  const expected = await hmac(config.stateSecret, encodedPayload);
  let provided: Uint8Array;
  try {
    provided = decodeBase64Url(providedSignature);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ provided[index];
  if (mismatch !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as StatePayload;
    if (!UUID_PATTERN.test(payload.userId) || !UUID_PATTERN.test(payload.organizationId)
      || !UUID_PATTERN.test(payload.handoffId) || !UUID_PATTERN.test(payload.captureId)
      || typeof payload.nonce !== 'string' || !payload.nonce
      || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function validReturnUrl(config: Config, value: string) {
  try {
    const target = new URL(value);
    if (target.protocol === 'relay:' && (target.hostname === 'drive-import' || target.pathname === '/drive-import')) {
      return target.toString();
    }
    if ((target.protocol === 'https:' || target.protocol === 'http:')
      && config.allowedWebOrigins.has(target.origin.replace(/\/$/, ''))
      && target.pathname === '/drive-import') return target.toString();
  } catch {
    // Invalid return URLs are rejected below.
  }
  return null;
}

function resultUrl(returnUrl: string, status: 'success' | 'cancelled' | 'failed', counts: {
  imported?: number;
  duplicates?: number;
  skipped?: number;
} = {}) {
  const target = new URL(returnUrl);
  target.searchParams.set('drive_status', status);
  if (counts.imported !== undefined) target.searchParams.set('drive_imported', String(counts.imported));
  if (counts.duplicates !== undefined) target.searchParams.set('drive_duplicates', String(counts.duplicates));
  if (counts.skipped !== undefined) target.searchParams.set('drive_skipped', String(counts.skipped));
  return target.toString();
}

function redirectResult(returnUrl: string, status: 'success' | 'cancelled' | 'failed', counts: {
  imported?: number;
  duplicates?: number;
  skipped?: number;
} = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: resultUrl(returnUrl, status, counts), 'Cache-Control': 'no-store' },
  });
}

async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(admin: ReturnType<typeof createClient>, payload: StatePayload) {
  const { data: capture } = await admin.from('captures')
    .select('id, organization_id, handoff_id')
    .eq('id', payload.captureId)
    .eq('organization_id', payload.organizationId)
    .eq('handoff_id', payload.handoffId)
    .maybeSingle();
  if (!capture) return false;
  const { data: handoff } = await admin.from('handoffs')
    .select('role_id, service_period, status')
    .eq('id', payload.handoffId)
    .eq('organization_id', payload.organizationId)
    .maybeSingle();
  if (!handoff || handoff.status !== 'draft') return false;
  const { data: membership } = await admin.from('organization_members')
    .select('user_id')
    .eq('organization_id', payload.organizationId)
    .eq('user_id', payload.userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) return false;
  const { data: assignment } = await admin.from('role_assignments')
    .select('id')
    .eq('organization_id', payload.organizationId)
    .eq('role_id', handoff.role_id)
    .eq('service_period', handoff.service_period)
    .eq('user_id', payload.userId)
    .eq('status', 'active')
    .maybeSingle();
  return Boolean(assignment);
}

async function exchangeCode(config: Config, code: string) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json().catch(() => ({}));
  const accessToken = typeof result.access_token === 'string' ? result.access_token : null;
  if (!response.ok || !accessToken) throw new Error('Google authorization-code exchange failed.');
  return accessToken;
}

function googleAuthorizationUrl(config: Config, state: string) {
  const pickerMimeTypes = [...SUPPORTED_DRIVE_MIME_TYPES, ...Object.keys(GOOGLE_NATIVE_EXPORTS)];
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const parameters: Record<string, string> = {
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: DRIVE_FILE_SCOPE,
    access_type: 'online',
    // One Picker permits only drive.file. Do not merge profile/email grants
    // previously issued to this OAuth client by Google sign-in.
    include_granted_scopes: 'false',
    // Consent is mandatory for One Picker. Account selection also avoids
    // silently reusing a stale or unintended Google account on mobile.
    prompt: 'select_account consent',
    trigger_onepick: 'true',
    allow_multiple: 'true',
    mimetypes: pickerMimeTypes.join(','),
    state,
  };
  authUrl.search = new URLSearchParams(parameters).toString();
  return authUrl.toString();
}

async function driveMetadata(accessToken: string, fileId: string): Promise<DriveFileMetadata> {
  const fields = 'id,name,mimeType,size,trashed,capabilities(canDownload)';
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error('Google Drive metadata request failed.');
  return await response.json();
}

async function driveBytes(accessToken: string, metadata: DriveFileMetadata) {
  const spec = driveImportSpec(metadata);
  if (!spec) throw new Error('unsupported');
  const metadataSize = Number(metadata.size ?? 0);
  if (Number.isFinite(metadataSize) && metadataSize > MAX_DRIVE_FILE_BYTES) throw new Error('too_large');
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.id)}`;
  const url = spec.mode === 'export'
    ? `${base}/export?mimeType=${encodeURIComponent(spec.mimeType)}`
    : `${base}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('download_failed');
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_DRIVE_FILE_BYTES) throw new Error('too_large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error('empty');
  if (bytes.byteLength > MAX_DRIVE_FILE_BYTES) throw new Error('too_large');
  return { bytes, spec };
}

async function importFile(
  admin: ReturnType<typeof createClient>,
  payload: StatePayload,
  accessToken: string,
  fileId: string,
  position: number,
): Promise<{ kind: 'imported'; file: ImportedFile } | { kind: 'duplicate' } | { kind: 'skipped' }> {
  try {
    const metadata = await driveMetadata(accessToken, fileId);
    if (metadata.trashed || metadata.capabilities?.canDownload === false) return { kind: 'skipped' };
    const { bytes, spec } = await driveBytes(accessToken, metadata);
    const contentHash = await sha256(bytes);
    const { data: duplicate, error: duplicateError } = await admin.from('sources')
      .select('id')
      .eq('organization_id', payload.organizationId)
      .eq('handoff_id', payload.handoffId)
      .eq('kind', 'document')
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return { kind: 'duplicate' };

    const sourceId = crypto.randomUUID();
    const fileName = safeDriveFileName(spec.fileName);
    const storagePath = `${payload.organizationId}/${payload.handoffId}/${sourceId}/${fileName}`;
    const uploaded = await admin.storage.from(SOURCE_BUCKET).upload(storagePath, bytes, {
      contentType: spec.mimeType,
      upsert: false,
    });
    if (uploaded.error) throw uploaded.error;

    const inserted = await admin.from('sources').insert({
      id: sourceId,
      organization_id: payload.organizationId,
      handoff_id: payload.handoffId,
      created_by: payload.userId,
      kind: 'document',
      title: driveSourceTitle(fileName),
      storage_path: storagePath,
      mime_type: spec.mimeType,
      size_bytes: bytes.byteLength,
      processing_status: 'pending',
      content_hash: contentHash,
    });
    if (inserted.error) {
      await admin.storage.from(SOURCE_BUCKET).remove([storagePath]);
      if (inserted.error.code === '23505') return { kind: 'duplicate' };
      throw inserted.error;
    }

    const linked = await admin.from('capture_sources').insert({
      capture_id: payload.captureId,
      source_id: sourceId,
      organization_id: payload.organizationId,
      handoff_id: payload.handoffId,
      relationship: 'attachment',
      position,
      created_for_capture: true,
    });
    if (linked.error) {
      await admin.from('sources').delete().eq('id', sourceId);
      await admin.storage.from(SOURCE_BUCKET).remove([storagePath]);
      throw linked.error;
    }
    return {
      kind: 'imported',
      file: {
        sourceId,
        title: driveSourceTitle(fileName),
        mimeType: spec.mimeType,
        sizeBytes: bytes.byteLength,
        contentHash,
      },
    };
  } catch (error) {
    console.error('Google Drive file import skipped', error instanceof Error ? error.message : 'unknown error');
    return { kind: 'skipped' };
  }
}

async function importSelectedFiles(
  admin: ReturnType<typeof createClient>,
  payload: StatePayload,
  accessToken: string,
  fileIds: string[],
) {
  const { data: lastLink } = await admin.from('capture_sources')
    .select('position')
    .eq('capture_id', payload.captureId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = (lastLink?.position ?? 0) + 1;
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const fileId of fileIds) {
    const result = await importFile(admin, payload, accessToken, fileId, position);
    if (result.kind === 'imported') {
      imported += 1;
      position += 1;
    } else if (result.kind === 'duplicate') duplicates += 1;
    else skipped += 1;
  }
  return { imported, duplicates, skipped };
}

async function authenticatedUser(request: Request, config: Config) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const userClient = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return null;
  return { userClient, user: userData.user };
}

async function handleStart(request: Request, config: Config) {
  const authenticated = await authenticatedUser(request, config);
  if (!authenticated) return json({ error: 'Your session is no longer valid.' }, 401);
  const { userClient, user } = authenticated;

  const body = await request.json().catch(() => ({}));
  const captureId = typeof body.captureId === 'string' ? body.captureId : '';
  const returnUrl = typeof body.returnUrl === 'string' ? validReturnUrl(config, body.returnUrl) : null;
  if (!UUID_PATTERN.test(captureId) || !returnUrl) return json({ error: 'The Drive import request is invalid.' }, 400);
  const { data: capture, error: captureError } = await userClient.from('captures')
    .select('id, organization_id, handoff_id')
    .eq('id', captureId)
    .maybeSingle();
  if (captureError || !capture) return json({ error: 'This Capture is unavailable.' }, 404);
  const { data: isHolder, error: holderError } = await userClient.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: capture.handoff_id,
  });
  if (holderError || !isHolder) return json({ error: 'You do not have permission to import files here.' }, 403);

  const state = await createState(config, {
    userId: user.id,
    organizationId: capture.organization_id,
    handoffId: capture.handoff_id,
    captureId: capture.id,
    returnUrl,
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  });
  return json({ authUrl: googleAuthorizationUrl(config, state) });
}

async function handleCallback(request: Request, config: Config) {
  const url = new URL(request.url);
  const payload = await readState(config, url.searchParams.get('state') ?? '');
  if (!payload) return new Response('This Google Drive import link is invalid or expired.', { status: 400 });
  const returnUrl = validReturnUrl(config, payload.returnUrl);
  if (!returnUrl) return new Response('This Google Drive return address is unavailable.', { status: 400 });
  if (url.searchParams.get('error')) return redirectResult(returnUrl, 'cancelled');
  const code = url.searchParams.get('code');
  const fileIds = parsePickedFileIds(url.searchParams.get('picked_file_ids'));
  if (!code || !fileIds.length) return redirectResult(returnUrl, 'cancelled');

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  if (!await isAuthorized(admin, payload)) return redirectResult(returnUrl, 'failed');
  try {
    const accessToken = await exchangeCode(config, code);
    const counts = await importSelectedFiles(admin, payload, accessToken, fileIds);
    return redirectResult(returnUrl, 'success', counts);
  } catch (error) {
    console.error('Google Drive import failed', error instanceof Error ? error.message : 'unknown error');
    return redirectResult(returnUrl, 'failed');
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let config: Config;
  try {
    config = readConfig();
  } catch (error) {
    console.error('Google Drive import configuration is incomplete', error instanceof Error ? error.message : 'unknown error');
    return request.method === 'GET'
      ? new Response('Google Drive import is not configured.', { status: 500 })
      : json({ error: 'Google Drive import is not configured.' }, 500);
  }

  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/callback')) return handleCallback(request, config);
  if (request.method === 'POST') return handleStart(request, config);
  return json({ error: 'Method not allowed.' }, 405);
});
