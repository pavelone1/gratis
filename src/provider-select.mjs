// Which AI a particular bot uses.
//
// The app has one default provider (Settings), and any bot can be pinned to a different one, so a
// supervisor and each of its sub-agents can run on different AIs. Pure data and no secrets, so the
// main process, the chat service and the sandboxed renderer can all share it.
import { HOSTED_MODEL_PATTERN, isHostedProvider } from './hosted-providers.mjs';

// Providers a single bot can be pinned to. 'local' and 'demo' always follow the app-wide setting
// because they depend on the app-wide server address.
export const BOT_PROVIDERS = Object.freeze(['claude', 'codex', 'xai-api', 'openai-api', 'anthropic-api']);
export const isBotProvider = provider => typeof provider === 'string' && BOT_PROVIDERS.includes(provider);

// Each provider keeps its own per-bot model field (the original two predate this module).
export const botModelField = provider => provider === 'claude' ? 'model' : provider === 'codex' ? 'codexModel' : isHostedProvider(provider) ? 'hostedModel' : null;

/** The settings a run for `bot` should use: the bot's own provider/model when pinned, else the app default. */
export function effectiveSettings(settings, bot = {}) {
  const provider = isBotProvider(bot.provider) ? bot.provider : settings.provider;
  const field = botModelField(provider), own = (field && bot[field]) || '';
  if (provider === settings.provider) return own ? { ...settings, model: own } : { ...settings };
  // A different provider than the app default: borrow its remembered model/effort if Settings ever used it.
  const saved = settings.providerDefaults?.[provider] ?? {};
  return { ...settings, provider, model: own || saved.model || (provider === 'claude' ? 'sonnet' : ''), effort: saved.effort || 'medium' };
}

// The AI that writes memories after each turn. '' follows the app default.
export function validateMemoryChoice(provider = '', model = '') {
  if (typeof provider !== 'string' || typeof model !== 'string') throw new Error('Memory AI choices must be text.');
  provider = provider.trim(); model = model.trim();
  if (provider && !isBotProvider(provider)) throw new Error('Choose Claude, Codex or an API-key provider for memory updates, or follow the app default.');
  if (!provider) return { memoryProvider: '', memoryModel: '' };
  if (model.length > 200) throw new Error('Memory model name is too long.');
  if (!model && provider !== 'claude') throw new Error('Enter a model for memory updates. A small, cheap one is plenty.');
  if (model && provider === 'claude' && !['sonnet', 'haiku', 'opus'].includes(model)) throw new Error('Choose a Claude memory model: Sonnet, Haiku, or Opus.');
  if (model && provider === 'codex' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(model)) throw new Error('Choose a Codex memory model from your account.');
  if (model && isHostedProvider(provider) && !HOSTED_MODEL_PATTERN.test(model)) throw new Error('Enter a valid model ID for memory updates.');
  return { memoryProvider: provider, memoryModel: model };
}
