import type { ApigeeProxyLink, MoreInfoProps, PolicyLink } from './components/MoreInfo'

export type { ApigeeProxyLink, PolicyLink }

export type DemoInfo = MoreInfoProps

const APIGEE_POLICY_BASE =
  'https://cloud.google.com/apigee/docs/api-platform/reference/policies'

const GITHUB_BASE =
  'https://github.com/GoogleCloudPlatform/apigee-samples/tree/main'

// Apigee proxy names deployed by superdemo/deploy/deploy-superdemo.sh.
// Keep this in lockstep with that script's demo_proxy_names array (and the
// extra proxies the apigee-mcp deploy-all.sh installs).
const PROXY_NAMES_BY_DEMO: Record<string, string[]> = {
  'basic-quota': ['basic-quota'],
  'llm-security': ['llm-security-v2'],
  'llm-token-limits-v2': ['llm-token-limits-v2'],
  'apigee-mcp': ['crm-mcp-proxy', 'customers-api', 'mcp-spec-tools'],
  'cloud-logging': ['sample-cloud-logging'],
  'threat-protection': ['threat-protection'],
  'llm-circuit-breaking': ['llm-circuit-breaking-v1'],
  'llm-token-limits-per-user': ['llm-token-limits-per-user-v1'],
  'llm-semantic-cache-v2': ['llm-semantic-cache-v2'],
}

export function apigeeProxyLinks(
  demoId: string,
  projectId: string | null | undefined,
): ApigeeProxyLink[] {
  if (!projectId) return []
  const names = PROXY_NAMES_BY_DEMO[demoId] ?? []
  return names.map((name) => ({
    label: name,
    href: `https://console.cloud.google.com/apigee/proxies/${name}/overview?project=${projectId}`,
  }))
}

