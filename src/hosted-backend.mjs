// Hosted "bring your own API key" providers: xAI (Grok), OpenAI, and Claude via an Anthropic API key.
//
// Trust boundary notes:
//  * Each provider talks to ONE fixed https host (below). Nothing user-supplied can redirect
//    a request, so the key can only ever be sent to the vendor it belongs to.
//  * Keys are read from the encrypted Connections store by the main process and handed to this
//    module as `secrets.hostedKey(provider)`. They are never part of settings or renderer state.
//  * These providers are plain chat (no Gratis tools or workspace), like the local-server provider.
import { withMemoryContext } from './memory-context.mjs';
import { streamChatCompletions } from './chat-completions-stream.mjs';
import { HOSTED, HOSTED_KEY_PATTERN, HOSTED_MODEL_PATTERN, isHostedProvider } from './hosted-providers.mjs';

export { HOSTED, HOSTED_MODEL_PATTERN, isHostedProvider };

// Ids returned by /v1/models that are not chat models.
const NON_CHAT = /(embed|whisper|tts|dall-?e|image|imagine|moderation|transcribe|realtime|audio|video|sora|rerank|ocr)/i;
// Effort levels the Anthropic API accepts in output_config.effort.
const CLAUDE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
// The 5.x Claude models take output_config.effort; older IDs a user may type would reject it.
const CLAUDE_5 = /^claude-(?:opus|sonnet|haiku|fable|mythos)-5/;

export const redact = (text, key) => {
  let out = String(text ?? '');
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out.replace(/\b(?:sk|xai|key)-[A-Za-z0-9_-]{8,}/g, '[redacted]');
};

async function httpMessage(label, response) {
  const status = response.status;
  if (status === 401 || status === 403) return `${label} rejected the API key. Check it in Settings.`;
  if (status === 429) return `${label} is rate limiting this key, or its quota is used up. Try again later.`;
  let detail = '';
  try { const payload = await response.json(); detail = typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.error === 'string' ? payload.error : ''; } catch { /* not JSON */ }
  // Some vendors (xAI) answer a wrong key with HTTP 400 and a message instead of 401.
  if (status === 400 && /(incorrect|invalid|missing|no) api[ -]?key|api[ -]?key (is )?(incorrect|invalid|missing)/i.test(detail)) return `${label} rejected the API key. Check it in Settings.`;
  if (status === 404) return `${label} does not know that model for this key.${detail ? ' ' + detail.slice(0, 200) : ''}`;
  return `${label} returned HTTP ${status}.${detail ? ' ' + detail.slice(0, 300) : ''}`;
}

function describeNetworkError(error, label) {
  const text = String(error?.message || error);
  if (error?.name === 'TimeoutError') return `${label} did not answer in time.`;
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(text) && !/HTTP \d{3}/.test(text)) return `Could not reach ${label}. Check your connection.`;
  return text;
}

function describeSdkError(error, label) {
  const status = error?.status;
  if (status === 401 || status === 403) return `${label} rejected the API key. Check it in Settings.`;
  if (status === 429) return `${label} is rate limiting this key. Try again later.`;
  if (status === 404) return `${label} does not know that model for this key.`;
  if (status >= 500) return `${label} had a server problem (${status}). Try again.`;
  if (status) return `${label} rejected the request (${status}): ${String(error.message || '').slice(0, 300)}`;
  if (/connection|fetch failed|ENOTFOUND|ECONN/i.test(String(error?.message))) return `Could not reach ${label}. Check your connection.`;
  return String(error?.message || error);
}

// baseURL is always passed explicitly: the SDK would otherwise honour an ANTHROPIC_BASE_URL
// environment variable, which could send the saved key to a different host.
async function defaultAnthropic({ apiKey, timeoutMs, baseURL }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 1 });
}

