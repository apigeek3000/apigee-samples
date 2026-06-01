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
    ],
    githubHref: `${GITHUB_BASE}/basic-quota`,
  },
  'llm-security': {
    diagram: `flowchart LR
  Browser([Browser])
  subgraph Apigee["Apigee Proxy"]
    MA[Model Armor]
  end
  Vertex[(Vertex AI)]
  Browser -- prompt --> Apigee
  Apigee -- safe --> Vertex
  Apigee -. blocked .-> Browser
  Vertex --> Apigee --> Browser`,
    description:
      'Every prompt is inspected by Model Armor before reaching Vertex AI; responses are inspected on the way back. Apigee enforces a uniform safety policy in front of the LLM backend without the client or the model needing to know.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
      {
        label: 'ServiceCallout',
        href: `${APIGEE_POLICY_BASE}/service-callout-policy`,
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
      { label: 'Quota', href: `${APIGEE_POLICY_BASE}/quota-policy` },
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
    ],
    githubHref: `${GITHUB_BASE}/apigee-mcp`,
  },
}
