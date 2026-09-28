import { describe, expect, it } from 'vitest'
import { authLinkIn, friendlyAuthError } from '../src/api/auth'

describe('what an email link of the sign-in service leaves in the address', () => {
  it('an ordinary address carries nothing', () => {
    expect(authLinkIn('https://ghlnumero.netlify.app/')).toEqual({ present: false, recovery: false, error: null })
    expect(authLinkIn('https://ghlnumero.netlify.app/bills?tab=open#top')).toEqual({ present: false, recovery: false, error: null })
    expect(authLinkIn('not a url')).toEqual({ present: false, recovery: false, error: null })
  })
  it('a confirmation link carries a session', () => {
    const l = authLinkIn('https://ghlnumero.netlify.app/#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=signup')
    expect(l).toEqual({ present: true, recovery: false, error: null })
  })
  it('a password link is known as one', () => {
    expect(authLinkIn('https://ghlnumero.netlify.app/#access_token=abc&type=recovery').recovery).toBe(true)
    expect(authLinkIn('http://localhost:5177/?code=123').present).toBe(true)
  })
  it('an expired link says so in plain words', () => {
    const l = authLinkIn('https://ghlnumero.netlify.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(l.present).toBe(true)
    expect(l.recovery).toBe(false)
    expect(l.error).toMatch(/expired or has already been used/)
  })
})

describe('the errors of the sign-in service in plain words', () => {
  it('names what went wrong', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe('The email or the password is not right.')
    expect(friendlyAuthError('Email not confirmed')).toMatch(/not confirmed yet/)
    expect(friendlyAuthError('User already registered')).toMatch(/already exists/)
    expect(friendlyAuthError('email rate limit exceeded')).toMatch(/Wait a few minutes/)
    expect(friendlyAuthError('For security purposes, you can only request this after 42 seconds.')).toMatch(/Wait a few minutes/)
    expect(friendlyAuthError('Failed to fetch')).toMatch(/could not be reached/)
    expect(friendlyAuthError('New password should be different from the old password.')).toMatch(/differ from the old one/)
  })
  it('passes on what it does not know', () => {
    expect(friendlyAuthError('Something unusual')).toBe('Something unusual')
  })
})
