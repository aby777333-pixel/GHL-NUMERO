import { describe, expect, it } from 'vitest'
import { DemoEngine } from '../src/api/demo'

describe('Group Super Admins: more than one person with the authority of the owner', () => {
  it('a person named before signing up waits; the owner is always listed and cannot be withdrawn', async () => {
    const e = new DemoEngine()
    await e.signIn()
    const before = await e.listSuperAdmins()
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ status: 'active', is_owner: true })

    expect(await e.grantSuperAdmin('  Saro@Example.TEST ')).toBe('pending')
    expect(await e.grantSuperAdmin('saro@example.test')).toBe('pending')         // naming twice lists once
    const after = await e.listSuperAdmins()
    expect(after.map((a) => [a.email, a.status])).toEqual([[before[0].email, 'active'], ['saro@example.test', 'pending']])

    await expect(e.grantSuperAdmin('not-an-email')).rejects.toThrow(/not an email address/)
    await expect(e.revokeSuperAdmin(before[0].email)).rejects.toThrow(/owner's authority cannot be withdrawn/)
    await expect(e.revokeSuperAdmin('nobody@example.test')).rejects.toThrow(/is not a Group Super Admin/)

    await e.revokeSuperAdmin('saro@example.test')
    expect(await e.listSuperAdmins()).toHaveLength(1)
  })

  it('only a Group Super Admin sees the list or names anyone', async () => {
    const e = new DemoEngine()
    await e.signIn()
    ;(e as unknown as { actor: string }).actor = 'demo-accountant'
    expect(await e.listSuperAdmins()).toEqual([])
    await expect(e.grantSuperAdmin('x@example.test')).rejects.toThrow(/only a Group Super Admin/)
    await expect(e.revokeSuperAdmin('x@example.test')).rejects.toThrow(/only a Group Super Admin/)
  })
})
