import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SOURCE_BUCKET = 'handoff-sources';
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_TEXT_CHARS = 50_000;
const MAX_VECTORIZE_CHARS = 1_600;
const VECTORIZE_OVERLAP_CHARS = 160;
const MAX_INDEXED_CHUNKS = 1_200;
const ASTRA_BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_MS = 110_000;

const DIRECT_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);
const UNSTRUCTURED_EXTENSIONS = new Set(['bmp', 'docx', 'heic', 'jpeg', 'jpg', 'pdf', 'png', 'pptx']);

type SourceRow = {
  id: string;
  organization_id: string;
  handoff_id: string;
  kind: string;
  title: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  processing_status: string;
  provider_reference: string | null;
};

type TransformElement = {
  element_id?: string;
  type?: string;
  text?: string | null;
  metadata?: {
    page_number?: number | null;
  } | null;
};

type TransformResult = {
  id?: string;
  status?: string;
  elements?: TransformElement[];
  warnings?: Array<{ code?: string; message?: string }>;
};

type IndexedChunk = {
  elementId: string;
  elementType: string;
  pageNumber: number | null;
  segmentIndex: number;
  text: string;
};

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  unstructuredUrl: string;
  unstructuredKey: string;
  astraEndpoint: string;
  astraToken: string;
  astraKeyspace: string;
  astraCollection: string;
  astraDimensions: number;
  astraMetric: string;
};

class ProcessingError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly clearProviderReference = false,
  ) {
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
  const dimensions = Number(requiredEnv('ASTRA_DB_VECTOR_DIMENSIONS'));
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('ASTRA_DB_VECTOR_DIMENSIONS must be a positive integer.');
  }

  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    unstructuredUrl: requiredEnv('UNSTRUCTURED_API_URL').replace(/\/$/, ''),
    unstructuredKey: requiredEnv('UNSTRUCTURED_API_KEY'),
    astraEndpoint: requiredEnv('ASTRA_DB_API_ENDPOINT').replace(/\/$/, ''),
    astraToken: requiredEnv('ASTRA_DB_APPLICATION_TOKEN'),
    astraKeyspace: requiredEnv('ASTRA_DB_KEYSPACE'),
    astraCollection: requiredEnv('ASTRA_DB_COLLECTION'),
    astraDimensions: dimensions,
    astraMetric: requiredEnv('ASTRA_DB_VECTOR_METRIC').toLowerCase(),
  };
}

function extensionFor(path: string) {
  const filename = path.split('/').pop() ?? '';
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension && extension !== filename.toLowerCase() ? extension : '';
}

function safeFilename(path: string) {
  return path.split('/').pop()?.slice(-120) || 'document';
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function segmentText(text: string) {
  const normalized = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= MAX_VECTORIZE_CHARS) return [normalized];

  const segments: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + MAX_VECTORIZE_CHARS, normalized.length);
    if (end < normalized.length) {
      const preferredBreak = Math.max(
        normalized.lastIndexOf('\n', end),
        normalized.lastIndexOf(' ', end),
      );
      if (preferredBreak > start + Math.floor(MAX_VECTORIZE_CHARS * 0.6)) end = preferredBreak;
    }
    const segment = normalized.slice(start, end).trim();
    if (segment) segments.push(segment);
    if (end >= normalized.length) break;
    start = Math.max(end - VECTORIZE_OVERLAP_CHARS, start + 1);
  }
  return segments;
}

function chunksFromElements(elements: TransformElement[]): IndexedChunk[] {
  const chunks: IndexedChunk[] = [];
  elements.forEach((element, elementIndex) => {
    const text = typeof element.text === 'string' ? element.text : '';
    segmentText(text).forEach((segment, segmentIndex) => {
      chunks.push({
        elementId: element.element_id || `element-${elementIndex + 1}`,
        elementType: element.type || 'Text',
        pageNumber: Number.isInteger(element.metadata?.page_number)
          ? element.metadata!.page_number!
          : null,
        segmentIndex,
        text: segment,
      });
    });
  });

  if (chunks.length === 0) {
    throw new ProcessingError('Relay could not find readable text in this document. Try a clearer file or add the important information manually.');
  }
  if (chunks.length > MAX_INDEXED_CHUNKS) {
    throw new ProcessingError('This document contains too much text to index safely. Split it into smaller documents and try again.');
  }
  return chunks;
}

