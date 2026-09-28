import type { ID } from '@/engine/types'

// Kept apart from ./sandbox, which carries the engine of the sandbox: the menu names these people on every
// screen, and must not bring that engine into the part of the application that everyone loads.

/** People of the sandbox: one to prepare, others to approve, so that maker-checker can be tried as it is configured. */
export const SANDBOX_PEOPLE: { id: ID; label: string }[] = [
  { id: 'demo-accountant', label: 'The person who prepares' },
  { id: 'demo-finance', label: 'A finance head who approves' },
  { id: 'demo-cfo', label: 'A second approver' },
  { id: 'demo-owner', label: 'The Group Super Admin' },
]
