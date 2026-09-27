import type { CompanyCreatePayload, TemplateAccount } from './types'

// Company templates (spec 83, 371, 1310). Templates are recommendations only:
// the wizard shows every account and nothing becomes active without user confirmation.
// Everything remains editable after creation.

type A = TemplateAccount
const g = (code: string, name: string, type: A['type'], subtype: string, parent_code?: string): A => ({ code, name, type, subtype, parent_code, is_group: true })
const a = (code: string, name: string, type: A['type'], subtype: string, parent_code: string, control_type?: string): A => ({ code, name, type, subtype, parent_code, control_type })

export const BASE_CHART: A[] = [
  g('1000', 'Assets', 'asset', 'other_asset'),
  g('1100', 'Current Assets', 'asset', 'other_current_asset', '1000'),
  a('1110', 'Cash in Hand', 'asset', 'cash', '1100', 'cash'),
  a('1115', 'Petty Cash', 'asset', 'cash', '1100', 'cash'),
  g('1120', 'Bank Accounts', 'asset', 'bank', '1100'),
  a('1121', 'Primary Bank Account', 'asset', 'bank', '1120', 'bank'),
  a('1130', 'Accounts Receivable', 'asset', 'receivable', '1100', 'receivable'),
  a('1140', 'Inventory', 'asset', 'inventory', '1100'),
  a('1150', 'Vendor Advances', 'asset', 'advance', '1100', 'advance_paid'),
  a('1155', 'Employee Advances', 'asset', 'advance', '1100'),
  a('1160', 'Security Deposits Paid', 'asset', 'deposit', '1000'),
  a('1170', 'Prepaid Expenses', 'asset', 'prepaid', '1100'),
  g('1180', 'Input Tax Credit', 'asset', 'tax_receivable', '1100'),
  a('1181', 'Input CGST', 'asset', 'tax_receivable', '1180', 'tax'),
  a('1182', 'Input SGST', 'asset', 'tax_receivable', '1180', 'tax'),
  a('1183', 'Input IGST', 'asset', 'tax_receivable', '1180', 'tax'),
  a('1185', 'TDS Receivable', 'asset', 'tax_receivable', '1100', 'tax'),
  a('1190', 'Intercompany Receivables', 'asset', 'intercompany_receivable', '1100', 'intercompany'),
  g('1200', 'Investments', 'asset', 'investment', '1000'),
  a('1205', 'Investments — General', 'asset', 'investment', '1200'),
  a('1210', 'Fixed Deposits', 'asset', 'investment', '1200'),
  g('1300', 'Fixed Assets', 'asset', 'fixed_asset', '1000'),
  a('1310', 'Land & Building', 'asset', 'fixed_asset', '1300'),
  a('1320', 'Plant & Equipment', 'asset', 'fixed_asset', '1300'),
  a('1330', 'Furniture & Fixtures', 'asset', 'fixed_asset', '1300'),
  a('1340', 'Vehicles', 'asset', 'fixed_asset', '1300'),
  a('1350', 'Computers & IT Equipment', 'asset', 'fixed_asset', '1300'),
  a('1390', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation', '1300'),

  g('2000', 'Liabilities', 'liability', 'other_liability'),
  g('2100', 'Current Liabilities', 'liability', 'other_liability', '2000'),
  a('2110', 'Accounts Payable', 'liability', 'payable', '2100', 'payable'),
  a('2120', 'Accrued Expenses', 'liability', 'accrued', '2100'),
  a('2130', 'Customer Advances', 'liability', 'advance_received', '2100', 'advance_received'),
  g('2140', 'Output Tax', 'liability', 'tax_payable', '2100'),
  a('2141', 'Output CGST', 'liability', 'tax_payable', '2140', 'tax'),
  a('2142', 'Output SGST', 'liability', 'tax_payable', '2140', 'tax'),
  a('2143', 'Output IGST', 'liability', 'tax_payable', '2140', 'tax'),
  a('2150', 'TDS Payable', 'liability', 'tax_payable', '2100', 'tax'),
  a('2160', 'Salaries Payable', 'liability', 'employee_payable', '2100'),
  a('2165', 'Employee Reimbursements Payable', 'liability', 'employee_payable', '2100'),
  a('2170', 'Statutory Dues Payable', 'liability', 'tax_payable', '2100'),
  a('2180', 'Intercompany Payables', 'liability', 'intercompany_payable', '2100', 'intercompany'),
  a('2190', 'Suspense — Needs Classification', 'liability', 'suspense', '2100', 'suspense'),
  a('2195', 'Provisions', 'liability', 'provision', '2100'),
  g('2200', 'Borrowings', 'liability', 'loan', '2000'),
  a('2210', 'Term Loans', 'liability', 'loan', '2200'),
  a('2220', 'Working Capital Facilities', 'liability', 'short_term_borrowing', '2200'),
  a('2230', 'Loans from Directors', 'liability', 'loan', '2200'),
  a('2300', 'Security Deposits Received', 'liability', 'other_liability', '2000'),

  g('3000', 'Equity', 'equity', 'capital'),
  a('3100', 'Share Capital', 'equity', 'capital', '3000'),
  a('3200', 'Reserves & Surplus', 'equity', 'reserves', '3000'),
  a('3300', 'Retained Earnings', 'equity', 'retained_earnings', '3000', 'retained_earnings'),

  g('4000', 'Income', 'income', 'revenue'),
  g('4100', 'Revenue from Operations', 'income', 'revenue', '4000'),
  a('4110', 'Sales — Products', 'income', 'revenue', '4100'),
  a('4120', 'Service Revenue', 'income', 'revenue', '4100'),
  g('4900', 'Other Income', 'income', 'other_income', '4000'),
  a('4910', 'Interest Income', 'income', 'other_income', '4900'),
  a('4920', 'Exchange Gain', 'income', 'other_income', '4900'),
  a('4990', 'Other Non-Operating Income', 'income', 'other_income', '4900'),

  g('5000', 'Cost of Goods Sold', 'expense', 'cogs'),
  a('5010', 'Purchases', 'expense', 'cogs', '5000'),
  a('5020', 'Direct Costs', 'expense', 'cogs', '5000'),
  a('5030', 'Freight Inward', 'expense', 'cogs', '5000'),

  g('6000', 'Operating Expenses', 'expense', 'operating_expense'),
  g('6100', 'Employee Costs', 'expense', 'employee_cost', '6000'),
  a('6110', 'Salaries & Wages', 'expense', 'employee_cost', '6100'),
  a('6120', 'Employer Contributions', 'expense', 'employee_cost', '6100'),
  a('6130', 'Staff Welfare', 'expense', 'employee_cost', '6100'),
  a('6140', 'Bonus & Incentives', 'expense', 'employee_cost', '6100'),
  g('6200', 'Administration', 'expense', 'operating_expense', '6000'),
  a('6210', 'Rent', 'expense', 'operating_expense', '6200'),
  a('6220', 'Electricity', 'expense', 'operating_expense', '6200'),
  a('6225', 'Water & Utilities', 'expense', 'operating_expense', '6200'),
  a('6230', 'Telephone & Internet', 'expense', 'operating_expense', '6200'),
  a('6240', 'Office Supplies', 'expense', 'operating_expense', '6200'),
  a('6245', 'Office Pantry', 'expense', 'operating_expense', '6200'),
  a('6250', 'Printing & Stationery', 'expense', 'operating_expense', '6200'),
  a('6260', 'Courier & Postage', 'expense', 'operating_expense', '6200'),
  a('6270', 'Repairs & Maintenance', 'expense', 'operating_expense', '6200'),
  a('6280', 'Housekeeping & Security', 'expense', 'operating_expense', '6200'),
  a('6290', 'Insurance', 'expense', 'operating_expense', '6200'),
  g('6300', 'Marketing', 'expense', 'operating_expense', '6000'),
  a('6310', 'Digital Advertising', 'expense', 'operating_expense', '6300'),
  a('6320', 'Agency Fees', 'expense', 'operating_expense', '6300'),
  a('6330', 'Events & Sponsorship', 'expense', 'operating_expense', '6300'),
  a('6340', 'Print & Outdoor', 'expense', 'operating_expense', '6300'),
  g('6400', 'Travel & Conveyance', 'expense', 'operating_expense', '6000'),
  a('6410', 'Airfare', 'expense', 'operating_expense', '6400'),
  a('6420', 'Hotel & Accommodation', 'expense', 'operating_expense', '6400'),
  a('6430', 'Local Conveyance', 'expense', 'operating_expense', '6400'),
  a('6440', 'Fuel', 'expense', 'operating_expense', '6400'),
  a('6450', 'Meals', 'expense', 'operating_expense', '6400'),
  a('6460', 'Toll & Parking', 'expense', 'operating_expense', '6400'),
  g('6500', 'Professional Fees', 'expense', 'operating_expense', '6000'),
  a('6510', 'Legal Fees', 'expense', 'operating_expense', '6500'),
  a('6520', 'Audit Fees', 'expense', 'operating_expense', '6500'),
  a('6530', 'Consultancy', 'expense', 'operating_expense', '6500'),
  g('6600', 'Technology', 'expense', 'operating_expense', '6000'),
  a('6610', 'Software & Subscriptions', 'expense', 'operating_expense', '6600'),
  a('6620', 'Cloud Infrastructure', 'expense', 'operating_expense', '6600'),
  a('6700', 'Vehicle Running & Maintenance', 'expense', 'operating_expense', '6000'),
  a('6800', 'Commission & Brokerage', 'expense', 'operating_expense', '6000'),
  a('6850', 'Client Entertainment', 'expense', 'operating_expense', '6000'),
  a('6900', 'Bank Charges', 'expense', 'operating_expense', '6000'),
  a('6950', 'Fines & Penalties', 'expense', 'operating_expense', '6000'),
  g('7000', 'Finance Costs', 'expense', 'finance_cost'),
  a('7010', 'Interest on Borrowings', 'expense', 'finance_cost', '7000'),
  a('7020', 'Exchange Difference', 'expense', 'finance_cost', '7000'),
  a('7100', 'Depreciation & Amortisation', 'expense', 'depreciation', ''),
  a('7200', 'Income Tax Expense', 'expense', 'tax_expense', ''),
  g('7300', 'Exceptional Items', 'expense', 'exceptional'),
  a('7310', 'Write-offs', 'expense', 'exceptional', '7300'),
  a('7320', 'Losses & Incidents', 'expense', 'exceptional', '7300'),
].map((x) => (x.parent_code === '' ? { ...x, parent_code: undefined } : x))

export const BASE_ACCOUNT_MAP: Record<string, string> = {
  ar_control: '1130',
  ap_control: '2110',
  customer_advances: '2130',
  vendor_advances: '1150',
  fx_gain_loss: '7020',
  retained_earnings: '3300',
  suspense: '2190',
  intercompany_receivable: '1190',
  intercompany_payable: '2180',
}

export const INDIA_GST_CODES: CompanyCreatePayload['tax_codes'] = [5, 12, 18, 28].flatMap((r) => [
  {
    code: `GST${r}`,
    name: `GST ${r}% (intra-state)`,
    kind: 'gst',
    components: [
      { component: 'CGST', rate: r / 2, output_code: '2141', input_code: '1181' },
      { component: 'SGST', rate: r / 2, output_code: '2142', input_code: '1182' },
    ],
  },
  {
    code: `IGST${r}`,
    name: `IGST ${r}% (inter-state)`,
    kind: 'gst',
    components: [{ component: 'IGST', rate: r, output_code: '2143', input_code: '1183' }],
  },
])

export interface CompanyTemplate {
  key: string
  name: string
  description: string
  modules: Record<string, boolean>
  extra: A[]
  orgUnits: { type_key: string; code: string; name: string }[]
}

const common = [
  { type_key: 'department', code: 'FIN', name: 'Finance' },
  { type_key: 'department', code: 'ADM', name: 'Administration' },
  { type_key: 'department', code: 'MKT', name: 'Marketing' },
  { type_key: 'office', code: 'HO', name: 'Head Office' },
]

export const COMPANY_TEMPLATES: CompanyTemplate[] = [
  {
    key: 'holding', name: 'Holding / Investment Company',
    description: 'Group holding entity: investments in subsidiaries, management fees, dividends, intercompany funding.',
    modules: { investments: true, intercompany: true, fixed_assets: true },
    extra: [
      a('1220', 'Investments in Group Companies', 'asset', 'investment', '1200'),
      a('4160', 'Management Fees', 'income', 'revenue', '4100'),
      a('4950', 'Dividend Income', 'income', 'other_income', '4900'),
    ],
    orgUnits: common,
  },
  {
    key: 'aif', name: 'Investment / AIF',
    description: 'Fund structures: unit capital, portfolio investments, management fees, realised and unrealised gains. SEBI/AIF reporting must be validated by qualified professionals.',
    modules: { investments: true, fund_accounting: true },
    extra: [
      a('1220', 'Portfolio Investments', 'asset', 'investment', '1200'),
      a('3110', 'Unit Capital', 'equity', 'capital', '3000'),
      a('4160', 'Management Fees', 'income', 'revenue', '4100'),
      a('4930', 'Realised Gains on Investments', 'income', 'other_income', '4900'),
      a('4940', 'Unrealised Gains on Investments', 'income', 'other_income', '4900'),
      a('4950', 'Dividend Income', 'income', 'other_income', '4900'),
      a('7330', 'Realised Losses on Investments', 'expense', 'exceptional', '7300'),
    ],
    orgUnits: [...common, { type_key: 'fund', code: 'FUND1', name: 'Fund I' }],
  },
  {
    key: 'real_estate', name: 'Real Estate / Property Development',
    description: 'Land bank, project work-in-progress, property sales, rental income, broker commissions. Each project can act as a cost and profit centre.',
    modules: { projects: true, property: true, brokerage: true, fixed_assets: true },
    extra: [
      a('1141', 'Land Bank', 'asset', 'inventory', '1100'),
      a('1142', 'Project Work-in-Progress', 'asset', 'inventory', '1100'),
      a('4130', 'Property Sales', 'income', 'revenue', '4100'),
      a('4140', 'Rental Income', 'income', 'revenue', '4100'),
      a('5040', 'Land Acquisition Cost', 'expense', 'cogs', '5000'),
      a('5050', 'Development Cost', 'expense', 'cogs', '5000'),
      a('5060', 'Approval & Legal Cost', 'expense', 'cogs', '5000'),
    ],
    orgUnits: [...common, { type_key: 'project', code: 'PRJ-MONARCH', name: 'Project Monarch' }],
  },
  {
    key: 'construction', name: 'Construction',
    description: 'BOQ-driven projects: contract revenue, materials, labour and subcontract, retention, mobilisation advances.',
    modules: { projects: true, construction: true, inventory: true, fixed_assets: true },
    extra: [
      a('1135', 'Retention Receivable', 'asset', 'receivable', '1100'),
      a('1143', 'Construction Work-in-Progress', 'asset', 'inventory', '1100'),
      a('1156', 'Mobilisation Advances Paid', 'asset', 'advance', '1100'),
      a('2115', 'Retention Payable', 'liability', 'payable', '2100'),
      a('4150', 'Contract Revenue', 'income', 'revenue', '4100'),
      a('5070', 'Construction Materials', 'expense', 'cogs', '5000'),
      a('5080', 'Labour & Subcontract', 'expense', 'cogs', '5000'),
      a('5090', 'Equipment Hire', 'expense', 'cogs', '5000'),
    ],
    orgUnits: [...common, { type_key: 'property', code: 'SITE-01', name: 'Site 01' }],
  },
  {
    key: 'import_export', name: 'Import / Export',
    description: 'Goods in transit, customs duty, freight and insurance, clearing charges and landed cost, multi-currency settlement.',
    modules: { inventory: true, import_export: true, multi_currency: true },
    extra: [
      a('1144', 'Goods in Transit', 'asset', 'inventory', '1100'),
      a('5100', 'Customs Duty', 'expense', 'cogs', '5000'),
      a('5110', 'Freight & Marine Insurance', 'expense', 'cogs', '5000'),
      a('5120', 'Clearing & Port Charges', 'expense', 'cogs', '5000'),
    ],
    orgUnits: [...common, { type_key: 'warehouse', code: 'WH-01', name: 'Main Warehouse' }],
  },
  {
    key: 'medical_equipment', name: 'Medical Equipment',
    description: 'Equipment sales, installation, AMC and service revenue, warranty provisions, import landed cost.',
    modules: { inventory: true, import_export: true, healthcare: true, fixed_assets: true },
    extra: [
      a('1144', 'Goods in Transit', 'asset', 'inventory', '1100'),
      a('2196', 'Warranty Provision', 'liability', 'provision', '2100'),
      a('4170', 'Equipment Sales', 'income', 'revenue', '4100'),
      a('4180', 'AMC & Service Revenue', 'income', 'revenue', '4100'),
      a('5100', 'Customs Duty', 'expense', 'cogs', '5000'),
      a('5130', 'Installation Cost', 'expense', 'cogs', '5000'),
    ],
    orgUnits: [...common, { type_key: 'warehouse', code: 'WH-01', name: 'Main Warehouse' }],
  },
  {
    key: 'wellness', name: 'Wellness / Healthcare Products',
    description: 'Batch and expiry-aware product trading. Does not replace regulated pharmaceutical compliance systems.',
    modules: { inventory: true, healthcare: true },
    extra: [a('7315', 'Expired / Damaged Stock', 'expense', 'exceptional', '7300')],
    orgUnits: [...common, { type_key: 'store', code: 'ST-01', name: 'Store 01' }],
  },
  {
    key: 'trading', name: 'Trading / Distribution',
    description: 'Purchase and resale of goods with inventory, receivables and payables.',
    modules: { inventory: true },
    extra: [],
    orgUnits: [...common, { type_key: 'warehouse', code: 'WH-01', name: 'Main Warehouse' }],
  },
  {
    key: 'services', name: 'Services / Consulting',
    description: 'Service revenue, retainers, milestone billing and project costing.',
    modules: { projects: true },
    extra: [],
    orgUnits: common,
  },
  {
    key: 'technology', name: 'Technology / Software',
    description: 'Subscription and service revenue, cloud infrastructure, software costs.',
    modules: { projects: true, subscriptions: true },
    extra: [a('4125', 'Subscription Revenue', 'income', 'revenue', '4100')],
    orgUnits: [...common, { type_key: 'department', code: 'ENG', name: 'Engineering' }],
  },
  {
    key: 'brokerage', name: 'Brokerage / Financial Services',
    description: 'Brokerage and commission income, sub-broker payouts, referral fees.',
    modules: { brokerage: true },
    extra: [
      a('4190', 'Brokerage Income', 'income', 'revenue', '4100'),
      a('6810', 'Sub-broker Commission', 'expense', 'operating_expense', '6000'),
    ],
    orgUnits: common,
  },
  {
    key: 'custom', name: 'Custom Company',
    description: 'Start from the standard chart of accounts and shape everything yourself.',
    modules: {},
    extra: [],
    orgUnits: common,
  },
]

export function buildCompanyPayload(
  company: CompanyCreatePayload['company'],
  templateKey: string,
  opts: { includeGst?: boolean; accounts?: A[] } = {},
): CompanyCreatePayload {
  const t = COMPANY_TEMPLATES.find((x) => x.key === templateKey) ?? COMPANY_TEMPLATES[COMPANY_TEMPLATES.length - 1]
  const accounts = opts.accounts ?? chartFor(templateKey)
  return {
    company: { ...company, template_key: t.key, modules: { ...t.modules, ...(company.modules ?? {}) } },
    accounts,
    account_map: BASE_ACCOUNT_MAP,
    tax_codes: opts.includeGst === false ? [] : INDIA_GST_CODES,
    org_units: t.orgUnits,
  }
}

export function chartFor(templateKey: string): A[] {
  const t = COMPANY_TEMPLATES.find((x) => x.key === templateKey)
  const seen = new Set<string>()
  return [...BASE_CHART, ...(t?.extra ?? [])]
    .filter((x) => (seen.has(x.code) ? false : (seen.add(x.code), true)))
    .sort((x, y) => x.code.localeCompare(y.code))
}

/** Recommends a template from free-text business description. A recommendation only. */
export function recommendTemplate(text: string): string {
  const t = text.toLowerCase()
  const rules: [RegExp, string][] = [
    [/aif|fund|venture|portfolio|scheme/, 'aif'],
    [/holding|group company|parent/, 'holding'],
    [/real estate|property|plot|layout|villa|apartment|land/, 'real_estate'],
    [/construct|contractor|boq|civil/, 'construction'],
    [/medical (machinery|equipment)|equipment/, 'medical_equipment'],
    [/import|export|customs|shipment/, 'import_export'],
    [/wellness|medicine|pharma|healthcare product/, 'wellness'],
    [/broker|commission|financial service/, 'brokerage'],
    [/software|saas|technology|tech/, 'technology'],
    [/consult|service|agency/, 'services'],
    [/trading|wholesale|retail|distribution/, 'trading'],
  ]
  return rules.find(([re]) => re.test(t))?.[1] ?? 'custom'
}
