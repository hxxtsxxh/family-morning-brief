# ☀️ Morning Chai — Family Morning Brief

Every morning at about **7:30 AM Pacific**, a short, calm, well-sourced news briefing is posted to **one** family WhatsApp group. It has 6–8 stories, takes 2–3 minutes to read, and never needs a hand on the keyboard.

Everything runs on **free** services: GitHub Actions (private repo), public RSS feeds, Google's free Gemini API tier, and OpenClaw's WhatsApp channel. There is no server to maintain and no credit card anywhere.

What the family sees in WhatsApp:

```
☀️ *Morning Chai*
_Wednesday, September 30_

🌎 *Top Stories*
• *UN approves ceasefire monitoring mission*
The Security Council voted to send monitors after a week of talks. _Reuters, BBC_

🇮🇳 *India*
• *RBI holds repo rate, raises growth forecast*
The central bank kept rates at 5.5% and now expects 7% growth. _The Hindu_

🔗 *Read more*
• Reuters: https://…
• The Hindu: https://…

Have a great day ❤️
```

Each story is one bold headline and **one short sentence**, with a blank line between stories, so it reads in about two minutes.

---

## What this does

1. Pulls the last ~24 h of headlines from ~30 reputable free feeds (BBC, NPR, The Hindu, Indian Express, Ars Technica, ESPNcricinfo, NASA, and more). It also uses Google News searches restricted to Reuters/AP and other trusted outlets.
2. Cleans the headlines and drops stale items, opinion pieces, quizzes and untrusted publishers.
3. **Deduplicates**, so one event reported by many publishers becomes one cluster, and ranks clusters by coverage, source quality, freshness and family interests.
4. Asks a free editor model (Gemini) to pick the 6–8 stories that matter and write a neutral one-sentence gist for each. It follows strict editorial rules (`prompts/editor.md`). The model can only cite candidate IDs, so **all links and source names come from the real feeds and are never written by the model**.
5. **Validates and fact-checks** the result before sending. Validation covers story count, section limits, length, a source and valid https link on every story, no duplicates, no hype words, and not blank. A second model call checks every gist against its source excerpts. If validation fails, the model gets one correction retry. If it fails again, **nothing is sent** and the failure is logged.
6. Sends one WhatsApp message to the configured group through OpenClaw.

## Architecture

```
GitHub Actions cron (07:15 PT, DST-safe)                ← "automation"
   │  gate: in morning window? already sent today?
   ▼
scripts/morning-brief.mjs
   ├─ src/feeds.mjs      fetch RSS/Atom (one failing feed never breaks the run)
   ├─ src/normalize.mjs  clean, canonical URLs, freshness window, trusted publishers
   ├─ src/dedupe.mjs     headline-similarity clustering (union-find)
   ├─ src/rank.mjs       pre-rank + per-section quotas, skip already-sent links
   ├─ src/llm.mjs        OpenAI-compatible client (Gemini free → Groq free fallback)
   ├─ src/compose.mjs    prompt + JSON parsing; attaches real sources/links
   ├─ src/validate.mjs   the guardrail (retry once, else don't send)
   ├─ src/factcheck.mjs  second model call: every gist checked against its sources
   ├─ src/format.mjs     message layout (Markdown → OpenClaw converts to WhatsApp)
   └─ src/deliver.mjs    `openclaw message send --channel whatsapp --target <group JID>`
                               ▲
          OpenClaw gateway (started for the job; WhatsApp session restored
          from the encrypted `state` branch; every inbound path disabled)
```

**Why GitHub Actions and not OpenClaw's own cron/Automations?** OpenClaw's automations need a gateway running 24/7, and every free always-on host requires a credit card. The job runs on a free GitHub runner instead. OpenClaw is started only for the minute it needs to deliver the message, using its official WhatsApp channel. If you ever move to an always-on machine, the same `scripts/morning-brief.mjs --send` can be run from an OpenClaw cron job.

**State between runs** is the WhatsApp linked-device session plus `state/history.json` (what was sent, used to avoid duplicates and repeats). It is encrypted with AES-256 using the `STATE_PASSPHRASE` secret and stored as a single force-pushed commit on the `state` branch. Plaintext never touches git.

## Requirements

