# Superdemo demo guide

A presenter-facing walkthrough for each demo in the superdemo UI. Open the
app at http://localhost:5173, then follow the path for the demo you want to
show. Each section assumes `deploy-superdemo.sh` has already run and the
sidebar status dot is green.

The four active demos are listed in the order they appear in the sidebar.
Placeholders (Semantic Cache, Model Routing, Circuit Breaking, Logging,
Per-User Token Limits, Function Calling) are stubs — they render a "coming
soon" card and have no demo path yet.

---

## 1. Basic Quota

**What it shows:** Apigee Quota policies enforced per API product. Trial
clients get 10 requests/minute; Premium clients get 1000 requests/hour.
Same proxy, two API keys.

**Backend route:** `POST /api/proxy/basic-quota/` — the FastAPI backend
injects `?apikey=` and reads the tier from the `x-quota-tier` request
header (`trial` or `premium`).

**Demo path:**

1. Select **Basic Quota** in the sidebar.
2. Leave the tier on **Trial**. Click **Send Request**. The response card
   shows the proxy's JSON; the **Counter** and **Limit** tiles update from
   the `X-RateLimit-*` headers Apigee returns.
3. Click **Send Request** rapidly until the counter exceeds 10 — the
   progress bar turns red and the response card shows a 429.
4. Switch to **Premium** and click **Send Request** again. Counter resets,
   limit jumps to 1000 — same proxy, different API product, no client
   change.

**Talking points:** the browser only sees `/api/proxy/basic-quota/` — the
real API keys live in Secret Manager and are injected server-side. Tier
switching is one header (`x-quota-tier`) flipping which key the backend
attaches.

---

## 2. LLM Security v2

**What it shows:** Model Armor inspecting prompts before they reach Vertex
AI. Jailbreak attempts and malicious URIs are blocked at the Apigee layer;
benign prompts pass through.

**Backend route:** `POST /api/proxy/llm-security/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:generateContent`
— key injected as `x-apikey`. Model name and region come from the
`superdemo-config` secret and are surfaced in the UI footer.

**Demo path:**

1. Select **LLM Security v2** in the sidebar.
2. Click the **Safe: flower-shop names** chip. Click **Send Prompt** — the
   response card shows a normal Vertex AI completion.
3. Click the **Jailbreak attempt** chip. Click **Send Prompt** — Apigee
   returns a Model Armor block payload (no Vertex call was made).
4. Click the **Malicious URI** chip. Click **Send Prompt** — Model Armor's
   URI filter blocks it with a different rationale than the jailbreak.
5. (Optional) Type a custom prompt to show the inspection runs on
   arbitrary input.

**Talking points:** the model and region shown next to the Send button are
the actual values from your deployment. The block response includes the
specific Model Armor finding, so the audience can see *why* it was
blocked.

---

## 3. LLM Rate Limiting

**What it shows:** Apigee's `LLMTokenQuota` AI policy enforcing
token-based (not request-based) quotas. The same prompt is fanned out to
two tiers in parallel — Bronze (low limit) and Silver (high limit) — so
the audience can see Bronze trip a 429 while Silver keeps serving.

**Backend route:** `POST /api/proxy/llm-token-limits-v2/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:generateContent`
— key as `x-apikey`, tier as `x-rate-limit-tier` (`bronze` or `silver`).
The backend also mints a Vertex AI OAuth bearer via ADC because the
underlying proxy intentionally has no `<GoogleAccessToken>` policy.

**Demo path:**

1. Select **LLM Rate Limiting** in the sidebar. Note the two side-by-side
   panes (Bronze and Silver) and their respective token meters.
2. Type a short prompt and click **Send** — both panes fire in parallel,
   show the response, and their token meters tick up by roughly the same
   amount.
3. Click **Trigger 429 burst** — the UI fires five long pre-canned prompts
   sequentially against each tier. Bronze's meter fills, hits the cap, and
   the next request returns 429 from Apigee. Silver's meter keeps
   climbing without tripping.
4. Wait out the configured `interval_minutes` window (or just narrate it)
   to point out that quotas reset on the interval.

**Talking points:** Apigee is counting **tokens**, not requests — small
prompts are cheap, the canned "long science article" prompts are
expensive. The same proxy enforces both tiers via the API product
attached to the key.

---

## 4. MCP Server (apigee-mcp)

**What it shows:** Apigee acting as an MCP server that dynamically
discovers tools from Apigee API hub specs and exposes them to a streaming
agent. The user chats with an agent, the agent calls Apigee-brokered
tools, and the UI streams the deltas, tool calls, and tool results live.

**Backend routes:**
- `GET  /api/mcp/tools` — lists tools discovered from API hub specs.
- `POST /api/mcp/chat`  — Server-Sent Events stream of `delta`,
  `tool_call`, `tool_result`, `error`, `done` events. Sessions are keyed
  by a UUID stored in `sessionStorage`.

**Demo path:**

1. Select **MCP Server** in the sidebar. The left rail (**Discovered
   Tools**) lists every tool the agent has pulled from API hub — point out
   that nothing is hard-coded; publish a new spec and it appears here.
2. Click the canned prompt **List recent customers**. The chat shows the
   user message, a `→ tool(...)` bubble for the outbound call Apigee
   brokers, a `← 200 · {...}` bubble for the response, and then the
   assistant streams a natural-language summary token by token.
3. Click **Tell me about customer 1**. Same flow — the audience sees the
   agent pick a different tool from the same discovered list.
4. Click **Create a customer named Acme Corp**. Watch the agent call the
   create endpoint; the tool result bubble shows the new resource Apigee
   returned.
5. (Optional) Type a freeform prompt to show the agent reasoning over
   which tools to call.

**Talking points:** tool discovery, session continuity, and streaming are
all server-side concerns Apigee handles — the browser is a thin renderer.
If a session is dropped, the backend sends `session_restarted`, the UI
clears history, and the next prompt starts a fresh conversation under the
same id.

---

## Resetting between runs

- **Quota counters** reset on Apigee's window (1 min for trial basic-quota,
  1 hour for premium, configured interval for token limits). To force-reset
  during a presentation, redeploy the demo or wait out the window.
- **MCP session** can be reset by clearing `sessionStorage` in DevTools
  (key: `apigee-mcp-session`) and reloading.
- **Per-demo status dots** are set by `deploy-superdemo.sh` — re-run it to
  refresh all four.
