import { useMemo, useState } from 'react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { downloadCsv, incomeIn, locale, money, monthSplit, thisMonth } from '../lib/finance';
import { liveRate, type LiveRates } from '../lib/liveRates';
import type { Expense, ExpenseCategory, IncomeEntry, Allowance } from '../types/finance';
import { CurrencySelect, LiveRatesNotice, LiveStamp, fill, reportCurrency } from '../components/Common';
import { CategoryBars, MonthlyBars } from '../components/Charts';

type Props = {
  t: Translation; lang: Lang; allowances: Allowance[]; expenses: Expense[]; categories: ExpenseCategory[]; incomes: IncomeEntry[]; live: LiveRates;
  curOf: (key: string) => string; setCur: (key: string, c: string) => void; onRefreshLive: () => void;
};

export default function ReportsPage({ t, lang, allowances, expenses, categories, incomes, live, curOf, setCur, onRefreshLive }: Props) {
  const nowYear = Number(thisMonth().slice(0, 4));
  const [year, setYear] = useState(nowYear);
  // One currency for the whole report so that income, expenses and net always add up.
  const chosen = curOf('reports');
  const cur = reportCurrency(chosen, live);
  const years = useMemo(() => {
    const set = new Set<number>([nowYear]);
    [...expenses, ...incomes].forEach((x) => set.add(Number(x.date.slice(0, 4))));
    return [...set].sort((a, b) => b - a);
  }, [expenses, incomes, nowYear]);
  const y = String(year);
  // Expenses are kept in GHS and shown in the chosen currency at today's live market rate.
  const gRate = liveRate('GHS', cur, live) ?? 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${y}-${String(i + 1).padStart(2, '0')}`;
    const sp = monthSplit(key, expenses, allowances), r = gRate;
    const inside = sp.inside * r, outside = sp.outside * r;
    const income = incomes.filter((x) => x.date.startsWith(key)).reduce((s, x) => s + (incomeIn(x, cur, live) ?? 0), 0);
    return { key, label: new Date(year, i, 1).toLocaleString(locale(lang), { month: 'short' }), full: new Date(year, i, 1).toLocaleString(locale(lang), { month: 'long' }), inside, outside, income, net: income - inside - outside };
  });
  const tot = months.reduce((a, m) => ({ inside: a.inside + m.inside, outside: a.outside + m.outside, income: a.income + m.income, net: a.net + m.net }), { inside: 0, outside: 0, income: 0, net: 0 });
  const yearExpenses = expenses.filter((e) => e.date.startsWith(y) && !e.autoOverrun);
  const yearIncomes = incomes.filter((i) => i.date.startsWith(y));
  const unconverted = yearIncomes.filter((i) => incomeIn(i, cur, live) === null).length;
  const catRows = categories
    .map((c) => ({ name: catLabel(c.name, lang), color: c.color, value: yearExpenses.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amount * gRate, 0) }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const catName = (id: number) => catLabel(categories.find((c) => c.id === id)?.name || '', lang);
  const titleOf = (e: Expense) => (e.autoOverrun ? t.overrunTitle : e.title);
  const yn = (b: boolean) => (b ? t.yes : t.no);
  const hasData = yearExpenses.length + yearIncomes.length > 0;
  const c2 = (n: number) => n.toFixed(2);

  const exportExpenses = () => downloadCsv(`family-expenses-${y}.csv`, [
    [t.date, t.title, t.category, t.amountGHS, t.notes, t.recurring, t.outsideBudget],
    ...expenses.map((e) => [e.date, titleOf(e), catName(e.categoryId), e.amount, e.notes, yn(e.recurring || !!e.recurringParentId), yn(e.outsideBudget)]),
  ]);
  const exportIncome = () => downloadCsv(`family-income-${y}.csv`, [
    [t.date, t.source, t.amount.replace(' (GHS)', ''), t.currency, fill(t.approxValue, { cur }), t.notes],
    ...incomes.map((i) => { const v = incomeIn(i, cur, live); return [i.date, i.title, i.amount, i.currency, v === null ? '' : c2(v), i.notes]; }),
  ]);
  const exportSummary = () => downloadCsv(`family-summary-${y}-${cur}.csv`, [
    [t.month, `${t.income} (${cur})`, `${t.budgetedShort} (${cur})`, `${t.outsideShort} (${cur})`, `${t.net} (${cur})`],
    ...months.map((m) => [m.full, c2(m.income), c2(m.inside), c2(m.outside), c2(m.net)]),
    [t.yearTotal, c2(tot.income), c2(tot.inside), c2(tot.outside), c2(tot.net)],
  ]);
  const m = (n: number) => money(n, lang, cur);

  return (
    <>
      <div className="subtitle-row">
        <p className="subtitle">{t.reportsSubtitle}</p>
        <div className="pickers">
          <label className="month-picker">{t.showIn}<CurrencySelect t={t} value={chosen} onChange={(c) => setCur('reports', c)} /></label>
          <label className="month-picker">{t.year}<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((v) => <option key={v}>{v}</option>)}</select></label>
        </div>
      </div>
      <LiveRatesNotice t={t} live={live} onRetry={onRefreshLive} />
      <LiveStamp t={t} lang={lang} live={live} />
      <section className="stats">
        <div className="stat-card"><div className="stat-top"><span>{t.income}</span></div><strong>{m(tot.income)}</strong><small>{unconverted ? fill(t.unconvertedIncomeNote, { n: unconverted }) : fill(t.shownIn, { cur })}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.budgetedShort}</span></div><strong>{m(tot.inside)}</strong><small>{y} · {fill(t.shownIn, { cur })}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.outsideBudgetExpenses}</span></div><strong>{m(tot.outside)}</strong><small>{t.trackedSeparately}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.netBalance}</span></div><strong className={tot.net < 0 ? 'neg' : ''}>{m(tot.net)}</strong><small>{t.income} − {t.expenses.toLowerCase()}</small></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.incomeVsExpenses.replace('GHS', cur)}</h2><p>{t.monthlyOverview} · {y}</p></div></div>
        {hasData ? <MonthlyBars labels={months.map((x) => x.label)} income={months.map((x) => x.income)} expenses={months.map((x) => x.inside + x.outside)} incomeLabel={t.income} expenseLabel={t.expenses} lang={lang} title={t.incomeVsExpenses.replace('GHS', cur)} /> : <p className="muted">{t.noData}</p>}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.expensesByCategory}</h2><p>{y} · {fill(t.shownIn, { cur })}</p></div></div>
        {catRows.length ? <CategoryBars rows={catRows} format={m} /> : <p className="muted">{t.noData}</p>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div><h2>{t.monthlyExpenses}</h2><p>{t.monthlyOverview} · {y} · {fill(t.shownIn, { cur })}</p></div>
          <div className="btn-row"><button className="outline" onClick={exportExpenses}>{t.exportExpensesCSV}</button><button className="outline" onClick={exportIncome}>{t.exportIncomeCSV}</button><button className="primary" onClick={exportSummary}>{t.exportSummaryCSV}</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.month}</th><th>{t.income} ({cur})</th><th>{t.budgetedShort} ({cur})</th><th>{t.outsideShort} ({cur})</th><th>{t.net} ({cur})</th></tr></thead>
            <tbody>
              {months.map((x) => <tr key={x.key}><td>{x.full}</td><td className="amount">{m(x.income)}</td><td>{m(x.inside)}</td><td>{m(x.outside)}</td><td className={x.net < 0 ? 'neg' : ''}>{m(x.net)}</td></tr>)}
              <tr className="total-row"><td><strong>{t.yearTotal}</strong></td><td className="amount">{m(tot.income)}</td><td className="amount">{m(tot.inside)}</td><td className="amount">{m(tot.outside)}</td><td className={tot.net < 0 ? 'amount neg' : 'amount'}>{m(tot.net)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
