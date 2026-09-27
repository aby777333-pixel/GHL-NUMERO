import { useState, type ReactNode } from 'react'
import Decimal from 'decimal.js'
import {
  ArrowLeftRight, BadgePercent, ChevronDown, ChevronRight, Coins, Landmark, PiggyBank, Plus, Receipt, Scale, Target, Trash2, TrendingDown, TrendingUp,
} from 'lucide-react'
import { parseAmount, ZERO } from '@/lib/money'
import { cx, Field, Money, Note, PageHeader, Panel } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

// Every calculator is arithmetic on what the user typed. Nothing here reads the books.

const HUNDRED = new Decimal(100)
const r2 = (v: Decimal) => v.toDecimalPlaces(2)
const amt = (s: string): Decimal | null => (s.trim() ? parseAmount(s) : null)
const num = (s: string): Decimal | null => {
  const t = s.trim().replace(/,/g, '').replace(/%$/, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return new Decimal(t)
}
const whole = (s: string): number | null => {
  const t = s.trim()
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}
const pct = (v: Decimal, dp = 2) => (v.isNegative() ? '−' : '') + v.abs().toFixed(dp) + '%'
const plain = (v: Decimal, dp = 2) => v.toDecimalPlaces(dp).toString()

interface EvidenceInput { label: string; value: ReactNode }

function Card({ title, icon, children, wide }: { title: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <Panel className={cx('p-5', wide && 'xl:col-span-2')} lit={false}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-gold/30 bg-goldsoft text-gold">{icon}</span><span className="display truncate text-[15px] font-medium">{title}</span></div>
        <span className="chip" title="Arithmetic on the numbers you entered. Not a figure from the books.">CALCULATION</span>
      </div>
      {children}
    </Panel>
  )
}

function AmountField({ label, value, onChange, placeholder, currency }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; currency?: string }) {
  const p = amt(value)
  return (
    <Field label={label}>
      <input className="field num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'e.g. 4.8 lakh'} />
      {value.trim() !== '' && (p ? <span className="mt-1 block text-[11.5px] text-muted">= <Money value={p} currency={currency} /></span> : <span className="mt-1 block text-[11.5px] text-neg">This is not an amount</span>)}
    </Field>
  )
}

function NumField({ label, value, onChange, placeholder, hint, integer }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; integer?: boolean }) {
  const bad = value.trim() !== '' && (integer ? whole(value) === null : num(value) === null)
  return (
    <Field label={label} hint={bad ? undefined : hint}>
      <input className="field num" inputMode={integer ? 'numeric' : 'decimal'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {bad && <span className="mt-1 block text-[11.5px] text-neg">{integer ? 'Enter a whole number' : 'Enter a number'}</span>}
    </Field>
  )
}

function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="flex flex-wrap items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label={label} style={{ width: 'fit-content' }}>
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} className={cx('h-[28px] rounded-lg px-3 text-[11.5px] font-medium transition-colors', value === k ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{l}</button>
      ))}
    </div>
  )
}

function Results({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-xl border border-line bg-surface">{children}</div>
}
function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-[13px] last:border-0">
      <span className={strong ? 'text-ink' : 'text-ink2'}>{label}</span>
      <span className={cx('num text-right', strong ? 'text-[15px] text-gold' : 'text-ink')}>{children}</span>
    </div>
  )
}
const Waiting = ({ text = 'Enter the figures above to see the result.' }: { text?: string }) => <div className="mt-4 rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] text-muted">{text}</div>