function transformError(status: number, body: unknown) {
  const code = typeof body === 'object' && body && 'code' in body ? String(body.code) : '';
  if (status === 401 || status === 403) {
    return new ProcessingError('Document processing is temporarily unavailable because the service connection needs attention.');
  }
  if (status === 413 || code === 'file_too_large') {
    return new ProcessingError('This document is too large to process. Choose a file smaller than 25 MB.');
  }
  if (status === 415 || code === 'unsupported_file_type') {
    return new ProcessingError('This document format is not supported. Use PDF, DOCX, PPTX, TXT, Markdown, CSV, JPEG, PNG, BMP, or HEIC.');
  }
  if (status === 422 || code === 'could_not_parse') {
    return new ProcessingError('Relay could not read this document. Check that the file opens correctly, then try again.');
  }
  if (status === 429 || code === 'rate_limited' || code === 'quota_exceeded') {
    return new ProcessingError('Document processing is busy right now. Wait a moment and retry.');
  }
  return new ProcessingError('Relay could not process this document. Your original file is safe; retry in a moment.');
}

function transformJobUrl(config: ServerConfig, jobId: string) {
  return `${config.unstructuredUrl}/jobs/${encodeURIComponent(jobId)}?output=elements`;
}

async function updateProviderReference(
  admin: ReturnType<typeof createClient>,
  sourceId: string,
  jobId: string,
) {
  const { error } = await admin
    .from('sources')
    .update({ provider_reference: `unstructured:${jobId}` })
    .eq('id', sourceId)
    .eq('processing_status', 'processing');
  if (error) throw error;
}

