import { useState } from 'react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { budgetState, fmtDate, money, monthSplit, sumExpenses } from '../lib/finance';
import { amountLeft, spentOn, type NewAllowanceInput } from '../lib/allowances';
import type { Allowance, Expense, ExpenseCategory } from '../types/finance';
import { BudgetAlert, MonthPicker, ProgressBar, StateBadge, fill, periodLabel } from '../components/Common';
import { CategoryBars } from '../components/Charts';

export type AllowanceResult = 'ok' | 'invalid' | 'overlap' | 'below_spent' | 'before_start';
type Props = {
  t: Translation; lang: Lang; month: string; setMonth: (m: string) => void; expenses: Expense[]; categories: ExpenseCategory[];
  allowances: Allowance[]; today: string;
  onCreate: (input: NewAllowanceInput) => Promise<AllowanceResult>;
  onChangeAmount: (a: Allowance, amount: number) => Promise<AllowanceResult>;
  onSetEnd: (a: Allowance, endDate: string) => Promise<AllowanceResult>;
  onDelete: (a: Allowance) => Promise<void>;
};

export default function BudgetPage({ t, lang, month, setMonth, expenses, categories, allowances, today, onCreate, onChangeAmount, onSetEnd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ a: Allowance; kind: 'amount' | 'end' } | null>(null);
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);

  const sp = monthSplit(month, expenses, allowances);
  const state = budgetState(sp.used, sp.budget);
  const monthList = expenses.filter((e) => e.date.startsWith(month) && !e.outsideBudget && !e.autoOverrun);
  const rows = categories
    .map((c) => ({ name: catLabel(c.name, lang), color: c.color, value: sumExpenses(monthList, (e) => e.categoryId === c.id) }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const list = [...allowances].sort((x, y) => y.startDate.localeCompare(x.startDate));
  const statusOf = (a: Allowance) => (a.endDate && a.endDate < today ? 'closed' : a.startDate > today ? 'upcoming' : 'active');

  const say = (r: AllowanceResult, a?: Allowance) =>
    r === 'below_spent' ? fill(t.alwBelowSpent, { amount: money(a ? spentOn(a, expenses) : 0, lang) })
    : r === 'overlap' ? t.alwOverlap : r === 'before_start' ? t.alwEndBeforeStart : t.alwInvalid;

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const r = await onCreate({ startDate: start, endDate: end || undefined, amount: Number(amount), note: note.trim() });
    if (r === 'ok') { setNotice({ text: t.alwCreated, bad: false }); setFormOpen(false); setEnd(''); setAmount(''); setNote(''); }
    else setNotice({ text: say(r), bad: true });
  }
  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const r = editing.kind === 'amount' ? await onChangeAmount(editing.a, Number(value)) : await onSetEnd(editing.a, value);
    if (r === 'ok') { setNotice({ text: editing.kind === 'amount' ? t.alwAmountSaved : t.alwEndSaved, bad: false }); setEditing(null); }
    else setNotice({ text: say(r, editing.a), bad: true });
  }
  const startEdit = (a: Allowance, kind: 'amount' | 'end') => { setEditing({ a, kind }); setValue(kind === 'amount' ? String(a.amount) : a.endDate); setNotice(null); };

  return (
    <section className="panel budget-panel">
      <div className="panel-head"><div><h2>{t.budget}</h2><p>{t.alwIntro}</p></div><MonthPicker t={t} month={month} onChange={setMonth} /></div>
      <BudgetAlert t={t} lang={lang} spent={sp.used} budget={sp.budget} />

      <div className="btn-row"><button className="primary" type="button" onClick={() => { setFormOpen(!formOpen); setNotice(null); }}>+ {t.newAllowance}</button></div>
      {formOpen && (
        <form className="inline-form" onSubmit={submitNew}>
          <label>{t.allowanceStart}<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>{t.allowanceEndOptional}<input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>{t.alwAmount} (GHS)<input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t.example2500} /></label>
          <label>{t.allowanceNote}<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="primary" type="submit">{t.createAllowance}</button>
        </form>
      )}
      {editing && (
        <form className="inline-form" onSubmit={submitEdit}>
          <label>{fill(editing.kind === 'amount' ? t.alwEditAmountFor : t.alwEditEndFor, { start: fmtDate(editing.a.startDate, lang) })}
            {editing.kind === 'amount'
              ? <input type="number" min="0.01" step="0.01" required value={value} onChange={(e) => setValue(e.target.value)} />
              : <input type="date" min={editing.a.startDate} value={value} onChange={(e) => setValue(e.target.value)} />}
          </label>
          <button className="primary" type="submit">{t.alwSave}</button>
          <button className="outline" type="button" onClick={() => setEditing(null)}>{t.cancel}</button>
        </form>
      )}
      {notice && <p className={notice.bad ? 'hint bad' : 'hint'}>{notice.text}</p>}

      <h3 className="sub-h">{t.alwCurrent}</h3>
      {sp.allowance ? (
        <div className="budget-progress">
          <span>{periodLabel(sp.allowance, t, lang)} · {t.alwAmount}: {money(sp.budget, lang)}</span>
          <span>{t.alwSpent}: {money(sp.used, lang)} <StateBadge t={t} state={state} /></span>
          <span>{money(sp.budget - sp.used, lang)} {t.remaining.toLowerCase()}</span>
          <ProgressBar spent={sp.used} budget={sp.budget} />
        </div>
      ) : <p className="muted">{t.alwNone}</p>}
      {sp.overrun > 0 && <p className="hint">{fill(t.overrunNote, { amount: money(sp.overrun, lang) })}</p>}

      <h3 className="sub-h">{t.alwTable}</h3>
      {list.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.alwStarted}</th><th>{t.alwCompleted}</th><th>{t.alwAmount}</th><th>{t.alwSpent}</th><th>{t.alwLeft}</th><th>{t.alwStatus}</th><th>{t.alwNote}</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => {
                const st = statusOf(a), left = amountLeft(a, expenses);
                return (
                  <tr key={a.id}>
                    <td>{fmtDate(a.startDate, lang)}</td>
                    <td>{a.endDate ? fmtDate(a.endDate, lang) : t.alwOpenEnd}</td>
                    <td>{money(a.amount, lang)}</td>
                    <td>{money(spentOn(a, expenses), lang)}</td>
                    <td className={left < 0 ? 'neg' : ''}>{money(left, lang)}</td>
                    <td>{{ active: t.alwActive, closed: t.alwClosed, upcoming: t.alwUpcoming }[st]}</td>
                    <td>{a.note || t.emptyNotes}</td>
                    <td>
                      <div className="btn-row">
                        {st === 'active' && <button className="outline" type="button" onClick={() => startEdit(a, 'amount')}>{t.alwChangeAmount}</button>}
                        <button className="outline" type="button" onClick={() => startEdit(a, 'end')}>{t.alwSetEnd}</button>
                        <button className="outline" type="button" onClick={() => void onDelete(a)}>{t.delete}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">{t.alwNoneAtAll}</p>}

      <h3 className="sub-h">{t.byCategory}</h3>
      {rows.length ? <CategoryBars rows={rows} format={(n) => money(n, lang)} /> : <p className="muted">{t.noSpend}</p>}
    </section>
  );
}