/** Calculation evidence: the formula and every input that produced the result. */
function Evidence({ formula, inputs }: { formula: string; inputs: EvidenceInput[] }) {
  return (
    <details className="mt-3 rounded-xl border border-line px-3.5 py-2.5 text-[12.5px]">
      <summary className="cursor-pointer select-none text-muted">Calculation evidence</summary>
      <div className="mt-2.5">
        <div className="eyebrow mb-1.5">Formula</div>
        <div className="num whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-gold">{formula}</div>
        <div className="eyebrow mb-1.5 mt-3">Inputs as entered</div>
        <div className="rounded-lg border border-line">
          {inputs.map((i) => (
            <div key={i.label} className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5 last:border-0">
              <span className="text-ink2">{i.label}</span><span className="num text-ink">{i.value}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

export default function Calculators() {
  return (
    <div>
      <PageHeader eyebrow="Tools" title="Calculator Centre" subtitle="Ten calculators with exact decimal arithmetic. Each result shows the formula and the inputs behind it." />
      <Note className="mb-5">
        Results here are arithmetic on the numbers you enter. They are not figures from the books, they are not posted anywhere, and they are not tax or financial advice. Amounts accept Indian shorthand such as “4.8 lakh” or “2 cr”.
      </Note>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <GstCalc />
        <TdsCalc />
        <EmiCalc />
        <InterestCalc />
        <DepreciationCalc />
        <BreakEvenCalc />
        <MarginCalc />
        <CommissionCalc />
        <CurrencyCalc />
        <GrowthCalc />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 1. GST
function GstCalc() {
  const [a, setA] = useState('')
  const [rate, setRate] = useState('18')
  const [mode, setMode] = useState<'add' | 'extract'>('add')
  const [supply, setSupply] = useState<'intra' | 'inter'>('intra')
  const amount = amt(a), r = num(rate)
  const ok = amount !== null && r !== null
  const base = ok ? (mode === 'add' ? amount : r2(amount.div(new Decimal(1).plus(r.div(HUNDRED))))) : ZERO
  const tax = ok ? (mode === 'add' ? r2(amount.times(r).div(HUNDRED)) : amount.minus(base)) : ZERO
  const total = base.plus(tax)
  const cgst = r2(tax.div(2)), sgst = tax.minus(cgst)
  return (
    <Card title="GST / tax" icon={<Receipt size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <AmountField label={mode === 'add' ? 'Amount before tax' : 'Amount including tax'} value={a} onChange={setA} />
        <NumField label="Tax rate %" value={rate} onChange={setRate} placeholder="18" />
      </div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        <Choice label="Mode" value={mode} onChange={setMode} options={[['add', 'Add tax to amount'], ['extract', 'Extract tax from inclusive amount']]} />
        <Choice label="Supply" value={supply} onChange={setSupply} options={[['intra', 'Intra-state (CGST + SGST)'], ['inter', 'Inter-state (IGST)']]} />
      </div>
      {ok ? (
        <>
          <Results>
            <Row label="Taxable value"><Money value={base} /></Row>
            {supply === 'intra' ? (
              <>
                <Row label={`CGST @ ${plain(r.div(2), 3)}%`}><Money value={cgst} /></Row>
                <Row label={`SGST @ ${plain(r.div(2), 3)}%`}><Money value={sgst} /></Row>
              </>
            ) : <Row label={`IGST @ ${plain(r, 3)}%`}><Money value={tax} /></Row>}
            <Row label="Total tax"><Money value={tax} /></Row>
            <Row label="Total including tax" strong><Money value={total} /></Row>
          </Results>
          <Evidence
            formula={mode === 'add' ? 'Tax = Amount × Rate ÷ 100\nTotal = Amount + Tax' : 'Taxable value = Inclusive amount ÷ (1 + Rate ÷ 100)\nTax = Inclusive amount − Taxable value'}
            inputs={[{ label: mode === 'add' ? 'Amount before tax' : 'Amount including tax', value: <Money value={amount} /> }, { label: 'Rate', value: plain(r, 3) + '%' }, { label: 'Split', value: supply === 'intra' ? 'CGST and SGST, half each' : 'IGST, whole' }, { label: 'Rounding', value: '2 decimals, half up' }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 2. TDS
function TdsCalc() {
  const [a, setA] = useState('')
  const [rate, setRate] = useState('')
  const amount = amt(a), r = num(rate)
  const ok = amount !== null && r !== null
  const tds = ok ? r2(amount.times(r).div(HUNDRED)) : ZERO
  return (
    <Card title="TDS" icon={<BadgePercent size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <AmountField label="Amount on which tax is deducted" value={a} onChange={setA} />
        <NumField label="TDS rate %" value={rate} onChange={setRate} placeholder="e.g. 10" hint="Enter the rate that applies; this calculator does not decide it" />
      </div>
      {ok ? (
        <>
          <Results>
            <Row label="Gross amount"><Money value={amount} /></Row>
            <Row label={`TDS @ ${plain(r, 3)}%`}><Money value={tds} /></Row>
            <Row label="Net payable" strong><Money value={amount.minus(tds)} /></Row>
          </Results>
          <Evidence formula={'TDS = Amount × Rate ÷ 100\nNet payable = Amount − TDS'} inputs={[{ label: 'Amount', value: <Money value={amount} /> }, { label: 'Rate', value: plain(r, 3) + '%' }, { label: 'Rounding', value: '2 decimals, half up' }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 3. EMI
interface EmiRow { month: number; opening: Decimal; interest: Decimal; principal: Decimal; payment: Decimal; closing: Decimal }
const MAX_MONTHS = 600

function EmiCalc() {
  const [p, setP] = useState('')
  const [rate, setRate] = useState('')
  const [months, setMonths] = useState('')
  const [open, setOpen] = useState(false)
  const principal = amt(p), annual = num(rate), n = whole(months)
  const ok = principal !== null && principal.gt(0) && annual !== null && n !== null && n > 0 && n <= MAX_MONTHS

  let emi = ZERO, totalInterest = ZERO, totalPayment = ZERO
  const rows: EmiRow[] = []
  if (ok) {
    const r = annual.div(12).div(HUNDRED)
    if (r.isZero()) emi = r2(principal.div(n))
    else { const f = new Decimal(1).plus(r).pow(n); emi = r2(principal.times(r).times(f).div(f.minus(1))) }
    let opening = principal
    for (let m = 1; m <= n; m++) {
      const interest = r2(opening.times(r))
      // the final instalment clears whatever balance rounding has left
      const princ = m === n ? opening : Decimal.min(opening, emi.minus(interest))
      const payment = princ.plus(interest)
      const closing = opening.minus(princ)
      rows.push({ month: m, opening, interest, principal: princ, payment, closing })
      totalInterest = totalInterest.plus(interest)
      totalPayment = totalPayment.plus(payment)
      opening = closing
    }
  }
  const last = rows[rows.length - 1]
  const cols: Column<EmiRow>[] = [
    { key: 'month', header: 'Month', render: (x) => <span className="num">{x.month}</span>, sort: (x) => x.month, csv: (x) => x.month },
    { key: 'opening', header: 'Opening', align: 'right', render: (x) => <Money value={x.opening} />, csv: (x) => x.opening.toFixed(2) },
    { key: 'interest', header: 'Interest', align: 'right', render: (x) => <Money value={x.interest} />, csv: (x) => x.interest.toFixed(2) },
    { key: 'principal', header: 'Principal', align: 'right', render: (x) => <Money value={x.principal} />, csv: (x) => x.principal.toFixed(2) },
    { key: 'payment', header: 'Instalment', align: 'right', render: (x) => <Money value={x.payment} />, csv: (x) => x.payment.toFixed(2) },
    { key: 'closing', header: 'Closing', align: 'right', render: (x) => <Money value={x.closing} />, csv: (x) => x.closing.toFixed(2) },
  ]
  return (
    <Card title="EMI — reducing balance" icon={<Landmark size={16} />} wide>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <AmountField label="Principal" value={p} onChange={setP} placeholder="e.g. 25 lakh" />
        <NumField label="Annual interest rate %" value={rate} onChange={setRate} placeholder="e.g. 9.5" />
        <NumField label="Tenure in months" value={months} onChange={setMonths} placeholder="e.g. 60" integer hint={`Up to ${MAX_MONTHS} months`} />
      </div>
      {n !== null && n > MAX_MONTHS && <div className="mt-2 text-[12px] text-neg">The tenure cannot exceed {MAX_MONTHS} months.</div>}
      {ok ? (
        <>
          <Results>
            <Row label="Monthly instalment (EMI)" strong><Money value={emi} /></Row>
            <Row label="Total interest"><Money value={totalInterest} /></Row>
            <Row label="Total payment"><Money value={totalPayment} /></Row>
            {last && !last.payment.eq(emi) && <Row label={`Final instalment (month ${last.month})`}><Money value={last.payment} /></Row>}
          </Results>
          <Evidence
            formula={annual.isZero() ? 'EMI = P ÷ n   (interest rate is zero)' : 'EMI = P × r × (1 + r)^n ÷ ((1 + r)^n − 1)\nr = Annual rate ÷ 12 ÷ 100\nInterest for a month = Opening balance × r'}
            inputs={[{ label: 'P — principal', value: <Money value={principal} /> }, { label: 'Annual rate', value: plain(annual, 4) + '%' }, { label: 'r — monthly rate', value: plain(annual.div(12).div(HUNDRED), 10) }, { label: 'n — months', value: String(n) }, { label: 'Rounding', value: 'Each instalment and interest amount to 2 decimals; the final instalment clears the balance' }]} />
          <button className="btn sm ghost mt-3" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Amortisation table · {rows.length} month{rows.length === 1 ? '' : 's'}</button>
          {open && (
            <div className="mt-2 overflow-hidden rounded-xl border border-line">
              <DataTable columns={cols} rows={rows} rowKey={(x) => String(x.month)} pageSize={24} exportName="emi-amortisation" maxHeight={420} />
            </div>
          )}
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 4. interest
function InterestCalc() {
  const [p, setP] = useState('')
  const [rate, setRate] = useState('')
  const [years, setYears] = useState('')
  const [freq, setFreq] = useState('12')
  const principal = amt(p), r = num(rate), t = num(years)
  const m = new Decimal(freq)
  const ok = principal !== null && r !== null && t !== null && t.lte(100)
  const simple = ok ? r2(principal.times(r).times(t).div(HUNDRED)) : ZERO
  const maturity = ok ? r2(principal.times(new Decimal(1).plus(r.div(HUNDRED).div(m)).pow(m.times(t)))) : ZERO
  const compound = maturity.minus(principal ?? ZERO)
  const names: Record<string, string> = { '1': 'Yearly', '2': 'Half-yearly', '4': 'Quarterly', '12': 'Monthly', '365': 'Daily' }
  return (
    <Card title="Simple & compound interest" icon={<PiggyBank size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <AmountField label="Principal" value={p} onChange={setP} />
        <NumField label="Annual rate %" value={rate} onChange={setRate} placeholder="e.g. 7.25" />
        <NumField label="Years" value={years} onChange={setYears} placeholder="e.g. 3 or 2.5" hint="Up to 100 years" />
        <Field label="Compounding frequency"><select className="field" value={freq} onChange={(e) => setFreq(e.target.value)}>{Object.entries(names).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      {t !== null && t.gt(100) && <div className="mt-2 text-[12px] text-neg">The period cannot exceed 100 years.</div>}
      {ok ? (
        <>
          <Results>
            <Row label="Simple interest"><Money value={simple} /></Row>
            <Row label="Amount with simple interest"><Money value={principal.plus(simple)} /></Row>
            <Row label={`Compound interest (${names[freq].toLowerCase()})`}><Money value={compound} /></Row>
            <Row label="Amount with compound interest" strong><Money value={maturity} /></Row>
          </Results>
          <Evidence formula={'Simple interest = P × R × T ÷ 100\nCompound amount = P × (1 + R ÷ 100 ÷ m)^(m × T)\nCompound interest = Compound amount − P'}
            inputs={[{ label: 'P — principal', value: <Money value={principal} /> }, { label: 'R — annual rate', value: plain(r, 4) + '%' }, { label: 'T — years', value: plain(t, 4) }, { label: 'm — compounding periods a year', value: freq }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 5. depreciation
interface DepRow { year: number; opening: Decimal; charge: Decimal; closing: Decimal }

function DepreciationCalc() {
  const [c, setC] = useState('')
  const [res, setRes] = useState('')
  const [life, setLife] = useState('')
  const [method, setMethod] = useState<'sl' | 'wdv'>('sl')
  const [rate, setRate] = useState('')
  const cost = amt(c), residual = res.trim() ? amt(res) : ZERO, years = whole(life), r = num(rate)
  const ok = cost !== null && residual !== null && years !== null && years > 0 && years <= 100 && residual.lte(cost) && (method === 'sl' || (r !== null && r.lte(100)))

  const rows: DepRow[] = []
  if (ok) {
    let opening = cost
    const annual = r2(cost.minus(residual).div(years))
    for (let y = 1; y <= years; y++) {
      const room = opening.minus(residual)
      let charge = method === 'sl' ? (y === years ? room : annual) : r2(opening.times(r ?? ZERO).div(HUNDRED))
      charge = Decimal.max(ZERO, Decimal.min(charge, room))
      rows.push({ year: y, opening, charge, closing: opening.minus(charge) })
      opening = opening.minus(charge)
    }
  }
  const total = rows.reduce((s, x) => s.plus(x.charge), ZERO)
  const cols: Column<DepRow>[] = [
    { key: 'year', header: 'Year', render: (x) => <span className="num">{x.year}</span>, csv: (x) => x.year },
    { key: 'opening', header: 'Opening value', align: 'right', render: (x) => <Money value={x.opening} />, csv: (x) => x.opening.toFixed(2) },
    { key: 'charge', header: 'Depreciation', align: 'right', render: (x) => <Money value={x.charge} />, csv: (x) => x.charge.toFixed(2) },
    { key: 'closing', header: 'Closing value', align: 'right', render: (x) => <Money value={x.closing} />, csv: (x) => x.closing.toFixed(2) },
  ]
  return (
    <Card title="Depreciation" icon={<TrendingDown size={16} />}>
      <div className="mb-3.5"><Choice label="Method" value={method} onChange={setMethod} options={[['sl', 'Straight-line'], ['wdv', 'Written-down value']]} /></div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <AmountField label="Cost" value={c} onChange={setC} />
        <AmountField label="Residual value (optional)" value={res} onChange={setRes} placeholder="0" />
        <NumField label="Useful life in years" value={life} onChange={setLife} placeholder="e.g. 5" integer hint="Up to 100 years" />
        {method === 'wdv' && <NumField label="Rate % on written-down value" value={rate} onChange={setRate} placeholder="e.g. 15" />}
      </div>
      {cost !== null && residual !== null && residual.gt(cost) && <div className="mt-2 text-[12px] text-neg">The residual value cannot be more than the cost.</div>}
      {ok ? (
        <>
          <Results>
            <Row label="Total depreciation over the schedule"><Money value={total} /></Row>
            <Row label={`Value after ${years} year${years === 1 ? '' : 's'}`} strong><Money value={cost.minus(total)} /></Row>
          </Results>
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <DataTable columns={cols} rows={rows} rowKey={(x) => String(x.year)} pageSize={25} exportName="depreciation-schedule" maxHeight={340} />
          </div>
          <Evidence
            formula={method === 'sl' ? 'Yearly depreciation = (Cost − Residual value) ÷ Useful life' : 'Depreciation for a year = Opening written-down value × Rate ÷ 100\nThe value is never taken below the residual value'}
            inputs={[{ label: 'Cost', value: <Money value={cost} /> }, { label: 'Residual value', value: <Money value={residual} /> }, { label: 'Useful life', value: `${years} year${years === 1 ? '' : 's'}` }, ...(method === 'wdv' && r ? [{ label: 'Rate', value: plain(r, 4) + '%' }] : []), { label: 'Rounding', value: '2 decimals, half up; the last straight-line year absorbs the rounding difference' }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 6. break-even
function BreakEvenCalc() {
  const [f, setF] = useState('')
  const [p, setP] = useState('')
  const [v, setV] = useState('')
  const fixed = amt(f), price = amt(p), variable = amt(v)
  const ok = fixed !== null && price !== null && variable !== null && price.gt(0)
  const cm = ok ? price.minus(variable) : ZERO
  const possible = ok && cm.gt(0)
  const units = possible ? fixed.div(cm) : ZERO
  return (
    <Card title="Break-even" icon={<Target size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <AmountField label="Fixed costs" value={f} onChange={setF} />
        <AmountField label="Price per unit" value={p} onChange={setP} placeholder="e.g. 1200" />
        <AmountField label="Variable cost per unit" value={v} onChange={setV} placeholder="e.g. 700" />
      </div>
      {ok ? (
        <>
          {possible ? (
            <Results>
              <Row label="Contribution margin per unit"><Money value={cm} /></Row>
              <Row label="Contribution margin ratio">{pct(cm.div(price).times(100))}</Row>
              <Row label="Break-even units" strong>{plain(units, 2)}</Row>
              <Row label="Whole units needed to cover fixed costs">{units.ceil().toString()}</Row>
              <Row label="Break-even revenue"><Money value={r2(units.times(price))} /></Row>
            </Results>
          ) : <Waiting text="There is no break-even point: the price per unit does not exceed the variable cost per unit, so each sale adds nothing towards fixed costs." />}
          <Evidence formula={'Contribution margin = Price − Variable cost\nBreak-even units = Fixed costs ÷ Contribution margin\nBreak-even revenue = Break-even units × Price'}
            inputs={[{ label: 'Fixed costs', value: <Money value={fixed} /> }, { label: 'Price per unit', value: <Money value={price} /> }, { label: 'Variable cost per unit', value: <Money value={variable} /> }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 7. margin & markup
function MarginCalc() {
  const [c, setC] = useState('')
  const [s, setS] = useState('')
  const cost = amt(c), price = amt(s)
  const ok = cost !== null && price !== null
  const profit = ok ? price.minus(cost) : ZERO
  return (
    <Card title="Margin & markup" icon={<Scale size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <AmountField label="Cost" value={c} onChange={setC} />
        <AmountField label="Selling price" value={s} onChange={setS} />
      </div>
      {ok ? (
        <>
          <Results>
            <Row label={profit.lt(0) ? 'Loss' : 'Profit'}><Money value={profit} colored /></Row>
            <Row label="Margin % (on selling price)" strong>{price.isZero() ? 'not defined — selling price is zero' : pct(profit.div(price).times(100))}</Row>
            <Row label="Markup % (on cost)" strong>{cost.isZero() ? 'not defined — cost is zero' : pct(profit.div(cost).times(100))}</Row>
          </Results>
          <Evidence formula={'Profit = Selling price − Cost\nMargin % = Profit ÷ Selling price × 100\nMarkup % = Profit ÷ Cost × 100'} inputs={[{ label: 'Cost', value: <Money value={cost} /> }, { label: 'Selling price', value: <Money value={price} /> }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 8. commission
interface Slab { from: string; to: string; rate: string }
interface Share { name: string; pct: string }

function CommissionCalc() {
  const [s, setS] = useState('')
  const [slabs, setSlabs] = useState<Slab[]>([{ from: '0', to: '', rate: '' }])
  const [shares, setShares] = useState<Share[]>([{ name: '', pct: '100' }])
  const sale = amt(s)
  const setSlab = (i: number, patch: Partial<Slab>) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setShare = (i: number, patch: Partial<Share>) => setShares(shares.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const parsed = slabs.map((x) => ({ from: x.from.trim() ? amt(x.from) : ZERO, to: x.to.trim() ? amt(x.to) : null, open: !x.to.trim(), rate: num(x.rate) }))
  const slabsOk = parsed.every((x) => x.from !== null && x.rate !== null && (x.open || (x.to !== null && x.to.gt(x.from))))
  const ok = sale !== null && slabsOk
  const lines = ok ? parsed.map((x) => {
    const from = x.from ?? ZERO
    const upper = x.open || x.to === null ? sale : Decimal.min(sale, x.to)
    const band = Decimal.max(ZERO, upper.minus(from))
    return { from, to: x.open ? null : x.to, rate: x.rate ?? ZERO, band, commission: r2(band.times(x.rate ?? ZERO).div(HUNDRED)) }
  }) : []
  const total = lines.reduce((t, l) => t.plus(l.commission), ZERO)
  const covered = lines.reduce((t, l) => t.plus(l.band), ZERO)
  const sharePcts = shares.map((x) => num(x.pct))
  const sharesOk = sharePcts.every((x) => x !== null)
  const shareTotal = sharePcts.reduce<Decimal>((t, x) => t.plus(x ?? ZERO), ZERO)

  return (
    <Card title="Commission — slabs and split" icon={<Coins size={16} />} wide>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <AmountField label="Sale value" value={s} onChange={setS} />
          <div className="eyebrow mb-2 mt-4">Slabs (up to 5)</div>
          <div className="space-y-2">
            {slabs.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_30px] items-center gap-2">
                <input className="field sm num" aria-label={`Slab ${i + 1} from`} value={x.from} onChange={(e) => setSlab(i, { from: e.target.value })} placeholder="From" />
                <input className="field sm num" aria-label={`Slab ${i + 1} to`} value={x.to} onChange={(e) => setSlab(i, { to: e.target.value })} placeholder="To (empty = no limit)" />
                <input className="field sm num" aria-label={`Slab ${i + 1} rate percent`} value={x.rate} onChange={(e) => setSlab(i, { rate: e.target.value })} placeholder="Rate %" />
                <button className="btn sm icon ghost" aria-label="Remove slab" disabled={slabs.length === 1} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <button className="btn sm ghost mt-2" disabled={slabs.length >= 5} onClick={() => setSlabs([...slabs, { from: slabs[slabs.length - 1].to, to: '', rate: '' }])}><Plus size={13} /> Add slab</button>
          {!slabsOk && slabs.some((x) => x.rate.trim() !== '') && <div className="mt-2 text-[12px] text-neg">Each slab needs a rate, and its upper limit must be greater than its lower limit.</div>}
        </div>
        <div>
          <div className="eyebrow mb-2">Split among recipients (up to 5)</div>
          <div className="space-y-2">
            {shares.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_30px] items-center gap-2">
                <input className="field sm" aria-label={`Recipient ${i + 1} name`} value={x.name} onChange={(e) => setShare(i, { name: e.target.value })} placeholder={`Recipient ${i + 1}`} />
                <input className="field sm num" aria-label={`Recipient ${i + 1} share percent`} value={x.pct} onChange={(e) => setShare(i, { pct: e.target.value })} placeholder="Share %" />
                <button className="btn sm icon ghost" aria-label="Remove recipient" disabled={shares.length === 1} onClick={() => setShares(shares.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <button className="btn sm ghost mt-2" disabled={shares.length >= 5} onClick={() => setShares([...shares, { name: '', pct: '' }])}><Plus size={13} /> Add recipient</button>
          {sharesOk && !shareTotal.eq(100) && <div className="mt-2 text-[12px] text-warn">The shares add up to {plain(shareTotal, 4)}%, not 100%. {shareTotal.lt(100) ? 'Part of the commission is not allocated.' : 'More than the commission is allocated.'}</div>}
        </div>
      </div>
      {ok ? (
        <>
          <Results>
            {lines.map((l, i) => (
              <Row key={i} label={`Slab ${i + 1} · ${l.from.toString()} to ${l.to ? l.to.toString() : 'no limit'} @ ${plain(l.rate, 4)}%`}>
                <span className="text-muted">on </span><Money value={l.band} /> <span className="text-muted">=</span> <Money value={l.commission} />
              </Row>
            ))}
            <Row label="Total commission" strong><Money value={total} /></Row>
            {sharesOk && shares.map((x, i) => (
              <Row key={'s' + i} label={`${x.name.trim() || `Recipient ${i + 1}`} · ${plain(sharePcts[i] ?? ZERO, 4)}%`}><Money value={r2(total.times(sharePcts[i] ?? ZERO).div(HUNDRED))} /></Row>
            ))}
          </Results>
          {!covered.eq(sale) && <div className="mt-2 text-[12px] text-warn">The slabs cover <Money value={covered} /> of the sale value of <Money value={sale} />. {covered.lt(sale) ? 'Part of the sale earns no commission because no slab covers it.' : 'Slabs overlap, so part of the sale earns commission more than once.'}</div>}
          <Evidence formula={'Amount in a slab = min(Sale value, Slab upper limit) − Slab lower limit, never below zero\nCommission for a slab = Amount in the slab × Slab rate ÷ 100\nRecipient share = Total commission × Share % ÷ 100'}
            inputs={[{ label: 'Sale value', value: <Money value={sale} /> }, ...lines.map((l, i) => ({ label: `Slab ${i + 1}`, value: `${l.from.toString()} – ${l.to ? l.to.toString() : 'no limit'} @ ${plain(l.rate, 4)}%` })), { label: 'Rounding', value: 'Each slab and each share to 2 decimals, half up' }]} />
        </>
      ) : <Waiting text="Enter the sale value and a rate for every slab to see the result." />}
    </Card>
  )
}

// ---------------------------------------------------------------- 9. currency
function CurrencyCalc() {
  const [a, setA] = useState('')
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('INR')
  const amount = amt(a), r = num(rate)
  const ok = amount !== null && r !== null && r.gt(0)
  const code = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  return (
    <Card title="Currency conversion" icon={<ArrowLeftRight size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="From currency"><input className="field num" value={from} onChange={(e) => setFrom(code(e.target.value))} placeholder="USD" /></Field>
        <Field label="To currency"><input className="field num" value={to} onChange={(e) => setTo(code(e.target.value))} placeholder="INR" /></Field>
        <AmountField label={`Amount in ${from || 'the source currency'}`} value={a} onChange={setA} placeholder="e.g. 12500" currency={from || undefined} />
        <NumField label={`Rate — ${to || 'target'} for 1 ${from || 'source'}`} value={rate} onChange={setRate} placeholder="e.g. 83.25" />
      </div>
      {ok ? (
        <>
          <Results>
            <Row label={`Amount in ${from || 'source currency'}`}><Money value={amount} currency={from || undefined} /></Row>
            <Row label={`Converted amount in ${to || 'target currency'}`} strong><Money value={r2(amount.times(r))} currency={to || undefined} /></Row>
          </Results>
          <div className="mt-2 text-[12px] text-muted">The rate is the one you entered. NUMERO has not looked up or verified any market rate.</div>
          <Evidence formula="Converted amount = Amount × Rate" inputs={[{ label: 'Amount', value: <Money value={amount} currency={from || undefined} /> }, { label: 'Rate entered by you', value: plain(r, 8) }, { label: 'Rounding', value: '2 decimals, half up' }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}

// ---------------------------------------------------------------- 10. change & CAGR
function GrowthCalc() {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [y, setY] = useState('')
  const start = amt(a), end = amt(b), years = y.trim() ? num(y) : null
  const ok = start !== null && end !== null
  const change = ok ? end.minus(start) : ZERO
  const cagrOk = ok && years !== null && years.gt(0) && start.gt(0) && end.gt(0)
  const cagr = cagrOk ? end.div(start).pow(new Decimal(1).div(years)).minus(1).times(100) : null
  return (
    <Card title="Percentage change & CAGR" icon={change.lt(0) ? <TrendingDown size={16} /> : <TrendingUp size={16} />}>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <AmountField label="Start value" value={a} onChange={setA} />
        <AmountField label="End value" value={b} onChange={setB} />
        <NumField label="Years (for CAGR)" value={y} onChange={setY} placeholder="e.g. 3" />
      </div>
      {ok ? (
        <>
          <Results>
            <Row label="Change"><Money value={change} sign colored /></Row>
            <Row label="Percentage change" strong>{start.isZero() ? 'not defined — start value is zero' : pct(change.div(start).times(100))}</Row>
            <Row label="CAGR" strong>{cagr ? pct(cagr) + ' a year' : years === null ? 'enter the number of years' : 'not defined — needs start, end and years above zero'}</Row>
          </Results>
          <Evidence formula={'Percentage change = (End − Start) ÷ Start × 100\nCAGR = ((End ÷ Start)^(1 ÷ Years) − 1) × 100'}
            inputs={[{ label: 'Start value', value: <Money value={start} /> }, { label: 'End value', value: <Money value={end} /> }, { label: 'Years', value: years ? plain(years, 4) : 'not entered' }]} />
        </>
      ) : <Waiting />}
    </Card>
  )
}