export const demoInfo: Record<string, DemoInfo> = {
  'basic-quota': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    VAK[VerifyAPIKey]
    Q[Quota Policy]
  end
  Backend[(httpbin)]
  Browser --> VAK --> Q --> Backend
  Q -. 429 .-> Browser`,
    description:
      'Shows Apigee enforcing different per-product quotas on a single shared proxy. The trial product allows 10 requests per minute; the premium product allows 1000 per hour. Switching tier changes nothing in the backend — only the Quota policy attached to the API product.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      { label: 'Quota', href: `${APIGEE_POLICY_BASE}/quota-policy` },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'RaiseFault',
        href: `${APIGEE_POLICY_BASE}/raise-fault-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/basic-quota`,
  },
  'llm-security': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    SP[Sanitize policies]
  end
  MA[Model Armor]
  Vertex[(Vertex AI)]
  Browser -- prompt --> Apigee
  Apigee -- inspect --> MA
  MA -- verdict --> Apigee
  Apigee -- safe --> Vertex
  Apigee -. blocked .-> Browser
  Vertex --> Apigee --> Browser`,
    description:
      'Apigee calls out to Model Armor — a separate Google Cloud service, not a component inside the proxy — to inspect every prompt before it reaches Vertex AI, and again to inspect responses on the way back. Apigee enforces a uniform safety policy in front of the LLM backend without the client or the model needing to know.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      { label: 'CORS', href: `${APIGEE_POLICY_BASE}/cors-policy` },
      {
        label: 'OASValidation',
        href: `${APIGEE_POLICY_BASE}/oas-validation-policy`,
      },
      {
        label: 'ExtractVariables',
        href: `${APIGEE_POLICY_BASE}/extract-variables-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'FlowCallout',
        href: `${APIGEE_POLICY_BASE}/flow-callout-policy`,
      },
      {
        label: 'SanitizeUserPrompt',
        href: `${APIGEE_POLICY_BASE}/sanitize-user-prompt-policy`,
      },
      {
        label: 'SanitizeModelResponse',
        href: `${APIGEE_POLICY_BASE}/sanitize-llm-response-policy`,
      },
      {
        label: 'KeyValueMapOperations',
        href: `${APIGEE_POLICY_BASE}/key-value-map-operations-policy`,
      },
      {
        label: 'RaiseFault',
        href: `${APIGEE_POLICY_BASE}/raise-fault-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/llm-security-v2`,
  },
  'llm-token-limits-v2': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    VAK[VerifyAPIKey]
    Q["Token Quota<br/>bronze / silver"]
    Mint["Mint Vertex<br/>OAuth Token"]
  end
  Vertex[(Vertex AI)]
  Browser --> VAK --> Q --> Mint --> Vertex
  Q -. 429 over budget .-> Browser`,
    description:
      'Token-based quotas: bronze and silver tiers each get a budget measured in tokens consumed, not requests made. Apigee also mints the Vertex bearer token so the client never needs Google credentials.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      {
        label: 'LLMTokenQuota',
        href: `${APIGEE_POLICY_BASE}/llm-token-quota-policy`,
      },
      {
        label: 'ExtractVariables',
        href: `${APIGEE_POLICY_BASE}/extract-variables-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'DataCapture',
        href: `${APIGEE_POLICY_BASE}/data-capture-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/llm-token-limits-v2`,
  },
  'cloud-logging': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    ML[MessageLogging]
  end
  Backend[(httpbin)]
  Logs[(Cloud Logging)]
  Browser <--> Apigee <--> Backend
  ML -. PostClientFlow .-> Logs`,
    description:
      "After the client has its response, Apigee's MessageLogging policy fires in the PostClientFlow and exports per-request metadata to Cloud Logging. The proxy authenticates as a service account holding logging.logEntries.create — the client never needs Cloud credentials.",
    policyLinks: [
      {
        label: 'MessageLogging',
        href: `${APIGEE_POLICY_BASE}/message-logging-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/cloud-logging`,
  },
  'threat-protection': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    RE[RegEx Protection]
    JT[JSONThreat Protection]
  end
  Backend[(httpbin)]
  Browser -- "GET /json" --> RE --> Backend
  Browser -- "POST /echo" --> JT --> Backend
  RE -. 500 on match .-> Browser
  JT -. 500 on match .-> Browser`,
    description:
      'Two policies guard the proxy before requests reach any backend. RegularExpressionProtection blocks query values matching SQL keywords on GET /json; JSONThreatProtection rejects POST /echo bodies that exceed the configured object-key limit. Either match short-circuits with HTTP 500.',
    policyLinks: [
      {
        label: 'RegularExpressionProtection',
        href: `${APIGEE_POLICY_BASE}/regular-expression-protection`,
      },
      {
        label: 'JSONThreatProtection',
        href: `${APIGEE_POLICY_BASE}/json-threat-protection-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/threat-protection`,
  },
  'apigee-mcp': {
    diagram: `flowchart LR
  Agent[ADK Agent]
  Vertex[(Vertex AI)]
  subgraph Apigee["Apigee"]
    direction TB
    MCPProxy[crm-mcp-proxy]
    Specs[mcp-spec-tools]
    Tools[customers-api]
  end
  MCP["MCP Server<br/>(Cloud Run)"]
  Hub[(API hub)]
  Backend[("CRM API<br/>(Cloud Run)")]
  Agent <--> Vertex
  Agent -- "x-api-key" --> MCPProxy <--> MCP
  MCP -- "1. discover" --> Specs --> Hub
  MCP -- "2. invoke" --> Tools --> Backend`,
    description:
      'The MCP server runs on Cloud Run; the agent never talks to it directly. Three Apigee proxies sit in between: one fronts the MCP server (API-key auth), one surfaces API hub specs for tool discovery, and one fronts the actual backend each tool calls. Apigee is the trust boundary on every hop.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      { label: 'OAuthV2', href: `${APIGEE_POLICY_BASE}/oauthv2-policy` },
      {
        label: 'AccessEntity',
        href: `${APIGEE_POLICY_BASE}/access-entity-policy`,
      },
      {
        label: 'ExtractVariables',
        href: `${APIGEE_POLICY_BASE}/extract-variables-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'RaiseFault',
        href: `${APIGEE_POLICY_BASE}/raise-fault-policy`,
      },
      { label: 'XMLToJSON', href: `${APIGEE_POLICY_BASE}/xml-json-policy` },
    ],
    githubHref: `${GITHUB_BASE}/apigee-mcp`,
  },
  'llm-circuit-breaking': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    Q[Quota<br/>2 failures per 2 min]
    RR{RouteRule}
  end
  P[(Vertex AI<br/>primary region)]
  S[(Vertex AI<br/>secondary region)]
  Browser --> Q --> RR
  RR -- "breaker closed" --> P
  RR -- "breaker open" --> S
  P -. "4xx/5xx → retry" .-> S`,
    description:
      'The breaker counts upstream failures, not requests. Q-LLM-Failover-Counter is attached only to the primary target’s FaultRule (condition: status 429 or > 399), so it increments solely when Vertex AI rejects a call. Q-LLM-Failover then reads that shared rolling-window counter on every request — once 2 failures land inside 2 minutes it trips, and the RouteRule parks traffic on a secondary Vertex AI region until the window rolls off. Within a single failing request, the FaultRule also retries against the secondary region via a ServiceCallout, so the caller still gets an answer. The proxy records the winning target in a flow variable, and superdemo patches it into x-target-pool / x-target-region response headers so the UI can show which backend actually served each request. Because a healthy primary never feeds the counter, normal traffic stays on primary. The sibling sample’s notebook forces a failover with a Cloud Tasks fan-out meant to exhaust the project’s Gemini quota — but Gemini 2.5 is served under dynamic shared quota, which has no per-project limit to exceed, so that trigger is not deterministic. This UI instead sends requests for a model Vertex AI does not publish: the 404 feeds the same counter a 429 would, and the breaker opens every time. Note the quota has no identifier, so it is shared across every caller of this deployment.',
    policyLinks: [
      { label: 'Quota', href: `${APIGEE_POLICY_BASE}/quota-policy` },
      {
        label: 'ServiceCallout',
        href: `${APIGEE_POLICY_BASE}/service-callout-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'ExtractVariables',
        href: `${APIGEE_POLICY_BASE}/extract-variables-policy`,
      },
      {
        label: 'DataCapture',
        href: `${APIGEE_POLICY_BASE}/data-capture-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/llm-circuit-breaking`,
  },
  'llm-token-limits-per-user': {
    diagram: `flowchart LR
  Alice([Alice])
  Bob([Bob])
  subgraph Apigee["Apigee Proxy"]
    VK[VerifyAPIKey]
    TQ["Quota<br/>keyed on x-userid"]
  end
  Vertex[(Vertex AI)]
  Alice -- "x-userid: alice" --> VK
  Bob -- "x-userid: bob" --> VK
  VK --> TQ --> Vertex
  TQ -. "429 when that user's<br/>budget is spent" .-> Alice`,
    description:
      "Both users present the same API key, so they share an app and a product — but the quota is keyed on the x-userid header (Identifier ref=request.header.x-userid), so each gets an independent budget. Spend Alice's bronze allowance and she gets a 429 while Bob, on the very same key, still gets a 200. It is a standard Quota policy of type=flexi, split in two the way Apigee's token-limit samples always are: Q-TokenQuota runs EnforceOnly on the request and just checks the budget, while Q-TokenQuotaCounter runs CountOnly on the response and spends it, with MessageWeight ref=total_token_count. That variable comes from EV-ExtractTokenCounts reading usageMetadata.totalTokenCount out of the Vertex response — so cost is measured in tokens rather than requests, and it can only be charged after the model has answered.",
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      { label: 'Quota', href: `${APIGEE_POLICY_BASE}/quota-policy` },
      {
        label: 'ExtractVariables',
        href: `${APIGEE_POLICY_BASE}/extract-variables-policy`,
      },
      {
        label: 'AssignMessage',
        href: `${APIGEE_POLICY_BASE}/assign-message-policy`,
      },
      {
        label: 'DataCapture',
        href: `${APIGEE_POLICY_BASE}/data-capture-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/llm-token-limits-per-user`,
  },
  'llm-semantic-cache-v2': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    SCL[SemanticCacheLookup]
    SCP[SemanticCachePopulate]
  end
  VS[(Vertex AI<br/>Vector Search)]
  Vertex[(Vertex AI)]
  Browser -- prompt --> SCL
  SCL -- embed + search --> VS
  SCL -. cache hit .-> Browser
  SCL -- miss --> Vertex --> SCP --> Browser
  SCP -- upsert embedding --> VS`,
    description:
      "SemanticCacheLookup embeds the incoming prompt with an embeddings model, then does a nearest-neighbour search over a Vertex AI Vector Search index. If a prior prompt's embedding is within the distance threshold, its cached response is returned immediately and the model call is skipped. On a miss, the request reaches Vertex AI and SemanticCachePopulate stores the new prompt embedding and response for the configured TTL. The superdemo surfaces no hit/miss flag — the latency drop on a reworded prompt is the signal.",
    policyLinks: [
      {
        label: 'SemanticCacheLookup',
        href: `${APIGEE_POLICY_BASE}/semantic-cache-lookup-policy`,
      },
      {
        label: 'SemanticCachePopulate',
        href: `${APIGEE_POLICY_BASE}/semantic-cache-populate-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/llm-semantic-cache-v2`,
  },
}
