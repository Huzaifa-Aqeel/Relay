import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseTextLlmJson,
  readTextLlmConfig,
  requestTextLlmJson,
  TextLlmError,
} from '../../../supabase/functions/_shared/text-llm';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider-neutral text LLM client', () => {
  it('reads a medium thinking budget without an application output cap', () => {
    const values: Record<string, string> = {
      LLM_API_URL: 'https://example.test/compatible-mode/v1/',
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'example-model',
      LLM_ENABLE_THINKING: 'true',
      LLM_THINKING_BUDGET: '16384',
    };
    expect(readTextLlmConfig((name) => values[name])).toEqual({
      apiUrl: 'https://example.test/compatible-mode/v1',
      apiKey: 'secret',
      model: 'example-model',
      enableThinking: true,
      reasoningEffort: null,
      thinkingBudget: 16_384,
      maxOutputTokens: null,
      requestTimeoutMs: 120_000,
    });
  });

  it('accepts the DashScope key aliases without coupling a workflow to them', () => {
    const values: Record<string, string> = {
      DASHSCOPE_BASE_URL: 'https://example.test/v1',
      DASHSCOPE_API_KEY: 'secret',
      DASHSCOPE_MODEL: 'example-model',
    };
    expect(readTextLlmConfig((name) => values[name])).toMatchObject({
      apiUrl: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'example-model',
      enableThinking: false,
      reasoningEffort: null,
      thinkingBudget: null,
    });
  });

  it('explicitly disables thinking instead of relying on the provider default', async () => {
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }));

    await requestTextLlmJson({
      config: {
        apiUrl: 'https://example.test/v1',
        apiKey: 'secret',
        model: 'example-model',
        enableThinking: false,
        reasoningEffort: null,
        thinkingBudget: null,
        maxOutputTokens: null,
        requestTimeoutMs: 120_000,
      },
      messages: [{ role: 'user', content: 'Return the result.' }],
      schema: { type: 'object' },
    });

    expect(requestBody).toMatchObject({ enable_thinking: false });
    expect(requestBody).not.toHaveProperty('thinking_budget');
    expect(requestBody).not.toHaveProperty('reasoning_effort');
  });

  it('sends a thinking budget while omitting reasoning effort, provider JSON mode, and output limits', async () => {
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }));

    await expect(requestTextLlmJson({
      config: {
        apiUrl: 'https://example.test/v1',
        apiKey: 'secret',
        model: 'example-model',
        enableThinking: true,
        reasoningEffort: null,
        thinkingBudget: 16_384,
        maxOutputTokens: null,
        requestTimeoutMs: 120_000,
      },
      messages: [
        { role: 'system', content: 'Use only supplied evidence.' },
        { role: 'user', content: 'Return the result.' },
      ],
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    })).resolves.toEqual({ ok: true });

    expect(requestBody).toMatchObject({
      model: 'example-model',
      stream: false,
      enable_thinking: true,
      thinking_budget: 16_384,
    });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
    expect(requestBody).not.toHaveProperty('response_format');
    expect(requestBody).not.toHaveProperty('max_tokens');
    expect(JSON.stringify(requestBody)).toContain('Return exactly one valid JSON object');
  });

  it('rejects configuring reasoning effort and thinking budget together', () => {
    const values: Record<string, string> = {
      LLM_API_URL: 'https://example.test/v1',
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'example-model',
      LLM_REASONING_EFFORT: 'medium',
      LLM_THINKING_BUDGET: '16384',
    };
    expect(() => readTextLlmConfig((name) => values[name]))
      .toThrow('use LLM_REASONING_EFFORT or LLM_THINKING_BUDGET, not both');
  });

  it('parses fenced JSON and harmless commentary around one JSON value', () => {
    expect(parseTextLlmJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseTextLlmJson('Here is the result: {"ok":true}\nDone.')).toEqual({ ok: true });
    expect(() => parseTextLlmJson('No structured result was returned.')).toThrow(TextLlmError);
  });
});
