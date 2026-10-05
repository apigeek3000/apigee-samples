import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersPage } from './UsersPage'

vi.mock('../api', () => ({
  getAllowlist: vi.fn(),
  addAllowlistEntry: vi.fn(),
  removeAllowlistEntry: vi.fn(),
}))

import { addAllowlistEntry, getAllowlist, removeAllowlistEntry } from '../api'

const list = { admins: ['me@corp.com'], domains: ['corp.com'], emails: ['guest@x.com'] }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getAllowlist).mockResolvedValue(list)
})

describe('UsersPage', () => {
  it('renders all three lists with their entries', async () => {
    render(<UsersPage />)
    const admins = await screen.findByRole('region', { name: 'Admins' })
    expect(within(admins).getByText('me@corp.com')).toBeInTheDocument()
    expect(within(admins).getByText('Admins can sign in and manage this page.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Domains' })).getByText('corp.com')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Emails' })).getByText('guest@x.com')).toBeInTheDocument()
  })

  it('adds an entry, shows it and clears the input', async () => {
    vi.mocked(addAllowlistEntry).mockResolvedValue({ ...list, domains: ['corp.com', 'partner.com'] })
    const user = userEvent.setup()
    render(<UsersPage />)
    const domains = await screen.findByRole('region', { name: 'Domains' })
    const input = within(domains).getByRole('textbox', { name: 'Add to Domains' })

    await user.type(input, 'partner.com')
    await user.click(within(domains).getByRole('button', { name: 'Add' }))

    expect(addAllowlistEntry).toHaveBeenCalledWith('domains', 'partner.com')
    expect(await within(domains).findByText('partner.com')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('does not submit an empty value', async () => {
    const user = userEvent.setup()
    render(<UsersPage />)
    const emails = await screen.findByRole('region', { name: 'Emails' })
    await user.click(within(emails).getByRole('button', { name: 'Add' }))
    expect(addAllowlistEntry).not.toHaveBeenCalled()
  })

  it('removes an entry', async () => {
    vi.mocked(removeAllowlistEntry).mockResolvedValue({ ...list, emails: [] })
    const user = userEvent.setup()
    render(<UsersPage />)
    const emails = await screen.findByRole('region', { name: 'Emails' })

    await user.click(within(emails).getByRole('button', { name: 'Remove guest@x.com' }))

    expect(removeAllowlistEntry).toHaveBeenCalledWith('emails', 'guest@x.com')
    await waitFor(() => expect(within(emails).queryByText('guest@x.com')).not.toBeInTheDocument())
  })

  it('shows backend errors inline in the affected section only', async () => {
    vi.mocked(addAllowlistEntry).mockRejectedValue({ status: 422, message: "Not a valid domain: 'nodot'" })
    const user = userEvent.setup()
    render(<UsersPage />)
    const domains = await screen.findByRole('region', { name: 'Domains' })

    await user.type(within(domains).getByRole('textbox', { name: 'Add to Domains' }), 'nodot')
    await user.click(within(domains).getByRole('button', { name: 'Add' }))

    expect(await within(domains).findByRole('alert')).toHaveTextContent("Not a valid domain: 'nodot'")
    expect(within(screen.getByRole('region', { name: 'Emails' })).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.mocked(getAllowlist).mockRejectedValue({ status: 503, message: 'Allowlist store unavailable' })
    render(<UsersPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Allowlist store unavailable')
  })
})
