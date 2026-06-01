import { describe, it, expect } from 'vitest'
import { apigeeProxyLinks } from './demoInfo'

describe('apigeeProxyLinks', () => {
  it('returns an empty array when projectId is missing', () => {
    expect(apigeeProxyLinks('basic-quota', null)).toEqual([])
    expect(apigeeProxyLinks('basic-quota', undefined)).toEqual([])
    expect(apigeeProxyLinks('basic-quota', '')).toEqual([])
  })

  it('returns an empty array for an unknown demo id', () => {
    expect(apigeeProxyLinks('does-not-exist', 'my-proj')).toEqual([])
  })

  it('builds an Apigee console URL for a single-proxy demo', () => {
    expect(apigeeProxyLinks('basic-quota', 'my-proj')).toEqual([
      {
        label: 'basic-quota',
        href: 'https://console.cloud.google.com/apigee/proxies/basic-quota/overview?project=my-proj',
      },
    ])
  })

  it('returns one link per proxy for the apigee-mcp demo', () => {
    const links = apigeeProxyLinks('apigee-mcp', 'my-proj')
    expect(links.map((l) => l.label)).toEqual([
      'crm-mcp-proxy',
      'customers-api',
      'mcp-spec-tools',
    ])
    for (const link of links) {
      expect(link.href).toContain('?project=my-proj')
      expect(link.href).toContain('console.cloud.google.com/apigee/proxies/')
    }
  })
})
