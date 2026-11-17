/**
 * @jest-environment jsdom
 *
 * The Settings page says what its one button removes and what it leaves.
 * It removes the manual style preferences. Style DNA is a separate entry in
 * the browser and is not touched here; the page has to say so.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import SettingsPage from '@/app/dashboard/settings/page'
import { STORAGE_KEY as STYLE_DNA_KEY } from '@/lib/services/aiStyleProfileService'
import { STORAGE_KEY as PREFERENCES_KEY } from '@/lib/services/styleProfileService'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

const PREFERENCES = JSON.stringify({ preferredStyles: ['Classic'], favoriteColors: ['Navy'], occasionPreferences: ['Office Work'] })
const STYLE_DNA = JSON.stringify({ schema_version: '1.0', status: 'complete', marker: 'style-dna-stays' })

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(PREFERENCES_KEY, PREFERENCES)
  window.localStorage.setItem(STYLE_DNA_KEY, STYLE_DNA)
  ;(toast.success as jest.Mock).mockClear()
  ;(toast.error as jest.Mock).mockClear()
})
afterEach(() => jest.restoreAllMocks())

describe('Settings: what clearing removes', () => {
  it('says that Style DNA is managed separately and stays stored, and where to delete it', () => {
    render(<SettingsPage />)
    const note = screen.getByTestId('style-dna-note')
    expect(note.textContent).toBe('Style DNA is managed separately. Clearing your style preferences does not remove it: it stays stored in this browser until you delete it on the Style profile page. No account exists, so nothing is kept on a server.')
    expect((screen.getByRole('link', { name: 'Style profile page' }) as HTMLAnchorElement).getAttribute('href')).toBe('/dashboard/profile')
  })

  it('no longer says that nothing else needs to be deleted', () => {
    render(<SettingsPage />)
    expect(document.body.textContent).not.toMatch(/nothing else needs to be deleted/i)
  })

  it('names the button after what it clears', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: 'Clear Style Preferences' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Clear Style Profile/ })).toBeNull()
  })

  it('removes the style preferences and leaves Style DNA exactly as it was', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: 'Clear Style Preferences' }))

    expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull()
    expect(window.localStorage.getItem(STYLE_DNA_KEY)).toBe(STYLE_DNA)
    expect(toast.success).toHaveBeenCalledWith('Style preferences cleared. Style DNA was not changed.')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not report success when the browser refuses to remove the preferences', async () => {
    const user = userEvent.setup()
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('The operation is insecure.', 'SecurityError') })
    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: 'Clear Style Preferences' }))

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Your browser did not allow the style preferences to be removed from this device.')
  })
})
