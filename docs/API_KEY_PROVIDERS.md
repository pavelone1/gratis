# API-key providers

Besides the Claude and Codex account sign-ins, **Settings → AI subscription** offers three providers that use your own API key:

| Choice | Sends requests to | Models |
| --- | --- | --- |
| xAI Grok · API key | `https://api.x.ai/v1` | whatever your key can list |
| OpenAI · API key | `https://api.openai.com/v1` | whatever your key can list |
| Claude · API key | `https://api.anthropic.com` (official `@anthropic-ai/sdk`) | the key's model list, plus the Claude 5.5 family suggested by default |

## Set up

1. Open **Settings**, choose one of the API-key providers.
2. Paste the key and press **Check key and load models**. This only tests the key; nothing is stored yet. A working key fills the **Model** box with the models it can use, newest first.
3. Pick a model and **Save settings**. The key is stored when you save.

Billing, rate limits and available models come from your account with that provider. Gravis adds no subscription and no usage allowance.

## What is different from the account providers

These providers are plain chat, like the local-server option. They use the bot's instructions and the conversation (and relevant memories, if memory is enabled). They do **not** get Gravis tools such as files, the cloud computer, schedules or T3, and conversations are not resumed from a provider-side session. Use the Claude or Codex sign-in providers when a bot needs those tools.

Any bot can be pinned to one of these providers in its **Edit bot** dialog; see [A different AI for each bot](PER_BOT_AI.md). The quick model switcher in the chat header is only shown for bots on a Claude or Codex subscription. Claude's **Response effort** setting is passed through for the Claude 5.x models.

## Where the key lives

- The key is saved in the same encrypted connection store as other credentials (`connections.secure`, protected by the operating system's secure storage).
- It is read only by the main process. Settings, conversation state and the page never contain it; the page can only learn *whether* a key is saved.
- Each provider has one fixed HTTPS address (above). The address cannot be changed from the UI, so a saved key can only be sent to the vendor it belongs to. Redirects are refused.
- Error messages are scrubbed of the key before they are shown or logged.

## What leaves your computer

The provider receives the conversation, the bot instructions and any memory context included in the reply. See [Privacy](../PRIVACY.md). Provider retention and training policies are the provider's own; review them before sending sensitive material.

## Not included yet

- Streaming reasoning summaries and provider-specific options such as Claude server-side refusal fallback.
