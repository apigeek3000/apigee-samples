import type { MoreInfoProps, PolicyLink } from './components/MoreInfo'

export type { PolicyLink }

export type DemoInfo = MoreInfoProps

const APIGEE_POLICY_BASE =
  'https://cloud.google.com/apigee/docs/api-platform/reference/policies'

const GITHUB_BASE =
  'https://github.com/GoogleCloudPlatform/apigee-samples/tree/main'

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
  'apigee-mcp': {
    diagram: `flowchart LR
  Agent([Agent])
  MCP[MCP Server]
  Hub[(API Hub specs)]
  Apigee[Apigee Proxies]
  Backend[(Backends)]
  Agent <--> MCP
  MCP --> Hub
  MCP --> Apigee --> Backend`,
    description:
      'An LLM agent discovers tools by reading OpenAPI specs published in Apigee API hub, then invokes those tools through Apigee proxies. Apigee acts as the trust boundary between the agent and the underlying backends.',
    policyLinks: [
      {
        label: 'VerifyAPIKey',
        href: `${APIGEE_POLICY_BASE}/verify-api-key-policy`,
      },
    ],
    githubHref: `${GITHUB_BASE}/apigee-mcp`,
  },
}
