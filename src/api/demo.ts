import type { NumeroApi } from './types'
import { DemoPlatform } from './demoPlatform'

export { uid, DEMO_USERS, DemoCore } from './demoCore'
export { DemoOpsA } from './demoOps'
export { DemoOpsB } from './demoOpsB'

/**
 * The sample-data engine, in layers that mirror the phases of the build:
 * demoCore (the ledger) → demoOps, demoOpsB (operations) → demoInventory → demoInvest → demoControl → demoPlatform.
 * Each layer follows the rules of the database migration it mirrors. All data it holds is SAMPLE DATA.
 */
export class DemoEngine extends DemoPlatform implements NumeroApi {}
