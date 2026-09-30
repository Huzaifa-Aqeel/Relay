export type TextLlmMessage = {
  role: string;
  content: string;
};

export type TextLlmConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  enableThinking: boolean;
  reasoningEffort: string | null;
  thinkingBudget: number | null;
  maxOutputTokens: number | null;
  requestTimeoutMs: number;
};

type EnvReader = (name: string) => string | undefined;

export class TextLlmError extends Error {
  constructor(
    message: string,
    public readonly kind: 'provider' | 'output',
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly providerCode = '',
  ) {
    super(message);
  }
}

function firstEnv(readEnv: EnvReader, names: string[]) {
  for (const name of names) {
    const value = readEnv(name)?.trim();
    if (value) return value;
  }
  return '';
}

function booleanEnv(readEnv: EnvReader, name: string, fallback: boolean) {
  const value = readEnv(name)?.trim().toLocaleLowerCase('en-US');
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid server configuration: ${name}`);
}

function optionalPositiveInteger(readEnv: EnvReader, name: string) {
  const raw = readEnv(name)?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid server configuration: ${name}`);
  return value;
}

function boundedIntegerEnv(readEnv: EnvReader, name: string, fallback: number, minimum: number, maximum: number) {
  const raw = readEnv(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid server configuration: ${name}`);
  }
  return value;
}

/**
 * Provider-neutral OpenAI-compatible text-model configuration.
 *
 * The generic LLM_* names keep Relay workflows independent of a provider.
 * DASHSCOPE_* aliases are accepted so an existing Alibaba Model Studio secret
 * can be adopted without duplicating its value.
 */
export function readTextLlmConfig(readEnv: EnvReader): TextLlmConfig {
  const apiUrl = firstEnv(readEnv, ['LLM_API_URL', 'DASHSCOPE_BASE_URL']);
  const apiKey = firstEnv(readEnv, ['LLM_API_KEY', 'DASHSCOPE_API_KEY']);
  const model = firstEnv(readEnv, ['LLM_MODEL', 'DASHSCOPE_MODEL']);
  if (!apiUrl) throw new Error('Missing server configuration: LLM_API_URL');
  if (!apiKey) throw new Error('Missing server configuration: LLM_API_KEY');
  if (!model) throw new Error('Missing server configuration: LLM_MODEL');

  const reasoningEffort = firstEnv(readEnv, ['LLM_REASONING_EFFORT']) || null;
  const thinkingBudget = optionalPositiveInteger(readEnv, 'LLM_THINKING_BUDGET');
  if (reasoningEffort && thinkingBudget) {
    throw new Error('Invalid server configuration: use LLM_REASONING_EFFORT or LLM_THINKING_BUDGET, not both');
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    // Grounded Relay extraction should be deterministic by default. Individual
    // deployments may opt into provider reasoning explicitly when it helps.
    enableThinking: booleanEnv(readEnv, 'LLM_ENABLE_THINKING', false),
    reasoningEffort,
    thinkingBudget,
    // Omitted by default. This lets the selected model/provider own its output
    // allowance instead of silently truncating valid Relay JSON.
    maxOutputTokens: optionalPositiveInteger(readEnv, 'LLM_MAX_OUTPUT_TOKENS'),
    // Supabase's request idle limit is 150 seconds. Abort first so the caller
    // can persist a terminal failure instead of leaving product state stuck.
    requestTimeoutMs: boundedIntegerEnv(readEnv, 'LLM_REQUEST_TIMEOUT_MS', 120_000, 10_000, 140_000),
  };
}

function providerCode(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return '';
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
}

function completionContent(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return [];
    const value = (part as Record<string, unknown>).text;
    return typeof value === 'string' ? [value] : [];
  }).join('');
  return text || null;
}

function embeddedJson(content: string) {
  for (let start = 0; start < content.length; start += 1) {
    const opener = content[start];
    if (opener !== '{' && opener !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const character = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') stack.push(character);
      if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          try {
            return JSON.parse(content.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/** Parse the final JSON while tolerating a fence or harmless surrounding prose. */
export function parseTextLlmJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch {
    const recovered = embeddedJson(jsonText);
    if (recovered !== null) return recovered;
    throw new TextLlmError('The text model returned unreadable JSON.', 'output', 502, true);
  }
}

function jsonContract(schema: unknown) {
  return [
    'FINAL RESPONSE CONTRACT:',
    'Return exactly one valid JSON object and nothing else.',
    'Do not wrap it in Markdown. Do not include analysis, commentary, or XML tags in the final answer.',
    `The JSON object must match this schema: ${JSON.stringify(schema)}`,
  ].join('\n');
}

export async function requestTextLlmJson({
  config,
  messages,
  schema,
  temperature = 0,
  timeoutMs,
}: {
  config: TextLlmConfig;
  messages: TextLlmMessage[];
  schema: unknown;
  temperature?: number;
  /** Optional workflow-level remainder; never extends the configured cap. */
  timeoutMs?: number;
}) {
  const contract = jsonContract(schema);
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');
  const contractedMessages = firstSystemIndex >= 0
    ? messages.map((message, index) => index === firstSystemIndex
      ? { ...message, content: `${message.content}\n\n${contract}` }
      : message)
    : [{ role: 'system' as const, content: contract }, ...messages];
  const requestBody: Record<string, unknown> = {
    model: config.model,
    stream: false,
    temperature,
    messages: contractedMessages,
  };
  // Hybrid-thinking providers may enable reasoning when this field is omitted.
  // Always send the configured value so LLM_ENABLE_THINKING=false is honored.
  requestBody.enable_thinking = config.enableThinking;
  if (config.enableThinking && config.reasoningEffort) {
    requestBody.reasoning_effort = config.reasoningEffort;
  }
  if (config.enableThinking && config.thinkingBudget) {
    requestBody.thinking_budget = config.thinkingBudget;
  }
  if (config.maxOutputTokens) requestBody.max_tokens = config.maxOutputTokens;

  let response: Response;
  let body: unknown;
  const controller = new AbortController();
  const effectiveTimeoutMs = Math.max(1, Math.min(timeoutMs ?? config.requestTimeoutMs, config.requestTimeoutMs));
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    body = await response.json();
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new TextLlmError('The text model exceeded Relay\'s request window.', 'provider', 504, false, 'request_timeout');
    }
    throw new TextLlmError('The text model could not be reached.', 'provider', 503, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status >= 500;
    throw new TextLlmError(
      'The text model rejected the request.',
      'provider',
      response.status,
      retryable,
      providerCode(body),
    );
  }
  const content = completionContent(body);
  if (!content) {
    throw new TextLlmError('The text model returned no final answer.', 'output', 502, true);
  }
  return parseTextLlmJson(content);
}