async function pollTransformJob(config: ServerConfig, jobId: string): Promise<TransformResult | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_MS) {
    const response = await fetch(transformJobUrl(config, jobId), {
      headers: {
        'unstructured-api-key': config.unstructuredKey,
        accept: 'application/json',
      },
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw transformError(response.status, body);

    const status = typeof body.status === 'string' ? body.status : '';
    if (status === 'completed' || status === 'completed_with_warnings') {
      if (!body.result || !Array.isArray(body.result.elements)) {
        throw new ProcessingError('Document processing finished without readable content. Try another file.');
      }
      return body.result as TransformResult;
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new ProcessingError('Document processing did not complete. Check the file and retry.', true);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new ProcessingError('This document is taking longer than expected. Retry to continue checking it; your original file is safe.');
}

async function parseWithUnstructured(
  config: ServerConfig,
  admin: ReturnType<typeof createClient>,
  source: SourceRow,
  file: Blob,
): Promise<TransformResult> {
  const existingJobId = source.provider_reference?.startsWith('unstructured:')
    ? source.provider_reference.slice('unstructured:'.length)
    : null;
  if (existingJobId) {
    const existingResult = await pollTransformJob(config, existingJobId);
    if (existingResult) return existingResult;
  }

  const form = new FormData();
  form.append('input', file, safeFilename(source.storage_path!));
  form.append('output', 'elements');
  form.append('profile', 'balanced');

  const response = await fetch(`${config.unstructuredUrl}/parse`, {
    method: 'POST',
    headers: {
      'unstructured-api-key': config.unstructuredKey,
      Prefer: 'wait=0',
    },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw transformError(response.status, body);

  if (response.status === 200) {
    if (!Array.isArray(body.elements)) {
      throw new ProcessingError('Document processing finished without readable content. Try another file.');
    }
    if (typeof body.id === 'string') await updateProviderReference(admin, source.id, body.id);
    return body as TransformResult;
  }

  const jobId = typeof body.id === 'string' ? body.id : null;
  if (!jobId) throw new ProcessingError('Document processing did not return a valid job. Retry in a moment.');
  await updateProviderReference(admin, source.id, jobId);
  const result = await pollTransformJob(config, jobId);
  if (!result) throw new ProcessingError('The document-processing result expired. Retry to process the original file again.', true);
  return result;
}

async function astraCommand(
  config: ServerConfig,
  path: 'keyspace' | 'collection',
  command: Record<string, unknown>,
) {
  const suffix = path === 'keyspace'
    ? encodeURIComponent(config.astraKeyspace)
    : `${encodeURIComponent(config.astraKeyspace)}/${encodeURIComponent(config.astraCollection)}`;
  const response = await fetch(`${config.astraEndpoint}/api/json/v1/${suffix}`, {
    method: 'POST',
    headers: {
      Token: config.astraToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body.errors) && body.errors.length > 0)) {
    throw new ProcessingError('Relay could not update its document index. Your original file is safe; retry in a moment.');
  }
  return body;
}

async function validateAstraCollection(config: ServerConfig) {
  const result = await astraCommand(config, 'keyspace', {
    findCollections: { options: { explain: true } },
  });
  const collections = Array.isArray(result?.status?.collections) ? result.status.collections : [];
  const collection = collections.find((candidate: { name?: string }) => candidate.name === config.astraCollection);
  const vector = collection?.options?.vector;
  if (!collection || !vector?.service) {
    throw new ProcessingError('Relay’s document index is not configured for automatic embeddings.');
  }
  if (vector.dimension !== config.astraDimensions || String(vector.metric).toLowerCase() !== config.astraMetric) {
    throw new ProcessingError('Relay’s document index settings do not match the configured dimensions and similarity metric.');
  }
}

async function cleanupAstraRun(config: ServerConfig, sourceId: string, runId: string) {
  await astraCommand(config, 'collection', {
    deleteMany: { filter: { source_id: sourceId, processing_run_id: runId } },
  });
}

async function indexChunks(
  config: ServerConfig,
  source: SourceRow,
  chunks: IndexedChunk[],
) {
  await validateAstraCollection(config);
  const runId = crypto.randomUUID();
  const indexedAt = new Date().toISOString();

  try {
    for (let start = 0; start < chunks.length; start += ASTRA_BATCH_SIZE) {
      const batch = chunks.slice(start, start + ASTRA_BATCH_SIZE).map((chunk, offset) => ({
        _id: `${source.id}:${runId}:${start + offset}`,
        $vectorize: chunk.text,
        text: chunk.text,
        organization_id: source.organization_id,
        handoff_id: source.handoff_id,
        source_id: source.id,
        source_title: source.title,
        source_kind: source.kind,
        element_id: chunk.elementId,
        element_type: chunk.elementType,
        page_number: chunk.pageNumber,
        segment_index: chunk.segmentIndex,
        processing_run_id: runId,
        indexed_at: indexedAt,
      }));
      await astraCommand(config, 'collection', {
        insertMany: { documents: batch, options: { ordered: true } },
      });
    }

    await astraCommand(config, 'collection', {
      deleteMany: {
        filter: {
          source_id: source.id,
          processing_run_id: { $ne: runId },
        },
      },
    });
  } catch (error) {
    try {
      await cleanupAstraRun(config, source.id, runId);
    } catch {
      // Preserve the original indexing error. A future successful run removes stale chunks.
    }
    throw error;
  }

  return { runId, indexedAt };
}

async function sourceStillProcessing(admin: ReturnType<typeof createClient>, sourceId: string) {
  const { data, error } = await admin
    .from('sources')
    .select('processing_status')
    .eq('id', sourceId)
    .maybeSingle();
  if (error) throw error;
  return data?.processing_status === 'processing';
}

async function markFailed(
  admin: ReturnType<typeof createClient>,
  sourceId: string,
  error: unknown,
) {
  const processingError = error instanceof ProcessingError
    ? error
    : new ProcessingError('Relay could not process this document. Your original file is safe; retry in a moment.');
  const update: Record<string, unknown> = {
    processing_status: 'failed',
    failure_reason: processingError.publicMessage.slice(0, 500),
  };
  if (processingError.clearProviderReference) update.provider_reference = null;
  await admin.from('sources').update(update).eq('id', sourceId).eq('processing_status', 'processing');
}

async function processDocument(
  config: ServerConfig,
  admin: ReturnType<typeof createClient>,
  source: SourceRow,
) {
  try {
    const extension = extensionFor(source.storage_path!);
    if (!DIRECT_TEXT_EXTENSIONS.has(extension) && !UNSTRUCTURED_EXTENSIONS.has(extension)) {
      throw new ProcessingError('This document format is not supported. Use PDF, DOCX, PPTX, TXT, Markdown, CSV, JPEG, PNG, BMP, or HEIC.');
    }

    const { data: file, error: downloadError } = await admin.storage
      .from(SOURCE_BUCKET)
      .download(source.storage_path!);
    if (downloadError || !file) {
      throw new ProcessingError('Relay could not retrieve the saved document. Upload it again or add the information manually.');
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new ProcessingError('This document is larger than Relay’s 25 MB limit. Choose a smaller file.');
    }

    let elements: TransformElement[];
    let providerReference = source.provider_reference;
    if (DIRECT_TEXT_EXTENSIONS.has(extension)) {
      const text = await file.text();
      elements = [{
        element_id: 'plain-text',
        type: extension === 'csv' ? 'Table' : 'NarrativeText',
        text,
        metadata: { page_number: null },
      }];
      providerReference = 'direct-text';
    } else {
      const parsed = await parseWithUnstructured(config, admin, source, file);
      elements = parsed.elements ?? [];
      if (parsed.id) providerReference = `unstructured:${parsed.id}`;
    }

    const chunks = chunksFromElements(elements);
    const sourceText = elements
      .map((element) => typeof element.text === 'string' ? element.text.trim() : '')
      .filter(Boolean)
      .join('\n\n')
      .slice(0, MAX_SOURCE_TEXT_CHARS);

    if (!await sourceStillProcessing(admin, source.id)) return;
    const indexed = await indexChunks(config, source, chunks);
    const { data: updated, error: updateError } = await admin
      .from('sources')
      .update({
        text_content: sourceText,
        processing_status: 'ready',
        failure_reason: null,
        provider_reference: providerReference ?? `astra:${indexed.runId}`,
      })
      .eq('id', source.id)
      .eq('processing_status', 'processing')
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) await cleanupAstraRun(config, source.id, indexed.runId);
  } catch (error) {
    console.error('Document source processing failed', error instanceof Error ? error.message : 'unknown error');
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
    .select('id, organization_id, handoff_id, kind, title, storage_path, mime_type, size_bytes, processing_status, provider_reference')
    .eq('id', sourceId)
    .maybeSingle();
  if (sourceError || !source) return json({ error: 'This source is unavailable.' }, 404);
  if (source.kind !== 'document' || !source.storage_path) {
    return json({ error: 'This source is not a processable document.' }, 400);
  }

  const { data: isAdmin, error: adminCheckError } = await userClient.rpc('is_organization_admin', {
    requested_organization_id: source.organization_id,
  });
  if (adminCheckError || !isAdmin) return json({ error: 'You do not have permission to process this source.' }, 403);

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { error: statusError } = await admin
    .from('sources')
    .update({ processing_status: 'processing', failure_reason: null })
    .eq('id', source.id);
  if (statusError) return json({ error: 'Relay could not start document processing.' }, 500);

  const task = processDocument(config, admin, source as SourceRow);
  const edgeRuntime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (edgeRuntime) edgeRuntime.waitUntil(task);
  else await task;

  return json({ accepted: true, sourceId: source.id }, 202);
});
