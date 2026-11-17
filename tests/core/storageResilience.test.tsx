/**
 * @jest-environment jsdom
 *
 * Browser storage that is blocked, full or holds something unexpected must not
 * take a page down, and a page that does throw must show a way forward instead
 * of a blank screen.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardError from '@/app/dashboard/error'
import RootError from '@/app/error'
import { readStorage, removeStorage, writeStorage } from '@/lib/services/browserStorage'
import { STORAGE_KEY, clearProfile, getProfile, isProfileComplete, saveProfile, toStyleProfile } from '@/lib/services/styleProfileService'

const PROFILE = { preferredStyles: ['Classic'], favoriteColors: ['Navy'], occasionPreferences: ['Office Work'] }

/** Makes every localStorage call throw, as a browser with storage blocked does. */
function blockStorage() {
  const refuse = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => jest.restoreAllMocks())

describe('storage access', () => {
  it('reads, writes and removes when storage works', () => {
    expect(writeStorage('k', 'v')).toBe(true)
    expect(readStorage('k')).toBe('v')
    expect(removeStorage('k')).toBe(true)
    expect(readStorage('k')).toBeNull()
  })

  it('never throws when storage is blocked, and reports that nothing was stored', () => {
    blockStorage()
    expect(readStorage('k')).toBeNull()
    expect(writeStorage('k', 'v')).toBe(false)
    expect(removeStorage('k')).toBe(false)
  })

  it('reports a full quota as a failed write', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded.', 'QuotaExceededError') })
    expect(writeStorage('k', 'v')).toBe(false)
  })
})

describe('saved style preferences', () => {
  it('round-trips a profile', () => {
    expect(saveProfile(PROFILE)).toBe(true)
    expect(getProfile()).toEqual(PROFILE)
    expect(clearProfile()).toBe(true)
    expect(getProfile()).toBeNull()
  })

  it('behaves as "no saved profile" when storage is blocked, without throwing', () => {
    blockStorage()
    expect(getProfile()).toBeNull()
    expect(saveProfile(PROFILE)).toBe(false)
    expect(clearProfile()).toBe(false)
    expect(isProfileComplete(getProfile())).toBe(false)
  })

  it.each([
    ['an empty object', '{}'],
    ['a profile with a missing list', JSON.stringify({ preferredStyles: ['Classic'], favoriteColors: ['Navy'] })],
    ['a list that is not a list', JSON.stringify({ ...PROFILE, favoriteColors: 'Navy' })],
    ['a list holding something other than text', JSON.stringify({ ...PROFILE, preferredStyles: ['Classic', 7] })],
    ['a null', 'null'],
    ['a number', '42'],
    ['an array', '[]'],
    ['text that is not JSON', '{not json'],
  ])('treats %s as no saved profile', (_name, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored)
    expect(getProfile()).toBeNull()
    // The value every caller then reads from is safe to use.
    expect(isProfileComplete(getProfile())).toBe(false)
  })

  it('carries over the three known lists and nothing else', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...PROFILE, note: 'extra text', nested: { deep: true } }))
    expect(getProfile()).toEqual(PROFILE)
    expect(toStyleProfile({ ...PROFILE, extra: 1 })).toEqual(PROFILE)
  })
})

describe('error boundaries', () => {
  it.each([
    ['the dashboard', DashboardError],
    ['the rest of the site', RootError],
  ])('show a message and a way to try again for %s, without the error text', async (_name, Boundary) => {
    const user = userEvent.setup()
    const reset = jest.fn()
    render(<Boundary error={Object.assign(new Error('SECRET internal detail'), { digest: 'abc' })} reset={reset} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.queryByText(/SECRET internal detail/)).toBeNull()
    // The reassurance used after a failed analysis would be untrue here.
    expect(screen.queryByText('Your photos and choices are still here.')).toBeNull()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
