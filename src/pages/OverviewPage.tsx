import { History, RefreshCw, TrendingUp, Wallet, ReceiptText, Landmark } from 'lucide-react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { CURRENCIES, auditText, budgetState, fundsIn, incomeIn, money, monthLabel, monthSplit, sumExpenses } from '../lib/finance';
import type { LiveRates } from '../lib/liveRates';
import type { AuditRecord, Conversion, Expense, ExpenseCategory, IncomeEntry, MonthlyBudget } from '../types/finance';
import { BalanceCards, BudgetAlert, CurrencySelect, LiveRatesNotice, LiveStamp, MonthPicker, ProgressBar, StateBadge, fill } from '../components/Common';
import { CategoryBars } from '../components/Charts';

type Props = {
  t: Translation; lang: Lang; month: string; setMonth: (m: string) => void;
  expenses: Expense[]; budgets: MonthlyBudget[]; categories: ExpenseCategory[]; incomes: IncomeEntry[]; conversions: Conversion[];
  live: LiveRates; closing: Record<string, number>; opening: Record<string, number>; activity: AuditRecord[];
  curOf: (key: string) => string; setCur: (key: string, c: string) => void; onRefreshLive: () => void;
};

export default function OverviewPage({ t, lang, month, setMonth, expenses, budgets, categories, incomes, conversions, live, closing, opening, activity, curOf, setCur, onRefreshLive }: Props) {
  const sp = monthSplit(month, expenses, budgets);
  const state = budgetState(sp.raw, sp.budget);
  const fundsCur = curOf('overview.funds'), incomeCur = curOf('overview.income');
  const fundsTotal = fundsIn(closing, fundsCur, live);
  const negative = Object.entries(closing).filter(([, v]) => v < 0).map(([c]) => c);
  const monthIncomes = incomes.filter((i) => i.date.startsWith(month));
  const incomeConv = monthIncomes.map((i) => incomeIn(i, incomeCur, live));
  const incomeShown = incomeConv.reduce<number>((s, v) => s + (v ?? 0), 0);
  const incomeMissing = incomeConv.filter((v) => v === null).length;
  const monthRows = expenses.filter((e) => e.date.startsWith(month) && !e.autoOverrun);
  const catRows = categories.map((c) => ({ name: catLabel(c.name, lang), color: c.color, value: sumExpenses(monthRows, (e) => e.categoryId === c.id) }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);

  // Funds movement per currency; "spending & budget" is whatever remains, so each row always adds up.
  const movement = CURRENCIES.map((c) => {
    const inc = monthIncomes.filter((i) => i.currency === c).reduce((s, i) => s + i.amount, 0);
    const exch = conversions.filter((x) => x.date.startsWith(month)).reduce((s, x) => s + (x.toCurrency === c ? x.toAmount : 0) - (x.fromCurrency === c ? x.fromAmount : 0), 0);
    const o = opening[c] ?? 0, cl = closing[c] ?? 0;
    return { c, o, inc, exch, spend: Math.round((cl - o - inc - exch) * 100) / 100, cl };
  }).filter((r) => r.c === 'GHS' || r.o || r.inc || r.exch || r.spend || r.cl);

  return (
    <>
      <div className="subtitle-row"><p className="subtitle">{t.overviewSubtitle}</p><MonthPicker t={t} month={month} onChange={setMonth} /></div>
      <LiveRatesNotice t={t} live={live} onRetry={onRefreshLive} />
      {negative.length > 0 && <div className="banner over" role="alert">⚠ {fill(t.negativeFunds, { list: negative.join(', ') })}</div>}
      <BudgetAlert t={t} lang={lang} spent={sp.raw} budget={sp.budget} />
      <section className="stats">
        <div className="stat-card"><div className="stat-top"><span>{t.totalFunds}</span><CurrencySelect t={t} value={fundsCur} onChange={(c) => setCur('overview.funds', c)} /></div>
          <strong className={fundsTotal.total < 0 ? 'neg' : ''}>{money(fundsTotal.total, lang, fundsCur)}</strong>
          <small>{fundsTotal.missing.length ? fill(t.notConverted, { list: fundsTotal.missing.join(', ') }) : fill(t.sumConverted, { cur: fundsCur })}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.incomeThisMonth}</span><CurrencySelect t={t} value={incomeCur} onChange={(c) => setCur('overview.income', c)} /></div>
          <strong>{money(incomeShown, lang, incomeCur)}</strong><small>{incomeMissing ? fill(t.entriesWithoutRate, { n: incomeMissing }) : monthLabel(month, lang)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.monthTotal}</span><span className="stat-icon orange"><ReceiptText size={17} /></span></div><strong>{money(sp.total, lang)}</strong>
          <small>{t.inBudgetSpent}: {money(sp.inside, lang)} · {t.outBudgetSpent}: {money(sp.outside, lang)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.budgetRemaining}</span><span className="stat-icon purple"><Wallet size={17} /></span></div>
          <strong>{sp.budget ? money(Math.max(0, sp.budget - sp.inside), lang) : '—'}</strong><small>{sp.budget ? `${t.budgetTotal}: ${money(sp.budget, lang)}` : t.monthlyBudgetNotSet}</small>
          {sp.budget > 0 && <><ProgressBar spent={sp.raw} budget={sp.budget} /><StateBadge t={t} state={state} /></>}</div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2><Landmark size={17} /> {t.fundsByCurrency}</h2><p>{t.fundsHint} · {monthLabel(month, lang)}</p></div>
          <button className="outline" onClick={onRefreshLive}><RefreshCw size={14} /> {t.refreshRates}</button></div>
        <BalanceCards lang={lang} funds={closing} />
        <LiveStamp t={t} lang={lang} live={live} />
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2><TrendingUp size={17} /> {t.monthMovement}</h2><p>{monthLabel(month, lang)}{sp.budget > 0 ? ` · ${t.budgetSetAside}: ${money(sp.budget, lang)}` : ''}</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.currency}</th><th>{t.colOpening}</th><th>{t.colIncome}</th><th>{t.colExchanges}</th><th>{t.colSpending}</th><th>{t.colClosing}</th></tr></thead>
            <tbody>
              {movement.map((r) => (
                <tr key={r.c}><td><strong>{r.c}</strong></td><td>{money(r.o, lang, r.c)}</td><td>{money(r.inc, lang, r.c)}</td><td>{money(r.exch, lang, r.c)}</td><td>{money(r.spend, lang, r.c)}</td>
                  <td className={r.cl < 0 ? 'amount neg' : 'amount'}>{money(r.cl, lang, r.c)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><div><h2>{t.topCategories}</h2><p>{monthLabel(month, lang)}</p></div></div>
          {catRows.length ? <CategoryBars rows={catRows} format={(n) => money(n, lang)} /> : <p className="muted">{t.noSpend}</p>}
        </section>
        <section className="panel activity-panel">
          <div className="panel-head"><div><h2><History size={17} /> {t.recentActivity}</h2></div></div>
          {activity.length ? activity.map((a) => <div className="activity-row" key={a.id}><span className="activity-dot" /><span>{auditText(a, t, lang)}</span><small>{new Date(a.at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GH')}</small></div>) : <p className="muted">{t.noActivity}</p>}
        </section>
      </div>
    </>
  );
}
