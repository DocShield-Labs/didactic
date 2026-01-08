import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { endpoint, fn, mock } from '../executors.js';

describe('endpoint', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('makes a POST request with input as body', async () => {
    const mockResponse = { result: 'success' };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const executor = endpoint('https://api.example.com/workflow');
    const result = await executor({ id: '123' }, 'Do the thing');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/workflow',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ id: '123', systemPrompt: 'Do the thing' }),
      })
    );

    expect(result.output).toEqual({ result: 'success' });
  });

  it('uses custom headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const executor = endpoint('https://api.example.com/workflow', {
      headers: { Authorization: 'Bearer token123' },
    });

    await executor({}, 'prompt');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token123',
        }),
      })
    );
  });

  it('uses mapResponse to transform the response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { value: 42 }, meta: { cost: 0.05 } }),
    });

    const executor = endpoint('https://api.example.com/workflow', {
      mapResponse: (response: any) => response.data,
    });

    const result = await executor({}, 'prompt');

    expect(result.output).toEqual({ value: 42 });
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const executor = endpoint('https://api.example.com/workflow');

    await expect(executor({}, 'prompt')).rejects.toThrow(
      'HTTP 500: Internal Server Error'
    );
  });

  it('respects abort signal on timeout', async () => {
    // Verify the abort signal is passed to fetch
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedSignal = options?.signal;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const executor = endpoint('https://api.example.com/workflow', {
      timeout: 5000,
    });
    await executor({}, 'prompt');

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const executor = endpoint('https://api.example.com/workflow');

    await expect(executor({}, 'prompt')).rejects.toThrow('Network error');
  });

  it('supports GET method', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'value' }),
    });

    const executor = endpoint('https://api.example.com/workflow', {
      method: 'GET',
    });

    await executor({ id: '123' }, 'prompt');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/workflow',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('defaults to POST method when not specified', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const executor = endpoint('https://api.example.com/workflow');
    await executor({}, 'prompt');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('handles various HTTP status codes', async () => {
    // 400 Bad Request
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    const executor = endpoint('https://api.example.com/workflow');
    await expect(executor({}, 'prompt')).rejects.toThrow(
      'HTTP 400: Bad Request'
    );

    // 401 Unauthorized
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(executor({}, 'prompt')).rejects.toThrow(
      'HTTP 401: Unauthorized'
    );

    // 404 Not Found
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(executor({}, 'prompt')).rejects.toThrow('HTTP 404: Not Found');
  });

  it('sets abort signal for timeout', async () => {
    // Verify the abort signal is configured with timeout
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedSignal = options?.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const executor = endpoint('https://api.example.com/workflow', {
      timeout: 5000,
    });
    await executor({}, 'prompt');

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('clears timeout on successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const executor = endpoint('https://api.example.com/workflow', {
      timeout: 5000,
    });
    await executor({}, 'prompt');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('fn', () => {
  it('wraps a function and returns ExecutorResult', async () => {
    const executor = fn({
      fn: async (input: { value: number }, systemPrompt?: string) => ({
        result: input.value * 2,
        prompt: systemPrompt,
      }),
    });

    const result = await executor({ value: 21 }, 'double it');

    expect(result.output).toEqual({ result: 42, prompt: 'double it' });
  });

  it('propagates errors from wrapped function', async () => {
    const executor = fn({
      fn: async () => {
        throw new Error('workflow failed');
      },
    });

    await expect(executor({}, 'prompt')).rejects.toThrow('workflow failed');
  });
});

describe('mock', () => {
  it('returns outputs in sequence', async () => {
    const executor = mock([
      { result: 'first' },
      { result: 'second' },
      { result: 'third' },
    ]);

    expect((await executor({}, '')).output).toEqual({ result: 'first' });
    expect((await executor({}, '')).output).toEqual({ result: 'second' });
    expect((await executor({}, '')).output).toEqual({ result: 'third' });
  });

  it('cycles when more calls than outputs', async () => {
    const executor = mock([{ value: 1 }, { value: 2 }]);

    expect((await executor({}, '')).output).toEqual({ value: 1 });
    expect((await executor({}, '')).output).toEqual({ value: 2 });
    expect((await executor({}, '')).output).toEqual({ value: 1 });
    expect((await executor({}, '')).output).toEqual({ value: 2 });
  });

  it('throws when outputs array is empty', () => {
    expect(() => mock([])).toThrow('mock() requires at least one output');
  });

  it('supports function-based mock for input-dependent outputs', async () => {
    const executor = mock((input: { id: number }) => ({
      processedId: input.id * 2,
      status: 'processed',
    }));

    const result1 = await executor({ id: 10 }, '');
    const result2 = await executor({ id: 25 }, '');

    expect(result1.output).toEqual({ processedId: 20, status: 'processed' });
    expect(result2.output).toEqual({ processedId: 50, status: 'processed' });
  });

  it('function-based mock receives systemPrompt', async () => {
    const executor = mock((input: { id: number }, systemPrompt?: string) => ({
      id: input.id,
      prompt: systemPrompt,
    }));

    const result = await executor({ id: 1 }, 'test prompt');

    expect(result.output).toEqual({ id: 1, prompt: 'test prompt' });
  });
});
