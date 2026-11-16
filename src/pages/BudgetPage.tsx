import { useEffect, useState } from 'react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { budgetState, money, sumExpenses } from '../lib/finance';
import type { Expense, ExpenseCategory } from '../types/finance';
import { BudgetAlert, MonthPicker, ProgressBar, StateBadge, fill } from '../components/Common';
import { CategoryBars } from '../components/Charts';

type Props = {
  t: Translation; lang: Lang; month: string; setMonth: (m: string) => void; expenses: Expense[]; categories: ExpenseCategory[];
  budget: { amount: number; inherited: boolean; saved: boolean }; onSave: (amount: number) => Promise<void>; onRemove: () => Promise<void>;
};

export default function BudgetPage({ t, lang, month, setMonth, expenses, categories, budget, onSave, onRemove }: Props) {
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setValue(budget.saved ? String(budget.amount) : ''); setNotice(''); }, [month, budget.amount, budget.saved]);
  const monthList = expenses.filter((e) => e.date.startsWith(month) && !e.outsideBudget);
  const raw = sumExpenses(monthList);
  const spent = budget.amount > 0 ? Math.min(raw, budget.amount) : raw;
  const state = budgetState(raw, budget.amount);
  const rows = categories
    .map((c) => ({ name: catLabel(c.name, lang), color: c.color, value: sumExpenses(monthList, (e) => e.categoryId === c.id) }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const amount = Number(value);
  return (
    <section className="panel budget-panel">
      <div className="panel-head"><div><h2>{t.budget}</h2><p>{t.setMonthlyBudget}</p></div><MonthPicker t={t} month={month} onChange={setMonth} /></div>
      <BudgetAlert t={t} lang={lang} spent={raw} budget={budget.amount} />
      <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (Number.isFinite(amount) && amount > 0) { await onSave(amount); setNotice(t.budgetSaved); } }}>
        <label>{t.budgetTotal} (GHS)<input type="number" min="0.01" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.example2500} /></label>
        <button className="primary" type="submit">{t.saveBudget}</button>
        {budget.saved && <button className="outline" type="button" onClick={() => void onRemove()}>{t.removeBudget}</button>}
      </form>
      {notice && <p className="hint">{notice}</p>}
      {budget.inherited && budget.amount > 0 && <p className="hint">{t.budgetInherited} ({money(budget.amount, lang)})</p>}
      <div className="budget-progress">
        <span>{t.spent}: {money(spent, lang)} <StateBadge t={t} state={state} /></span>
        <span>{budget.amount ? money(budget.amount - spent, lang) : '—'} {t.remaining.toLowerCase()}</span>
        <ProgressBar spent={raw} budget={budget.amount} />
      </div>
      {budget.amount > 0 && raw > budget.amount && <p className="hint">{fill(t.overrunNote, { amount: money(raw - budget.amount, lang) })}</p>}
      <h3 className="sub-h">{t.byCategory}</h3>
      {rows.length ? <CategoryBars rows={rows} format={(n) => money(n, lang)} /> : <p className="muted">{t.noSpend}</p>}
    </section>
  );
}
