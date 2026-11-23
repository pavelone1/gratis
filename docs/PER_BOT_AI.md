# A different AI for each bot

Every bot can run on its own AI. That lets a **supervisor** (the primary bot of a group) and each **sub-agent** use whichever model suits the job, and spreads usage across the accounts you already have.

## Set it up

1. Open a bot's **Edit bot** dialog and choose **AI for this bot**:
   - **Use app default** follows Settings (the default for every bot).
   - **Claude subscription**, **Codex · ChatGPT subscription** and **Grok subscription (Grok Build)** use your signed-in plan, with no API billing.
   - **xAI Grok / OpenAI / Claude · API key** use a key you saved in Settings (see [API-key providers](API_KEY_PROVIDERS.md)).
2. Pick that AI's model for the bot. For a subscription provider the list comes from your sign-in; for an API-key provider type a model ID.
3. Repeat for each bot, then create a group with them. The primary bot is the supervisor; teammates are the sub-agents. Mention one with `@name`, or `@everyone` for all.

Each reply records which AI wrote it, and the bot's tile shows whether *its* AI is ready.

## What each kind of AI can do

| | Claude / Codex subscription | Grok subscription | API-key providers (xAI, OpenAI, Claude API) |
| --- | --- | --- | --- |
| Billing | your plan's usage limits | your Grok plan's usage limits | pay-as-you-go with that vendor, set up by you |
| Delegate to teammates (`ask_agent`) | yes | no, but they can be asked and can answer | no, but they can be asked and can answer |
| Own computer, files, schedules, memory tools | yes | no (plain chat) | no (plain chat) |

A supervisor that needs to delegate or use a computer should therefore be on a **subscription** provider. An API-key bot works well as a specialist that answers when asked.

## Each assistant has its own computer

Every bot gets its own isolated cloud computer (it is keyed to the bot), separate from its teammates'. This needs the optional cloud service from [Cloud deployment](CLOUD.md), deployed in your own account; hosting charges apply. Computers are only available to bots running on a Claude or Codex subscription.

## About Grok

There are two ways to use Grok:

- **Grok subscription (Grok Build)** uses your Grok plan. Gravis runs xAI's own `grok` program, which keeps its own sign-in, so Gravis never sees your Grok login and no API key is involved. Install it from [x.ai/build](https://x.ai/build), run `grok login` once in a terminal, then choose **Grok subscription** in Settings or **Edit bot** and use **Check Grok connection** to load your models. Each reply is one headless run of `grok` in an empty temporary folder with tools, memory, sub-agents and web search switched off, so a Grok bot is plain chat. If it asks for a tool, Gravis stops it and says so.
- **xAI Grok · API key** uses an xAI API key, billed separately from a Grok subscription (see [API-key providers](API_KEY_PROVIDERS.md)).

The `grok` program adds a large built-in prompt, so each reply uses roughly 13,000 input tokens even for a short question. That is counted against your Grok plan, so it is better suited to a few strong answers than to many small background calls. The memory AI setting works with Grok but is a poor fit for that reason.

## Keeping usage down

- Give sub-agents a smaller model (for example Claude Haiku) and keep the strongest model for the supervisor.
- Put different bots on different subscriptions so no single plan carries all the load.
- After each reply the app makes one extra, small call to update memory. By default that uses the **app default** AI (Claude uses Haiku; other providers use their selected model). In **Settings → AI that updates memory** you can pick a different, cheaper AI for it, such as Claude Haiku or a small OpenAI or xAI model, so memory does not draw on the AI you use for real work. Codex and API-key choices need a model ID; Claude defaults to Haiku. The memory AI sends only that turn's message, the reply and a few known facts, and an API-key choice needs its key saved in Settings first.
- **Settings → Run limits** caps the minutes and tool calls of a single response.

## Limits of this first version

- Only the supervisor-to-teammate flow that already existed is covered; there is no separate "cheap router" model (the memory AI above is separate).
- `local` and `demo` follow the app-wide setting and cannot be pinned to one bot.
- Delegating to an API-key teammate through `ask_agent` follows the same path as a direct mention but has not been exercised against a live provider.
