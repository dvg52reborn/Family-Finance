import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { Translation, Lang } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { CURRENCIES, currencyName, today } from '../lib/finance';
import type { Conversion, Expense, ExpenseCategory, IncomeEntry } from '../types/finance';
import { fill } from './Common';

type SaveHandler = (form: HTMLFormElement) => Promise<void>;

function Shell({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <button className="close" type="button" onClick={onClose}><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Actions({ t, onClose, label, icon }: { t: Translation; onClose: () => void; label?: string; icon?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="outline" onClick={onClose}>{t.cancel}</button>
      <button type="submit" className="primary">{icon && <Plus size={16} />}{label ?? t.save}</button>
    </div>
  );
}

const submit = (onSave: SaveHandler) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); void onSave(e.currentTarget); };

export function ExpenseModal(p: { t: Translation; lang: Lang; categories: ExpenseCategory[]; expense: Expense | null; onClose: () => void; onSave: SaveHandler }) {
  const { t, lang, categories, expense } = p;
  const generated = !!expense?.recurringParentId;
  return (
    <Shell wide title={expense ? t.editExpense : t.addExpense} subtitle={t.enterTransactionDetails} onClose={p.onClose}>
      <form onSubmit={submit(p.onSave)}>
        <div className="form-grid">
          <label>{t.title}<input name="title" required maxLength={100} defaultValue={expense?.title || ''} placeholder={t.marketShopping} /></label>
          <label>{t.amount}<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={expense?.amount ?? ''} placeholder="0.00" /></label>
          <label>{t.category}
            <select name="categoryId" required defaultValue={expense?.categoryId ?? categories[0]?.id ?? ''}>
              {categories.map((c) => <option key={c.id} value={c.id}>{catLabel(c.name, lang)}</option>)}
            </select>
          </label>
          <label>{t.date}<input name="date" type="date" required defaultValue={expense?.date || today()} /></label>
          <label className="full">{t.notes}<textarea name="notes" rows={3} maxLength={500} defaultValue={expense?.notes || ''} placeholder={t.addContext} /></label>
          {generated ? (
            <p className="hint full">↻ {t.generatedFrom}</p>
          ) : (
            <>
              <div className="check-wrap">
                <label className="check"><input name="recurring" type="checkbox" defaultChecked={expense?.recurring || false} />{t.recurring}</label>
                <label>{t.frequency}
                  <select name="frequency" defaultValue={expense?.recurringFrequency || 'monthly'}>
                    <option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option><option value="yearly">{t.yearly}</option>
                  </select>
                </label>
              </div>
              <p className="hint full">{t.recurringHint}</p>
            </>
          )}
          <label className="check full"><input name="outsideBudget" type="checkbox" defaultChecked={expense?.outsideBudget || false} />{t.outsideBudget}</label>
        </div>
        <Actions t={t} onClose={p.onClose} icon label={t.saveExpense} />
      </form>
    </Shell>
  );
}

export function IncomeModal(p: { t: Translation; lang: Lang; income: IncomeEntry | null; onClose: () => void; onSave: SaveHandler }) {
  const { t, lang, income } = p;
  return (
    <Shell title={income ? t.editIncome : t.addIncome} subtitle={t.addIncomeSource} onClose={p.onClose}>
      <form onSubmit={submit(p.onSave)}>
        <label>{t.incomeSource}<input name="title" required maxLength={100} defaultValue={income?.title || ''} placeholder={t.salarySupport} /></label>
        <label>{t.amount.replace(' (GHS)', '')}<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={income?.amount ?? ''} placeholder="0.00" /></label>
        <label>{t.currency}
          <select name="currency" defaultValue={income?.currency || 'GHS'}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{currencyName(c, lang)}</option>)}
          </select>
        </label>
        <label>{t.date}<input name="date" type="date" required defaultValue={income?.date || today()} /></label>
        <label>{t.notes}<textarea name="notes" rows={2} maxLength={500} defaultValue={income?.notes || ''} placeholder={t.optionalDetails} /></label>
        <Actions t={t} onClose={p.onClose} />
      </form>
    </Shell>
  );
}

export type ConversionForm = Omit<Conversion, 'id' | 'toAmount'>;
export function ConversionModal(p: { t: Translation; lang: Lang; conversion: Conversion | null; onClose: () => void; onSave: (c: ConversionForm) => Promise<void> }) {
  const { t, lang, conversion } = p;
  const [from, setFrom] = useState(conversion?.fromCurrency ?? 'GHS');
  const [to, setTo] = useState(conversion?.toCurrency ?? 'XOF');
  const [amount, setAmount] = useState(conversion ? String(conversion.fromAmount) : '');
  const [rate, setRate] = useState(conversion ? String(conversion.rate) : '');
  const [date, setDate] = useState(conversion?.date ?? today());
  const [notes, setNotes] = useState(conversion?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const received = Number(amount) > 0 && Number(rate) > 0 ? Math.round(Number(amount) * Number(rate) * 100) / 100 : null;
  async function online() {
    if (from === to) { alert(t.sameCurrency); return; }
    setBusy(true);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
      const r = Number((await res.json())?.rates?.[to]);
      if (!res.ok || !r) throw new Error('rate');
      setRate(String(r));
    } catch { alert(t.cannotRetrieveRate); }
    setBusy(false);
  }
  const sel = (v: string, set: (x: string) => void) => (
    <select value={v} onChange={(e) => set(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{currencyName(c, lang)}</option>)}</select>
  );
  return (
    <Shell title={conversion ? t.editExchange : t.addExchange} subtitle={t.exchangeSubtitle} onClose={p.onClose}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (from === to) { alert(t.sameCurrency); return; }
        if (!(Number(amount) > 0) || !(Number(rate) > 0)) return;
        void p.onSave({ date, fromCurrency: from, fromAmount: Number(amount), toCurrency: to, rate: Number(rate), notes: notes.trim() });
      }}>
        <div className="form-grid">
          <label>{t.exchangeFrom}<input type="number" min="0.01" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label>{t.fromCurrency}{sel(from, setFrom)}</label>
          <label>{t.toCurrency}{sel(to, setTo)}</label>
          <label>{t.rate}<input type="number" min="0.000001" step="any" required value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t.exampleRate} /></label>
          <div className="full"><button type="button" className="outline" disabled={busy} onClick={() => void online()}>{t.useOnlineRate}</button></div>
          <div className="full received"><small>{t.receivedAmount}</small><strong>{received === null ? '—' : `${received.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH', { maximumFractionDigits: 2 })} ${to}`}</strong>
            {Number(rate) > 0 && <small>{fill(t.rateLine, { from, rate: Number(rate), to })}</small>}</div>
          <label>{t.date}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t.notes}<input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} placeholder={t.optionalDetails} /></label>
        </div>
        <Actions t={t} onClose={p.onClose} />
      </form>
    </Shell>
  );
}

export function CategoryModal(p: { t: Translation; onClose: () => void; onSave: SaveHandler }) {
  const { t } = p;
  return (
    <Shell title={t.customCategory} subtitle={t.createCategoryDescription} onClose={p.onClose}>
      <form onSubmit={submit(p.onSave)}>
        <label>{t.categoryName}<input name="name" required maxLength={40} placeholder={t.familyEvents} /></label>
        <label>{t.categoryColor}<input name="color" type="color" defaultValue="#64748b" /></label>
        <Actions t={t} onClose={p.onClose} label={t.createCategory} />
      </form>
    </Shell>
  );
}
