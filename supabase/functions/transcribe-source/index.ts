import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SOURCE_BUCKET = 'handoff-sources';
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 50_000;
const SUPPORTED_EXTENSIONS = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']);

type SourceRow = {
  id: string;
  organization_id: string;
  kind: string;
  storage_path: string | null;
  processing_status: string;
};

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  groqApiUrl: string;
  groqApiKey: string;
  transcriptionModel: string;
};

class TranscriptionError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
  }
}

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
    groqApiUrl: requiredEnv('GROQ_API_URL').replace(/\/$/, ''),
    groqApiKey: requiredEnv('GROQ_API_KEY'),
    transcriptionModel: requiredEnv('GROQ_TRANSCRIPTION_MODEL'),
  };
}

function extensionFor(path: string) {
  const filename = path.split('/').pop() ?? '';
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension && extension !== filename.toLowerCase() ? extension : '';
}

function filenameFor(path: string) {
  return path.split('/').pop()?.slice(-120) || 'recording.m4a';
}

function groqError(status: number) {
  if (status === 401 || status === 403) {
    return new TranscriptionError('Transcription is temporarily unavailable because the service connection needs attention.');
  }
  if (status === 413) {
    return new TranscriptionError('This recording is too large to transcribe. Record a shorter voice note and try again.');
  }
  if (status === 429) {
    return new TranscriptionError('Transcription is busy right now. Wait a moment and retry.');
  }
  if (status >= 400 && status < 500) {
    return new TranscriptionError('Relay could not read this recording. Try recording it again or add the transcript manually.');
  }
  return new TranscriptionError('Relay could not transcribe this recording. Your audio is safe; retry in a moment.');
}

async function markFailed(
  admin: ReturnType<typeof createClient>,
  sourceId: string,
  error: unknown,
) {
  const message = error instanceof TranscriptionError
    ? error.publicMessage
    : 'Relay could not transcribe this recording. Your audio is safe; retry in a moment.';
  await admin
    .from('sources')
    .update({ processing_status: 'failed', failure_reason: message.slice(0, 500) })
    .eq('id', sourceId)
    .eq('processing_status', 'processing');
}

async function transcribe(
  config: ServerConfig,
  admin: ReturnType<typeof createClient>,
  source: SourceRow,
) {
  try {
    const extension = extensionFor(source.storage_path!);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new TranscriptionError('This recording format is not supported. Record again using M4A or WebM.');
    }

    const { data: file, error: downloadError } = await admin.storage
      .from(SOURCE_BUCKET)
      .download(source.storage_path!);
    if (downloadError || !file) {
      throw new TranscriptionError('Relay could not retrieve the saved recording. Record it again or add the transcript manually.');
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new TranscriptionError('This recording is larger than Relay’s 25 MB limit. Record a shorter voice note.');
    }

    const form = new FormData();
    form.append('file', file, filenameFor(source.storage_path!));
    form.append('model', config.transcriptionModel);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const response = await fetch(`${config.groqApiUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw groqError(response.status);

    const transcript = typeof body.text === 'string' ? body.text.trim() : '';
    if (!transcript) {
      throw new TranscriptionError('Relay could not hear clear speech in this recording. Record again or add the transcript manually.');
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      throw new TranscriptionError('This transcript is too long to save safely. Record a shorter voice note.');
    }

    const requestId = typeof body.x_groq?.id === 'string' ? body.x_groq.id : null;
    const { error: updateError } = await admin
      .from('sources')
      .update({
        text_content: transcript,
        processing_status: 'ready',
        failure_reason: null,
        provider_reference: requestId ? `groq:${requestId}` : 'groq:transcription',
      })
      .eq('id', source.id)
      .eq('processing_status', 'processing');
    if (updateError) throw updateError;
  } catch (error) {
    console.error('Voice transcription failed', error instanceof Error ? error.message : 'unknown error');
    await markFailed(admin, source.id, error);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let config: ServerConfig;
  try {
    config = readConfig();
  } catch {
    return json({ error: 'Server configuration is incomplete.' }, 500);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const userClient = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let sourceId = '';
  try {
    const body = await request.json();
    sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
  } catch {
    return json({ error: 'A source ID is required.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    return json({ error: 'A valid source ID is required.' }, 400);
  }

  const { data: source, error: sourceError } = await userClient
    .from('sources')
    .select('id, organization_id, handoff_id, kind, storage_path, processing_status')
    .eq('id', sourceId)
    .maybeSingle();
  if (sourceError || !source) return json({ error: 'This source is unavailable.' }, 404);
  if (source.kind !== 'voice' || !source.storage_path) {
    return json({ error: 'This source is not a voice recording.' }, 400);
  }

  const { data: isAdmin, error: adminCheckError } = await userClient.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: source.handoff_id,
  });
  if (adminCheckError || !isAdmin) return json({ error: 'You do not have permission to transcribe this source.' }, 403);

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { error: statusError } = await admin
    .from('sources')
    .update({ processing_status: 'processing', failure_reason: null })
    .eq('id', source.id);
  if (statusError) return json({ error: 'Relay could not start transcription.' }, 500);

  await transcribe(config, admin, source as SourceRow);
  const { data: completed } = await admin
    .from('sources')
    .select('processing_status, failure_reason')
    .eq('id', source.id)
    .single();
  if (completed?.processing_status === 'failed') {
    return json({ error: completed.failure_reason ?? 'Transcription failed.', sourceId: source.id }, 422);
  }
  return json({ ready: true, sourceId: source.id });
});
