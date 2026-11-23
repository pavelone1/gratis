// Streaming client for OpenAI-compatible /chat/completions endpoints.
// Shared by the local-server provider and the hosted API-key providers (xAI, OpenAI).
// Behaviour and error wording for the local provider are unchanged: only the label,
// the HTTP error text and the timeout are now parameters.

function readDelta(payload, label) {
  if (payload.error) throw new Error(typeof payload.error.message === 'string' ? payload.error.message : `${label} returned an error.`);
  // A final usage-only chunk may omit `choices`; that is not an invalid response.
  if (!Array.isArray(payload.choices)) { if (payload.usage) return ''; throw new Error(`${label} returned an invalid chat response.`); }
  const choice = payload.choices[0];
  if (!choice) return '';
  const content = choice.delta?.content ?? choice.message?.content;
  if (content !== undefined && content !== null && typeof content !== 'string') throw new Error(`${label} returned non-text content.`);
  return content ?? '';
}

const defaultHttpError = async (response, label) => `${label} returned HTTP ${response.status}. Check its model name and server status.`;

/**
 * POST `body` to `url` and yield the reply text as it streams.
 *
 * @param {object} o
 * @param {string} o.url              full /chat/completions URL
 * @param {object} [o.headers]        extra headers (e.g. Authorization)
 * @param {object} o.body             JSON request body (stream:true is added)
 * @param {AbortSignal} o.signal      caller cancellation
 * @param {string} [o.label]          wording used in error messages
 * @param {number} [o.timeoutMs]      overall request timeout
 * @param {(response: Response, label: string) => Promise<string>} [o.describeHttpError]
 * @param {(usage: {inputTokens: number, outputTokens: number}) => void} [o.onUsage]
 * @param {typeof fetch} [o.fetchImpl]
 */
export async function* streamChatCompletions({ url, headers = {}, body, signal, label = 'Local backend', timeoutMs = 30_000, describeHttpError = defaultHttpError, onUsage, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', ...headers },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!response.ok) throw new Error(await describeHttpError(response, label));
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const content = readDelta(payload, label);
      if (payload.usage) onUsage?.({ inputTokens: payload.usage.prompt_tokens || 0, outputTokens: payload.usage.completion_tokens || 0 });
      if (!content) throw new Error(`${label} returned an empty response.`);
      yield content; return;
    }
    if (!contentType.includes('text/event-stream') || !response.body) throw new Error(`${label} must return a chat JSON response or an SSE stream.`);
    let buffer = '', gotText = false, finished = false;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        // SSE lines are accumulated before parsing, including frames split across transport chunks.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data.trim() === '[DONE]') { finished = true; break; }
          let payload;
          try { payload = JSON.parse(data); } catch { throw new Error(`${label} returned malformed streaming JSON.`); }
          const text = readDelta(payload, label);
          if (payload.usage) onUsage?.({ inputTokens: payload.usage.prompt_tokens || 0, outputTokens: payload.usage.completion_tokens || 0 });
          if (text) { gotText = true; yield text; }
        }
        if (done) {
          if (buffer.trim() && !finished) throw new Error(`${label} ended with an incomplete streaming frame.`);
          break;
        }
      }
      if (!gotText) throw new Error(`${label} returned an empty response.`);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch (error) {
    if (timedOut) throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    if (signal.aborted) throw signal.reason ?? new DOMException('Stopped', 'AbortError');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
