import { useMemo, useState } from 'react';
import { ArrowDownLeft, History, Pencil, Plus, ReceiptText, Search, Trash2, TrendingUp, Wallet } from 'lucide-react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { auditText, money, monthLabel, monthSplit } from '../lib/finance';
import type { Allowance, AuditRecord, Expense, ExpenseCategory } from '../types/finance';
import { BudgetAlert, MonthPicker, ProgressBar, StateBadge, fill, periodLabel } from '../components/Common';
import { budgetState } from '../lib/finance';

type Props = {
  t: Translation; lang: Lang; month: string; setMonth: (m: string) => void;
  expenses: Expense[]; allowances: Allowance[]; categories: ExpenseCategory[]; activity: AuditRecord[];
  onAdd: () => void; onEdit: (e: Expense) => void; onDelete: (e: Expense) => void; onAddCategory: () => void;
};

export default function ExpensesPage({ t, lang, month, setMonth, expenses, allowances, categories, activity, onAdd, onEdit, onDelete, onAddCategory }: Props) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const sp = monthSplit(month, expenses, allowances);
  const state = budgetState(sp.used, sp.budget);
  const monthCount = expenses.filter((e) => e.date.startsWith(month)).length;
  const q = query.toLowerCase();
  const filtered = useMemo(
    () => expenses.filter((e) => (e.title.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q)) && (categoryFilter === 'all' || String(e.categoryId) === categoryFilter)),
    [expenses, q, categoryFilter],
  );
  return (
    <>
      <div className="subtitle-row"><p className="subtitle">{t.dashboardHint}</p><MonthPicker t={t} month={month} onChange={setMonth} /></div>
      <BudgetAlert t={t} lang={lang} spent={sp.used} budget={sp.budget} />
      <section className="stats">
        <div className="stat-card"><div className="stat-top"><span>{t.inBudgetSpent}</span><span className="stat-icon blue"><Wallet size={17} /></span></div><strong>{money(sp.inside, lang)}</strong><small>{sp.overrun > 0 ? t.inBudgetCapNote : monthLabel(month, lang)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.outBudgetSpent}</span><span className="stat-icon orange"><ArrowDownLeft size={17} /></span></div><strong>{money(sp.outside, lang)}</strong><small>{sp.overrun > 0 ? fill(t.overrunNote, { amount: money(sp.overrun, lang) }) : monthLabel(month, lang)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.monthTotal}</span><span className="stat-icon purple"><ReceiptText size={17} /></span></div><strong>{money(sp.total, lang)}</strong><small>{monthCount} {t.count.toLowerCase()} · {monthLabel(month, lang)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.budgetRemaining}</span><span className="stat-icon green"><TrendingUp size={17} /></span></div>
          <strong>{sp.budget ? money(Math.max(0, sp.budget - sp.used), lang) : '—'}</strong>
          <small>{sp.budget ? `${t.budgetTotal}: ${money(sp.budget, lang)}${sp.allowance ? ' · ' + periodLabel(sp.allowance, t, lang) : ''}` : t.monthlyBudgetNotSet}</small>
          {sp.budget > 0 && <><ProgressBar spent={sp.used} budget={sp.budget} /><StateBadge t={t} state={state} /></>}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.expenses}</h2><p>{t.reviewManageTransactions}</p></div><button className="outline" onClick={onAddCategory}>+ {t.customCategory}</button></div>
        <div className="filters">
          <div className="searchbox"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} /></div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">{t.allCategories}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{catLabel(c.name, lang)}</option>)}
          </select>
          <span className="result-count">{filtered.length} {t.count.toLowerCase()}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.title}</th><th>{t.category}</th><th>{t.date}</th><th>{t.amount}</th><th>{t.budget}</th><th>{t.details}</th><th></th></tr></thead>
            <tbody>
              {filtered.map((e) => {
                const c = categories.find((x) => x.id === e.categoryId);
                const auto = !!e.autoOverrun;
                return (
                  <tr key={e.id}>
                    <td><div className="expense-title"><span className="category-dot" style={{ background: c?.color || '#64748b' }} /><div><strong>{auto ? t.overrunTitle : e.title}</strong>{(e.notes || auto) && <small>{auto ? t.overrunHint : e.notes}</small>}</div></div></td>
                    <td><span className="category-chip">{c ? catLabel(c.name, lang) : '—'}</span></td>
                    <td>{e.date}</td>
                    <td className="amount">{money(e.amount, lang)}</td>
                    <td><span className={e.outsideBudget ? 'pill outside' : 'pill inside'}>{e.outsideBudget ? t.outside : t.within}</span></td>
                    <td>
                      {auto ? <span className="pill recurring">{t.managedAuto}</span>
                        : e.recurring ? <span className="pill recurring">↻ {t[(e.recurringFrequency || 'monthly') as 'weekly' | 'monthly' | 'yearly']}</span>
                        : e.recurringParentId ? <span className="pill recurring" title={t.generatedFrom}>↻ {t.autoGenerated}</span> : <span className="muted">—</span>}
                    </td>
                    <td>{!auto && <div className="row-actions"><button title={t.edit} onClick={() => onEdit(e)}><Pencil size={15} /></button><button title={t.delete} onClick={() => onDelete(e)}><Trash2 size={15} /></button></div>}</td>
                  </tr>
                );
              })}
              {!filtered.length && <tr><td colSpan={7} className="empty"><ReceiptText size={30} /><strong>{t.noExpenses}</strong><button className="primary" onClick={onAdd}><Plus size={16} />{t.addExpense}</button></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-head"><div><h2><History size={17} /> {t.history}</h2><p>{t.changesRecordedDevice}</p></div></div>
        {activity.length ? activity.map((a) => <div className="activity-row" key={a.id}><span className="activity-dot" /><span>{auditText(a, t, lang)}</span><small>{new Date(a.at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH')}</small></div>) : <p className="muted">{t.noActivity}</p>}
      </section>
    </>
  );
}