- A GitHub account (free). This repo is **private**, which matters because the WhatsApp session lives here, encrypted.
- A free Gemini API key from Google AI Studio. No card is needed.
- WhatsApp on your phone, to link OpenClaw as a "linked device".
- For local testing only: Node.js 24+.

## Install

```bash
git clone https://github.com/hxxtsxxh/family-morning-brief.git
cd family-morning-brief
npm ci
npm test
```

Production secrets and variables live in **GitHub → Settings → Secrets and variables → Actions**:

| Name | Kind | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | secret | Free key from https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | secret (optional) | Free fallback from https://console.groq.com/keys |
| `STATE_PASSPHRASE` | secret | Encrypts the saved session (already generated; leave it alone) |
| `FAMILY_WHATSAPP_GROUP_ID` | variable | The family group's JID (`…@g.us`) |
| `MORNING_BRIEF_ENABLED` | variable | `true` lets the 7:30 schedule send. Starts `false` |
| `MORNING_BRIEF_DRY_RUN` | variable | `true` = never send anything (panic switch) |

From a terminal: `gh secret set GEMINI_API_KEY -R hxxtsxxh/family-morning-brief` (it prompts for the value).

## Connect WhatsApp

1. GitHub → **Actions** → **WhatsApp setup** → **Run workflow** → action `login`.
2. Open the running job and expand the step **"📱 Scan this QR…"**.
3. On your phone go to **WhatsApp → Settings → Linked devices → Link a device** and scan the QR in the log. It refreshes every ~20 s and the step waits up to 4 minutes.

The job then saves the encrypted session and lists your groups.