/** List chat model ids available to a stored key. Used both to fill the picker and to check the key works. */
export async function listHostedModels({ provider, apiKey, fetchImpl = globalThis.fetch, createAnthropic, signal }) {
  const spec = HOSTED[provider];
  if (!spec) throw new Error('Choose a hosted provider.');
  if (!apiKey) throw new Error(`Add your ${spec.label} API key first.`);
  if (!HOSTED_KEY_PATTERN.test(apiKey)) throw new Error('That does not look like an API key. Paste it again without spaces.');
  try {
    if (spec.protocol === 'anthropic') {
      const client = await (createAnthropic ?? defaultAnthropic)({ apiKey, timeoutMs: 15_000, baseURL: spec.baseUrl });
      const ids = [];
      for await (const model of client.models.list({ limit: 100 }, { signal })) { ids.push(model.id); if (ids.length >= 100) break; }
      return ids.filter(id => HOSTED_MODEL_PATTERN.test(id));
    }
    const response = await fetchImpl(`${spec.baseUrl}/models`, { redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(await httpMessage(spec.label, response));
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.filter(m => typeof m?.id === 'string' && HOSTED_MODEL_PATTERN.test(m.id) && !NON_CHAT.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 60).map(m => m.id);
  } catch (error) {
    throw new Error(redact(spec.protocol === 'anthropic' ? describeSdkError(error, spec.label) : describeNetworkError(error, spec.label), apiKey));
  }
}

async function* anthropicStream({ settings, bot, history, apiKey, signal, createAnthropic, timeoutMs, label, baseURL, onMetadata }) {
  const client = await (createAnthropic ?? defaultAnthropic)({ apiKey, timeoutMs, baseURL });
  const params = { model: settings.model, max_tokens: 16000, messages: history };
  if (bot.instructions?.trim()) params.system = bot.instructions;
  if (CLAUDE_5.test(settings.model) && CLAUDE_EFFORT.has(settings.effort)) params.output_config = { effort: settings.effort };
  const stream = client.messages.stream(params, { signal });
  let produced = false;
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) { produced = true; yield event.delta.text; }
  }
  const final = await stream.finalMessage();
  if (final?.usage) onMetadata({ usage: { model: settings.model, inputTokens: final.usage.input_tokens || 0, outputTokens: final.usage.output_tokens || 0, cacheReadInputTokens: final.usage.cache_read_input_tokens || 0 } });
  // A refusal is a normal HTTP 200 with stop_reason "refusal", so it has to be checked explicitly.
  if (final?.stop_reason === 'refusal' && !produced) throw new Error(`${label} declined this request.`);
  if (!produced) throw new Error(`${label} returned an empty response.`);
}

export function createHostedReply({ fetchImpl, createAnthropic } = {}) {
  return async function* hostedReply({ settings, bot, messages, signal, secrets, turnContext, onMetadata = () => {} }) {
    const spec = HOSTED[settings.provider];
    if (!spec) throw new Error('Choose a hosted provider.');
    signal.throwIfAborted();
    const apiKey = await secrets?.hostedKey?.(settings.provider);
    if (!apiKey) throw new Error(`Add your ${spec.label} API key in Settings.`);
    const history = messages.map(({ role, content }, i) => ({ role, content: i === messages.length - 1 ? withMemoryContext(content, turnContext) : content }));
    const timeoutMs = (settings.runLimits?.minutes ?? 10) * 60_000;
    try {
      if (spec.protocol === 'anthropic') {
        yield* anthropicStream({ settings, bot, history, apiKey, signal, createAnthropic, timeoutMs, label: spec.label, baseURL: spec.baseUrl, onMetadata });
        return;
      }
      const body = { model: settings.model, stream_options: { include_usage: true }, messages: [...(bot.instructions?.trim() ? [{ role: 'system', content: bot.instructions }] : []), ...history] };
      yield* streamChatCompletions({
        url: `${spec.baseUrl}/chat/completions`, headers: { Authorization: `Bearer ${apiKey}` }, body, signal, label: spec.label, timeoutMs, fetchImpl: fetchImpl ?? ((...args) => globalThis.fetch(...args)),
        describeHttpError: response => httpMessage(spec.label, response),
        onUsage: ({ inputTokens, outputTokens }) => onMetadata({ usage: { model: settings.model, inputTokens, outputTokens, cacheReadInputTokens: 0 } }),
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      const text = spec.protocol === 'anthropic' ? describeSdkError(error, spec.label) : describeNetworkError(error, spec.label);
      throw new Error(redact(text, apiKey).slice(0, 1500));
    }
  };
}

export const streamHostedReply = createHostedReply();
