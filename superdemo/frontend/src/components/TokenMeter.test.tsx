import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenMeter } from './TokenMeter'

describe('TokenMeter', () => {
  it('renders used / limit numerals', () => {
    render(<TokenMeter label="Bronze" used={712} limit={2000} />)
    expect(screen.getByText('712 / 2000')).toBeInTheDocument()
    expect(screen.getByText('Bronze')).toBeInTheDocument()
  })

  it('marks the bar as over-limit when used >= limit', () => {
    render(<TokenMeter label="Bronze" used={2100} limit={2000} />)
    const bar = screen.getByTestId('token-meter-bar')
    expect(bar.dataset.overLimit).toBe('true')
  })

  it('shows --/-- placeholder when limit is unknown', () => {
    render(<TokenMeter label="Bronze" used={0} limit={undefined} />)
    expect(screen.getByText(/--/)).toBeInTheDocument()
  })
})