**Recommended: a dedicated bot account** (this is how it's set up now). The briefing comes from its own "Morning Chai ☀️" contact in the group, so you receive it like everyone else:

1. Get a free second number at voice.google.com.
2. Register it in the free **WhatsApp Business** app, which runs alongside normal WhatsApp on the same phone. Set its name and photo.
3. Add that number to the family group.
4. Run **WhatsApp setup → `logout`**, then **`login`**, and scan the QR from **WhatsApp Business → Settings → Linked devices**.

The group's JID is the same from every member's side, so `FAMILY_WHATSAPP_GROUP_ID` doesn't change.

## Find/configure the family group

The `login` run (or **WhatsApp setup → `list-groups`**) prints a table of every group with its JID, both in the log and in the run summary. The table comes from `openclaw directory groups list --channel whatsapp --json`. Copy your family group's JID:

```bash
gh variable set FAMILY_WHATSAPP_GROUP_ID --body "120363XXXXXXXXXXXX@g.us" -R hxxtsxxh/family-morning-brief
```

The brief is only ever sent to this JID. Anything that isn't a group JID is refused.

## Configure interests

Edit **`config/brief.config.yaml`**, the single place for:

- `interests` / `audience`: what the editor model optimizes for
- `boost_keywords` / `exclude_patterns`: pre-ranking nudges and hard filters
- `categories`: sections, emoji, order and max stories per section
- `length`: story count, word and character limits
- `links`: `bottom` ("Read more" list) or `inline`
- `sources` / `trusted_publishers`: feeds and allowed Google News publishers

Run `npm test` after editing (it validates the config), then commit and push. The editorial rules live in `prompts/editor.md`, and the layout in `src/format.mjs`. It's written as Markdown because OpenClaw converts Markdown to WhatsApp formatting: `**bold**` becomes bold, `_italic_` stays italic. A WhatsApp-style `*x*` would arrive as italics.

## Run a dry test

A dry run generates the exact briefing and shows it without sending:

- **On GitHub:** Actions → **Family Morning Brief** → Run workflow → mode `dry-run`. The brief appears in the run summary and as an artifact.
  ```bash
  gh workflow run morning-brief.yml -f mode=dry-run -R hxxtsxxh/family-morning-brief
  ```
- **Locally:** put `GEMINI_API_KEY` in `.env` (see `.env.example`), then
  ```bash
  npm run brief:dry-run      # full pipeline, prints + saves out/brief-YYYY-MM-DD.txt
  npm run brief:preview      # no model at all: tests feeds/dedup/formatting offline
  ```

## Send a one-time real test

```bash
gh workflow run morning-brief.yml -f mode=send -R hxxtsxxh/family-morning-brief
```

This sends **one** brief to `FAMILY_WHATSAPP_GROUP_ID` and records it. Running it again the same day is refused unless you also pass `-f force=true`. It never creates or changes a schedule.

## Enable morning automation

```bash
gh variable set MORNING_BRIEF_ENABLED --body true -R hxxtsxxh/family-morning-brief
```

The workflow has four UTC cron lines (`15 14`, `15 15`, `15 16`, `15 17`). GitHub cron doesn't know about time zones, so together they give **three attempts every morning, around 07:15, 08:15 and 09:15 PT, in both summer and winter**. Each run checks: enabled? inside the morning window (06:45–10:00 PT)? not already sent today? Exactly one run sends per day; the rest exit in seconds. If an attempt fails *before* sending (a free AI model is busy, a validation failure), the next one retries. If a send itself errored, it does **not** retry, to avoid double posts. If every AI model is busy, a run also waits 5 minutes and tries once more on its own.

## Change delivery time

1. Change `send_time` in `config/brief.config.yaml`.
2. `npm run schedule:cron` prints the two new cron lines. Paste them into `.github/workflows/morning-brief.yml`.
3. `npm test` (fails if the cron and config disagree), then commit and push.

Note: GitHub may start scheduled jobs 5–30 minutes late at busy times. That is why the cron fires 15 minutes early and the send window is generous.

## Disable automation

```bash
gh variable set MORNING_BRIEF_ENABLED --body false -R hxxtsxxh/family-morning-brief   # pause
gh variable set MORNING_BRIEF_DRY_RUN --body true  -R hxxtsxxh/family-morning-brief   # block ALL sends, even manual
gh workflow disable morning-brief.yml -R hxxtsxxh/family-morning-brief               # stop the workflow entirely
```

Re-enable with the opposite values, or `gh workflow enable morning-brief.yml`.

## Run manually

- Phone or browser: GitHub → Actions → **Family Morning Brief** → Run workflow (`dry-run` or `send`).
- Terminal: `gh workflow run morning-brief.yml -f mode=send -R hxxtsxxh/family-morning-brief`

## Troubleshooting

```bash
gh run list -R hxxtsxxh/family-morning-brief --limit 10                 # history of runs
gh run view <run-id> --log -R hxxtsxxh/family-morning-brief             # full log of one run
gh run view <run-id> --log -R hxxtsxxh/family-morning-brief | grep -E "INFO|WARN|ERROR"
gh workflow run whatsapp-setup.yml -f action=status -R hxxtsxxh/family-morning-brief
```

Each run logs: when it ran, the schedule decision, feeds reached, raw → fresh → clustered → candidate counts, which model was used, validation result and WhatsApp delivery status.

| Symptom | Fix |
|---|---|
| `schedule gate: SKIP — schedule is not enabled` | Set `MORNING_BRIEF_ENABLED=true` |
| `WhatsApp is not linked` / `did not connect` | Run **WhatsApp setup → login** again (sessions expire if the phone is offline ~14 days or the device was removed) |
| `GEMINI_API_KEY not set` / `HTTP 429` | Add or replace the key. 429 = free quota hit; add the optional `GROQ_API_KEY` fallback |
| `failed validation twice` | The model produced something unsafe to send, so nothing was sent. It usually resolves the next day; check the log for the reasons |
| `FAMILY_WHATSAPP_GROUP_ID … refusing to send` | Set the variable to the `…@g.us` JID from `list-groups` |
| Want to unlink | **WhatsApp setup → logout**, or remove "OpenClaw" under Linked devices on your phone |

## Limitations

- **Headline-only stories:** Google News items carry only a headline, so their one-line gists stay close to the headline. Reuters and AP block automated page fetches, so their article text can't be read. Links are resolved to the real publisher URL; if resolution fails, the working Google redirect link is kept.
- **Cross-checking** is based on how many independent reputable outlets carried the same event (shown as multiple sources), not on reading full articles.
- **Free tiers can change.** Gemini quotas are generous for one call a day, and the Groq fallback exists for that reason.
- **Unofficial WhatsApp client:** OpenClaw links as a WhatsApp Web device. That is widely used but not officially sanctioned by WhatsApp; posting once a day is very low risk.
- **Follow-up chat commands** ("more india", "explain 3") aren't supported, because nothing listens between runs. That is deliberate: the bot only broadcasts and never reads family messages.
- **Hindu festivals** appear only when they're in the news. There is no hard-coded calendar, so there are no invented dates.
