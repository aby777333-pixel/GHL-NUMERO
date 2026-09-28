import { sb } from './supabaseCore'

// =====================================================================
// SIGN-IN HELPERS for the live system: what an email link brought back,
// a password forgotten, a confirmation email to send again, and errors
// said in plain words. The demo does not use any of this.
// =====================================================================

export interface AuthLink {
  /** the address carries what an email link of the sign-in service brings back */
  present: boolean
  /** the link was sent to set a new password */
  recovery: boolean
  /** the link could not be used: expired, already used, refused */
  error: string | null
}

/** Reads what an email link left in the address: a session, a code, the kind of link, or an error. */
export function authLinkIn(href: string): AuthLink {
  let url: URL
  try { url = new URL(href) } catch { return { present: false, recovery: false, error: null } }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const query = url.searchParams
  const get = (k: string) => hash.get(k) ?? query.get(k)
  const described = get('error_description') ?? get('error')
  const present = Boolean(get('access_token') || get('code') || get('token_hash') || described)
  return {
    present,
    recovery: get('type') === 'recovery',
    error: described ? friendlyLinkError(get('error_code'), described) : null,
  }
}

function friendlyLinkError(code: string | null, described: string): string {
  if (code === 'otp_expired' || /expired|invalid/i.test(described)) return 'This link has expired or has already been used. Ask for a new one below.'
  if (code === 'access_denied') return 'The link was refused. Ask for a new one below.'
  return described.replace(/\+/g, ' ')
}

/** The errors of the sign-in service, said in plain words. What is not recognised is passed on as it came. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'The email or the password is not right.'
  if (m.includes('email not confirmed')) return 'This email address is not confirmed yet. Open the link in the confirmation email, or send it again below.'
  if (m.includes('user already registered') || m.includes('already been registered')) return 'An account with this email already exists. Sign in, or set a new password with "Forgot password".'
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Too many attempts or emails in a short time. Wait a few minutes, then try again.'
  if (m.includes('same password') || m.includes('different from the old')) return 'The new password must differ from the old one.'
  if (m.includes('password should be') || m.includes('weak password') || m.includes('password is known')) return 'Choose a stronger password: at least 10 characters, and not one that has appeared in a data breach.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'The server could not be reached. Check the connection and try again.'
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'New accounts are not being accepted. Ask the Group Super Admin.'
  return message
}

/** Where email links bring the person back to: this application, at its start. */
const back = () => window.location.origin + '/'

/** Sends a link to set a new password. The service does not say whether the address has an account. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: back() })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Sends the confirmation email of a new account again. */
export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await sb().auth.resend({ type: 'signup', email, options: { emailRedirectTo: back() } })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Sets the password of the person signed in through a password link. */
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await sb().auth.updateUser({ password })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Takes what an email link left in the address away, so that it is neither bookmarked nor shared. */
export function clearAuthLinkFromAddress(): void {
  const url = new URL(window.location.href)
  for (const k of ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']) url.searchParams.delete(k)
  url.hash = ''
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
}
