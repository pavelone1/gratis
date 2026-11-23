// Pure data about the API-key providers. Imported by both the main-process backend and the
// sandboxed renderer, so it must stay free of Node APIs, secrets and side effects.
//
// Each provider talks to ONE fixed https host, so a saved key can only ever be sent to the
// vendor it belongs to. Claude model IDs are exact strings (no date suffixes).
// Null prototype: a lookup such as HOSTED['__proto__'] or HOSTED['constructor'] must be undefined.
export const HOSTED = Object.freeze(Object.assign(Object.create(null), {
  'xai-api': Object.freeze({ id: 'xai-api', label: 'xAI', title: 'xAI Grok', protocol: 'chat-completions', baseUrl: 'https://api.x.ai/v1', keyName: 'xaiKey', logo: 'xai', suggestions: [] }),
  'openai-api': Object.freeze({ id: 'openai-api', label: 'OpenAI', title: 'OpenAI', protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1', keyName: 'openaiKey', logo: 'openai', suggestions: [] }),
  'anthropic-api': Object.freeze({ id: 'anthropic-api', label: 'Claude API', title: 'Claude API', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', keyName: 'anthropicKey', logo: 'claude', suggestions: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] }),
}));

export const isHostedProvider = provider => typeof provider === 'string' && Object.hasOwn(HOSTED, provider);
// Printable ASCII with no spaces: what an API key looks like, and safe to put in an HTTP header.
export const HOSTED_KEY_PATTERN = /^[!-~]{1,512}$/;
export const HOSTED_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
