import {validateRunLimits} from './run-limits.mjs';
import {withMemoryContext} from './memory-context.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { streamClaudeReply } from './claude-backend.mjs';
import { streamCodexReply } from './codex-backend.mjs';
import { streamChatCompletions } from './chat-completions-stream.mjs';
import { HOSTED, HOSTED_MODEL_PATTERN, isHostedProvider } from './hosted-providers.mjs';
import { streamHostedReply } from './hosted-backend.mjs';
import { validateMemoryChoice } from './provider-select.mjs';
import { streamGrokReply } from './grok-backend.mjs';
import { GROK_MODEL_PATTERN } from './grok-client.mjs';

export function validateSettings(value) {
  if (!value || !(['demo', 'local', 'claude', 'codex', 'grok'].includes(value.provider) || isHostedProvider(value.provider))) throw new Error('Choose Claude, Codex, Grok, an API-key provider, local AI, or the demo provider.');
  if (value.profileAvatarDataUrl !== undefined && value.profileAvatarDataUrl !== null && (typeof value.profileAvatarDataUrl !== 'string' || value.profileAvatarDataUrl.length > 2_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.profileAvatarDataUrl))) throw new Error('Profile photo must be a PNG image.');
  if (value.displayName !== undefined && (typeof value.displayName !== 'string' || value.displayName.length > 80)) throw new Error('Your name must be text under 80 characters.');
  if (typeof value.baseUrl !== 'string' || typeof value.model !== 'string') throw new Error('Backend URL and model must be text.');
  let url;
  try { url = new URL(value.baseUrl); } catch { throw new Error('Enter a valid local backend URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('The AI backend must be an HTTP loopback address, without credentials, query, or fragment.');
  if (value.model.length > 200) throw new Error('Model name is too long.');
  if (value.provider === 'local' && !value.model.trim()) throw new Error('Enter a model already installed in your local AI server.');
  if (value.provider === 'claude' && !['sonnet', 'haiku', 'opus'].includes(value.model)) throw new Error('Choose a Claude model: Sonnet, Haiku, or Opus.');
  if(value.provider==='codex'&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value.model))throw new Error('Choose a Codex model from your account.');
  if (isHostedProvider(value.provider) && !HOSTED_MODEL_PATTERN.test(value.model.trim())) throw new Error(`Enter a model ID for ${HOSTED[value.provider].label}. Use Check key to load the list.`);
  if (value.provider === 'grok' && value.model.trim() && !GROK_MODEL_PATTERN.test(value.model.trim())) throw new Error('Choose a Grok model from the list, or leave it empty for the default.');
  if (value.effort !== undefined && !['minimal','low', 'medium', 'high','xhigh','max','ultra','persistent'].includes(value.effort)) throw new Error('Choose low, medium, or high response effort.');
  if (value.voiceCleanup !== undefined && typeof value.voiceCleanup !== 'boolean') throw new Error('Choose whether to use Haiku transcript cleanup.');
  if (value.voiceLanguage !== undefined && !['en', 'auto'].includes(value.voiceLanguage)) throw new Error('Choose English or automatic language detection.');
  const memory = validateMemoryChoice(value.memoryProvider, value.memoryModel);
  return { ...memory, runLimits:validateRunLimits(value.runLimits), profileAvatarDataUrl: value.profileAvatarDataUrl ?? null, displayName: value.displayName?.trim() || '', provider: value.provider, baseUrl: url.href.replace(/\/+$/, ''), model: value.model.trim(), effort: value.effort || 'medium', voiceCleanup: value.voiceCleanup !== false, voiceLanguage: value.voiceLanguage || 'en' };
}

async function* demoReply({ bot, messages, signal }) {
  const latest = messages.filter(m => m.role === 'user'&&!m.internalContinuation).at(-1)?.content ?? '';
  const previous = messages.filter(m => m.role === 'user').length - 1;
  const response = `Local demo response from ${bot.name}.\n\nYou wrote: “${latest}”\n\n${previous ? `This conversation includes ${previous} earlier user ${previous === 1 ? 'message' : 'messages'}. ` : ''}Your bot instructions are saved and will be included with the full conversation when you connect a local AI model.\n\nThis is a scripted response for testing the desktop workflow, not model inference.`;
  for (const part of response.match(/\S+\s*/g) ?? []) { await delay(10, undefined, { signal }); yield part; }
}

export async function* streamReply({ settings, bot, messages, signal, ...context }) {
  settings = validateSettings(settings);
  if (settings.provider === 'demo') { yield* demoReply({ bot, messages, signal }); return; }
  if (settings.provider === 'claude') { yield* streamClaudeReply({ settings, bot, messages, signal, ...context }); return; }
  if (settings.provider === 'codex') { yield* streamCodexReply({settings,bot,messages,signal,...context}); return; }
  if (settings.provider === 'grok') { yield* streamGrokReply({ settings, bot, messages, signal, ...context }); return; }
  if (isHostedProvider(settings.provider)) { yield* streamHostedReply({ settings, bot, messages, signal, ...context }); return; }
  yield* streamChatCompletions({
    url: `${settings.baseUrl}/chat/completions`, signal, label: 'Local backend', timeoutMs: 30_000,
    body: { model: settings.model, messages: [{ role: 'system', content: bot.instructions }, ...messages.map(({ role, content }, i) => ({ role, content: i === messages.length - 1 ? withMemoryContext(content, context.turnContext) : content }))] },
  });
}
