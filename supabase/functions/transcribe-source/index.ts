import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-relay-handoff-id, x-relay-file-name',
};

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 50_000;
const SUPPORTED_EXTENSIONS = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']);
const SUPPORTED_MIME_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
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
    groqApiUrl: requiredEnv('GROQ_API_URL').replace(/\/$/, ''),
    groqApiKey: requiredEnv('GROQ_API_KEY'),
    transcriptionModel: requiredEnv('GROQ_TRANSCRIPTION_MODEL'),
  };
}

function groqError(status: number) {
  if (status === 401 || status === 403) {
    return new TranscriptionError('Transcription is temporarily unavailable because the service connection needs attention.');
  }
  if (status === 413) {
    return new TranscriptionError('This recording is too large to transcribe. Record a shorter voice note and try again.');
  }
  if (status === 429) {
    return new TranscriptionError('Transcription is busy right now. Wait a moment and try again.');
  }
  return new TranscriptionError("We couldn't transcribe this recording.");
}

function publicErrorMessage(error: unknown) {
  return error instanceof TranscriptionError ? error.publicMessage : "We couldn't transcribe this recording.";
}

async function transcribe(config: ServerConfig, audio: Blob, fileName: string) {
  const form = new FormData();
  form.append('file', audio, fileName);
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
  if (!transcript) throw new TranscriptionError("We couldn't transcribe this recording.");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new TranscriptionError('This transcript is too long to save safely. Record a shorter voice note.');
  }

  const requestId = typeof body.x_groq?.id === 'string' ? body.x_groq.id : null;
  return {
    transcript,
    providerReference: requestId ? `groq:${requestId}` : 'groq:transcription',
  };
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

  const handoffId = request.headers.get('x-relay-handoff-id')?.trim() ?? '';
  const fileName = request.headers.get('x-relay-file-name')?.trim() ?? '';
  const mimeType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!UUID_PATTERN.test(handoffId)) return json({ error: 'A valid handoff is required.' }, 400);
  if (!fileName || fileName.length > 120 || !SUPPORTED_EXTENSIONS.has(extension) || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    return json({ error: 'This recording format is not supported. Record again using M4A or WebM.' }, 400);
  }
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    return json({ error: 'This recording is larger than Relay’s 25 MB limit.' }, 413);
  }

  const { data: isRoleHolder, error: roleCheckError } = await userClient.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: handoffId,
  });
  if (roleCheckError || !isRoleHolder) {
    return json({ error: 'You do not have permission to transcribe this recording.' }, 403);
  }

  const audio = await request.blob();
  if (!audio.size) return json({ error: 'The recording is empty.' }, 400);
  if (audio.size > MAX_SOURCE_BYTES) return json({ error: 'This recording is larger than Relay’s 25 MB limit.' }, 413);

  try {
    return json(await transcribe(config, audio, fileName));
  } catch (error) {
    console.error('Voice transcription failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: publicErrorMessage(error) }, 422);
  }
});
