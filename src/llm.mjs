// Minimal client for OpenAI-compatible chat APIs (Gemini's and Groq's free tiers both
// speak this). Providers/models are tried in config order; a provider without an API
// key is skipped. Transient errors (429/5xx/timeouts, e.g. Gemini's "high demand" 503)
// are retried on the SAME model with backoff before falling back to a weaker one.
// No SDK dependency.

export class LlmUnavailableError extends Error {}

const TRANSIENT = /HTTP (429|5\d\d)|timeout|aborted|ECONNRESET|ETIMEDOUT|fetch failed/i;

export async function chatComplete(messages, config, { env = process.env, fetchImpl = fetch, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const delays = (config.llm.retry_delays_seconds ?? [10, 30]).map((s) => s * 1000);
  const attempts = [];
  for (const p of config.llm.providers) {
    const key = env[p.api_key_env];
    if (!key) {
      attempts.push(`${p.name}: ${p.api_key_env} not set`);
      continue;
    }
    for (const model of p.models) {
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const t0 = Date.now();
          const content = await callOnce({ baseUrl: p.base_url, key, model, messages, config, fetchImpl });
          log(`llm ok provider=${p.name} model=${model} ms=${Date.now() - t0} chars=${content.length}`);
          return { content, provider: p.name, model };
        } catch (err) {
          const msg = redact(String(err?.message ?? err), key);
          const transient = TRANSIENT.test(msg);
          const willRetry = transient && attempt < delays.length;
          log(`llm failed provider=${p.name} model=${model}: ${shortError(msg)}${willRetry ? ` — retrying in ${delays[attempt] / 1000}s` : ""}`);
          if (!willRetry) {
            attempts.push(`${p.name}/${model}: ${shortError(msg)}`);
            break;
          }
          await sleep(delays[attempt]);
        }
      }
    }
  }
  throw new LlmUnavailableError(`No editor model succeeded:\n  - ${attempts.join("\n  - ")}`);
}

async function callOnce({ baseUrl, key, model, messages, config, fetchImpl }) {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: config.llm.temperature,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.llm.timeout_seconds * 1000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`non-JSON response: ${body.slice(0, 200)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("empty completion");
  return content;
}

/** "HTTP 503: {...message: 'high demand'...}" → "HTTP 503: This model is currently experiencing high demand…" */
function shortError(msg) {
  const status = msg.match(/^HTTP \d+/)?.[0];
  const inner = msg.match(/"message"\s*:\s*"([^"]{1,160})/)?.[1];
  return status && inner ? `${status}: ${inner}` : msg.split("\n")[0].slice(0, 200);
}

function redact(s, key) {
  return key ? s.split(key).join("***") : s;
}
