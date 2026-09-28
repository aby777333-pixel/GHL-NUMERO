import type { NumeroApi } from './types'
import { SupabaseP3 } from './supabaseP3'

export { liveConfigured } from './supabaseCore'
export { BUILT_IN_REGISTER_KINDS } from './supabaseOps'

/**
 * The live data layer, in three layers that mirror the phases of the build:
 * supabaseCore (the ledger) → supabaseOps (operations) → supabaseP3 (inventory, investments, control, simulation, platform).
 */
export class SupabaseApi extends SupabaseP3 implements NumeroApi {}
