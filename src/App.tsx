import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { budgetId, db, logAudit, newId, seedCategories } from './lib/db';
import { messages, type Lang } from './lib/i18n';
import {
  CURRENCIES, budgetFor, diffFields, downloadJson, fundsAsOf, generateRecurring, prevMonth, syncOverruns, thisMonth, today,
} from './lib/finance';
import type { Conversion, Expense, ExpenseCategory, Frequency, IncomeEntry } from './types/finance';
import { LayoutDashboard, ReceiptText, Wallet, TrendingUp, ChartNoAxesColumn, Settings, Plus, Languages, CircleDollarSign, X, Menu } from 'lucide-react';
import { CategoryModal, ConversionModal, ExpenseModal, IncomeModal, type ConversionForm } from './components/Modals';
import { fill } from './components/Common';
import { applyBackup, buildBackup, parseBackup, restoreGate } from './lib/backup';
import { useCloud } from './lib/sync/useCloud';
import { statusText } from './components/CloudPanel';
import { fetchLiveRates, loadCachedLive, type LiveRates } from './lib/liveRates';
import OverviewPage from './pages/OverviewPage';
import ExpensesPage from './pages/ExpensesPage';
import BudgetPage from './pages/BudgetPage';
import IncomePage from './pages/IncomePage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

export const APP_VERSION = '0.8.0';
type Page = 'overview' | 'expenses' | 'budget' | 'income' | 'reports' | 'settings';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ffm-lang') === 'fr' ? 'fr' : 'en'));
  const t = messages[lang];
  const changeLang = (l: Lang) => { setLang(l); localStorage.setItem('ffm-lang', l); document.documentElement.lang = l; };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  /* Each converted figure has its own currency selector; every choice is remembered separately. */
  const [prefs, setPrefs] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('ffm-currency-prefs') || '{}'); } catch { return {}; } });
  const curOf = (key: string) => ((CURRENCIES as readonly string[]).includes(prefs[key]) ? prefs[key] : 'GHS');
  const setCur = (key: string, c: string) => { const next = { ...prefs, [key]: c }; setPrefs(next); localStorage.setItem('ffm-currency-prefs', JSON.stringify(next)); };

  /* Live market rates: used only for display conversions. Cached for offline use and refreshed every 30 minutes. */
  const [live, setLive] = useState<LiveRates>(() => loadCachedLive());
  const refreshLive = useCallback(async (notify = false) => {
    try { setLive(await fetchLiveRates()); if (notify) alert(messages[lang].ratesRefreshed); }
    catch { if (notify) alert(messages[lang].cannotRetrieveRate); }
  }, [lang]);
  useEffect(() => { void refreshLive(); const id = setInterval(() => void refreshLive(), 30 * 60 * 1000); return () => clearInterval(id); }, [refreshLive]);

  /* "Install app" button for browsers that offer it (Chrome, Edge, Android). iPhone/iPad users see a hint in Settings. */
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<void> } | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as unknown as { prompt: () => Promise<void> }); };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const cloud = useCloud(db);
  const [page, setPageRaw] = useState<Page>('expenses');
  const [menuOpen, setMenuOpen] = useState(false);
  const setPage = (p: Page) => { setPageRaw(p); setMenuOpen(false); };
  useEffect(() => { if (!menuOpen) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [menuOpen]);
  useEffect(() => { if (cloud.state.recovery) setPageRaw('settings'); }, [cloud.state.recovery]);   // arrived from a password-reset email
  const [month, setMonth] = useState(thisMonth());
  const [expenseModal, setExpenseModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [incomeModal, setIncomeModal] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeEntry | null>(null);
  const [exchangeModal, setExchangeModal] = useState(false);
  const [editingExchange, setEditingExchange] = useState<Conversion | null>(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [autoNotice, setAutoNotice] = useState(0);

  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []) ?? [];
  const incomes = useLiveQuery(() => db.income.orderBy('date').reverse().toArray(), []) ?? [];
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? [];
  const conversions = useLiveQuery(() => db.conversions.toArray(), []) ?? [];
  const openingRow = useLiveQuery(() => db.settings.get('openings'), []);
  const openings = useMemo(() => (openingRow?.value ?? {}) as Record<string, number>, [openingRow]);
  const recent = useLiveQuery(() => db.auditLog.orderBy('at').reverse().limit(7).toArray(), []) ?? [];
  const history = useLiveQuery(() => db.auditLog.orderBy('at').reverse().limit(100).toArray(), []) ?? [];

  /* First run: seed categories, then create any recurring expenses that have become due. */
  useEffect(() => {
    (async () => {
      await seedCategories();
      const n = await generateRecurring();
      if (n > 0) setAutoNotice(n);
    })().catch(console.error);
  }, []);

  /* Keep the automatic "budget overrun" entries in step with expenses and budgets (no-op when nothing changed). */
  useEffect(() => { syncOverruns().catch(console.error); }, [expenses, budgets]);

  /* Family funds: carried over month to month. Exchanges use the family's own rate; nothing here uses market rates. */
  const fundsInput = useMemo(() => ({ openings, incomes, conversions, expenses, budgets }), [openings, incomes, conversions, expenses, budgets]);
  const closing = useMemo(() => fundsAsOf(month, fundsInput), [month, fundsInput]);
  const opening = useMemo(() => fundsAsOf(prevMonth(month), fundsInput), [month, fundsInput]);
  const currentFunds = useMemo(() => fundsAsOf(thisMonth(), fundsInput), [fundsInput]);

  const budget = budgetFor(month, budgets);
  const savedThisMonth = budgets.some((b) => b.month === month);
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? '';

  /* ---------- expenses ---------- */
  async function saveExpense(form: HTMLFormElement) {
    const fd = new FormData(form);
    const categoryId = Number(fd.get('categoryId'));
    const title = str(fd, 'title');
    const amount = Number(fd.get('amount'));
    if (!title || !Number.isFinite(amount) || amount <= 0 || !categoryId) return;
    const generated = !!editing?.recurringParentId;
    const recurring = !generated && fd.get('recurring') === 'on';
    const frequency = recurring ? ((str(fd, 'frequency') || 'monthly') as Frequency) : '';
    const date = str(fd, 'date') || today();
    const at = new Date().toISOString();
    const entry: Expense = {
      title, amount, currency: 'GHS', categoryId, date, notes: str(fd, 'notes'), recurring, recurringFrequency: frequency,
      recurringParentId: editing?.recurringParentId, outsideBudget: fd.get('outsideBudget') === 'on',
      // Restart the schedule only if the start date or frequency changed.
      generatedCount: recurring && editing?.date === date && editing?.recurringFrequency === frequency ? editing?.generatedCount ?? 0 : 0,
      createdAt: editing?.createdAt || at, updatedAt: at,
    };
    const snap = (e: Expense) => ({ title: e.title, amount: String(e.amount), category: catName(e.categoryId), date: e.date, notes: e.notes, recurring: String(e.recurring), frequency: e.recurringFrequency, outsideBudget: String(e.outsideBudget) });
    if (editing?.id) {
      await db.expenses.put({ ...entry, id: editing.id });
      const changes = diffFields(snap(editing), { ...snap(entry), category: catName(categoryId) });
      await logAudit({ entity: 'expense', entityId: editing.id, action: 'updated', title, changes });
    } else {
      const id = newId();
      await db.expenses.add({ ...entry, id });
      await logAudit({ entity: 'expense', entityId: id, action: 'created', title });
    }
    setExpenseModal(false); setEditing(null);
    if (recurring) { const n = await generateRecurring(); if (n > 0) setAutoNotice(n); }
  }
  async function deleteExpense(e: Expense) {
    if (!e.id || !confirm(t.confirmDelete)) return;
    await db.expenses.delete(e.id);
    await logAudit({ entity: 'expense', entityId: e.id, action: 'deleted', title: e.title });
  }

  /* ---------- categories ---------- */
  async function addCategory(form: HTMLFormElement) {
    const fd = new FormData(form);
    const name = str(fd, 'name');
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { alert(t.categoryExists); return; }
    const id = newId();
    await db.categories.add({ id, name, color: str(fd, 'color') || '#64748b', createdAt: new Date().toISOString() });
    await logAudit({ entity: 'category', entityId: id, action: 'created', title: name });
    setCategoryModal(false);
  }
  async function deleteCategory(c: ExpenseCategory) {
    if (!c.id || (await db.expenses.where('categoryId').equals(c.id).count()) > 0) { alert(t.deleteCategoryBlocked); return; }
    if (!confirm(t.confirmDeleteCategory)) return;
    await db.categories.delete(c.id);
    await logAudit({ entity: 'category', entityId: c.id, action: 'deleted', title: c.name });
  }

  /* ---------- budget ---------- */
  async function saveBudget(amount: number) {
    // One budget per month with an id derived from the month: two devices setting the same month's budget end up with one record.
    await db.transaction('rw', db.budgets, async () => {
      await db.budgets.where('month').equals(month).delete();
      await db.budgets.put({ id: budgetId(month), month, amount, currency: 'GHS' });
    });
  }
  async function removeBudget() { await db.budgets.where('month').equals(month).delete(); }

  /* ---------- income ---------- */
  async function saveIncome(form: HTMLFormElement) {
    const fd = new FormData(form);
    const title = str(fd, 'title');
    const amount = Number(fd.get('amount'));
    if (!title || !Number.isFinite(amount) || amount <= 0) return;
    const entry: IncomeEntry = { title, amount, currency: str(fd, 'currency') || 'GHS', date: str(fd, 'date') || today(), notes: str(fd, 'notes') };
    const snap = (i: IncomeEntry) => ({ title: i.title, amount: String(i.amount), currency: i.currency, date: i.date, notes: i.notes });
    if (editingIncome?.id) {
      await db.income.put({ ...entry, id: editingIncome.id });
      await logAudit({ entity: 'income', entityId: editingIncome.id, action: 'updated', title, changes: diffFields(snap(editingIncome), snap(entry)) });
    } else {
      const id = newId();
      await db.income.add({ ...entry, id });
      await logAudit({ entity: 'income', entityId: id, action: 'created', title });
    }
    setIncomeModal(false); setEditingIncome(null);
  }
  async function deleteIncome(i: IncomeEntry) {
    if (!i.id || !confirm(t.confirmDeleteIncome)) return;
    await db.income.delete(i.id);
    await logAudit({ entity: 'income', entityId: i.id, action: 'deleted', title: i.title });
  }

  /* ---------- currency exchanges ---------- */
  async function saveExchange(f: ConversionForm) {
    const entry: Conversion = { ...f, toAmount: Math.round(f.fromAmount * f.rate * 100) / 100 };
    const title = `${entry.fromAmount} ${entry.fromCurrency} → ${entry.toAmount} ${entry.toCurrency}`;
    const snap = (c: Conversion) => ({ fromAmount: String(c.fromAmount), fromCurrency: c.fromCurrency, toCurrency: c.toCurrency, rate: String(c.rate), toAmount: String(c.toAmount), date: c.date, notes: c.notes });
    if (editingExchange?.id) {
      await db.conversions.put({ ...entry, id: editingExchange.id });
      await logAudit({ entity: 'conversion', entityId: editingExchange.id, action: 'updated', title, changes: diffFields(snap(editingExchange), snap(entry)) });
    } else {
      const id = newId();
      await db.conversions.add({ ...entry, id });
      await logAudit({ entity: 'conversion', entityId: id, action: 'created', title });
    }
    setExchangeModal(false); setEditingExchange(null);
  }
  async function deleteExchange(c: Conversion) {
    if (!c.id || !confirm(t.confirmDeleteExchange)) return;
    await db.conversions.delete(c.id);
    await logAudit({ entity: 'conversion', entityId: c.id, action: 'deleted', title: `${c.fromAmount} ${c.fromCurrency} → ${c.toAmount} ${c.toCurrency}` });
  }
  async function saveOpenings(o: Record<string, number>) { await db.settings.put({ key: 'openings', value: o }); }

  /* ---------- backup ---------- */
  async function backup() { downloadJson(`family-finance-backup-${today()}.json`, await buildBackup(APP_VERSION)); }
  async function restore(file: File) {
    const gate = restoreGate(cloud.state.status, cloud.state.family?.role);
    if (gate === 'member') { alert(t.restoreMemberBlocked); return; }
    if (gate === 'wait') { alert(t.restoreWait); return; }
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      if (!parsed) { alert(t.restoreFailed); return; }
      if (gate === 'owner') {
        // the family's data is about to be replaced on every device: warn, save a safety copy, and only then go on
        const famName = cloud.state.family?.name ?? '';
        if (!confirm(fill(t.confirmRestoreFamily, { family: famName }) + (parsed.legacy ? `\n\n${t.confirmRestoreOld}` : ''))) return;
        const safety = `family-finance-safety-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
        try { downloadJson(safety, await buildBackup(APP_VERSION)); } catch { alert(t.safetyBackupFailed); return; }
        if (!confirm(fill(t.confirmSafetyBackup, { file: safety }))) return;
      } else if (!confirm(parsed.legacy ? t.confirmRestoreOld : t.confirmRestore)) return;
      await applyBackup(parsed);
      const n = await generateRecurring();            // catch up recurring expenses that fell due since the backup was made
      if (n > 0) setAutoNotice(n);
      alert(parsed.legacy && parsed.droppedRates ? fill(t.restoreDoneOld, { n: parsed.droppedRates }) : t.restoreDone);
    } catch { alert(t.restoreFailed); }
  }

  const nav = [
    { id: 'overview' as const, label: t.overview, icon: LayoutDashboard }, { id: 'expenses' as const, label: t.expenses, icon: ReceiptText },
    { id: 'budget' as const, label: t.budget, icon: Wallet }, { id: 'income' as const, label: t.income, icon: TrendingUp },
    { id: 'reports' as const, label: t.reports, icon: ChartNoAxesColumn }, { id: 'settings' as const, label: t.settings, icon: Settings },
  ];
  const current = nav.find((n) => n.id === page)!;
  const openAdd = () => { setEditing(null); setExpenseModal(true); };
  const openAddIncome = () => { setEditingIncome(null); setIncomeModal(true); };

  return (
    <div className="shell">
      <aside className={menuOpen ? 'sidebar menu-open' : 'sidebar'}>
        <div className="sidebar-top">
          <div className="brand"><div className="brand-icon"><CircleDollarSign size={23} /></div><div><strong>{t.app}</strong><small>{t.householdLedger}</small></div></div>
          <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" aria-label={menuOpen ? t.closeMenu : t.menu} onClick={() => setMenuOpen((o) => !o)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
        <div className="nav-label">{t.workspace}</div>
        <nav id="main-nav">{nav.map((n) => <button key={n.id} className={page === n.id ? 'nav-item active' : 'nav-item'} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}><n.icon size={18} />{n.label}</button>)}</nav>
        <div className="side-bottom">
          <button className="sync-badge" onClick={() => setPage('settings')} title={t.cloudTitle}><span className={`dot ${cloud.state.status}`} />{statusText(t, cloud.state.status)}{cloud.state.pending > 0 ? ` · ${cloud.state.pending}` : ''}</button>
          {installEvent && <button className="outline install" onClick={() => void installEvent.prompt()}>⤓ {t.installApp}</button>}<div className="profile"><div className="avatar">F</div><div><strong>{t.familyWorkspace}</strong><small>{t.localDevice}</small></div></div></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">{t.householdFinances} / {current.label.toUpperCase()}</div><h1>{page === 'expenses' ? t.expenseManagement : current.label}</h1></div>
          <div className="top-actions">
            <button className="lang" onClick={() => changeLang(lang === 'en' ? 'fr' : 'en')}><Languages size={16} />{lang === 'en' ? 'EN' : 'FR'} <span>⌄</span></button>
            {(page === 'expenses' || page === 'overview' || page === 'income') && <button className="primary" onClick={page === 'income' ? openAddIncome : openAdd}><Plus size={17} />{page === 'income' ? t.addIncome : t.addExpense}</button>}
          </div>
        </header>
        {autoNotice > 0 && <div className="banner info" role="status">↻ {fill(t.recurringAdded, { n: autoNotice })}<button className="x" onClick={() => setAutoNotice(0)} aria-label={t.dismiss}><X size={14} /></button></div>}
        {page === 'overview' && <OverviewPage t={t} lang={lang} month={month} setMonth={setMonth} expenses={expenses} budgets={budgets} categories={categories} incomes={incomes} conversions={conversions}
          live={live} closing={closing} opening={opening} activity={recent} curOf={curOf} setCur={setCur} onRefreshLive={() => void refreshLive(true)} />}
        {page === 'expenses' && <ExpensesPage t={t} lang={lang} month={month} setMonth={setMonth} expenses={expenses} budgets={budgets} categories={categories} activity={recent}
          onAdd={openAdd} onEdit={(e) => { setEditing(e); setExpenseModal(true); }} onDelete={deleteExpense} onAddCategory={() => setCategoryModal(true)} />}
        {page === 'budget' && <BudgetPage t={t} lang={lang} month={month} setMonth={setMonth} expenses={expenses} categories={categories} budget={{ ...budget, saved: savedThisMonth }} onSave={saveBudget} onRemove={removeBudget} />}
        {page === 'income' && <IncomePage t={t} lang={lang} incomes={incomes} conversions={conversions} live={live} funds={currentFunds} curOf={curOf} setCur={setCur} onRefreshLive={() => void refreshLive(true)} onAddIncome={openAddIncome} onEditIncome={(i) => { setEditingIncome(i); setIncomeModal(true); }}
          onDeleteIncome={deleteIncome} onAddExchange={() => { setEditingExchange(null); setExchangeModal(true); }} onEditExchange={(c) => { setEditingExchange(c); setExchangeModal(true); }} onDeleteExchange={deleteExchange} />}
        {page === 'reports' && <ReportsPage t={t} lang={lang} budgets={budgets} expenses={expenses} categories={categories} incomes={incomes} live={live} curOf={curOf} setCur={setCur} onRefreshLive={() => void refreshLive(true)} />}
        {page === 'settings' && <SettingsPage t={t} lang={lang} setLang={changeLang} categories={categories} expenses={expenses} history={history} openings={openings} cloud={cloud} onSaveOpenings={saveOpenings} version={APP_VERSION}
          onAddCategory={() => setCategoryModal(true)} onDeleteCategory={deleteCategory} onBackup={() => void backup()} onRestore={(f) => void restore(f)} />}
        <footer className="footer"><span>© 2026 Family Finance Manager · v{APP_VERSION}</span><span className="local-badge">● {t.localNotice}</span></footer>
      </main>
      {expenseModal && <ExpenseModal t={t} lang={lang} categories={categories} expense={editing} onClose={() => { setExpenseModal(false); setEditing(null); }} onSave={saveExpense} />}
      {incomeModal && <IncomeModal t={t} lang={lang} income={editingIncome} onClose={() => { setIncomeModal(false); setEditingIncome(null); }} onSave={saveIncome} />}
      {exchangeModal && <ConversionModal t={t} lang={lang} conversion={editingExchange} onClose={() => { setExchangeModal(false); setEditingExchange(null); }} onSave={saveExchange} />}
      {categoryModal && <CategoryModal t={t} onClose={() => setCategoryModal(false)} onSave={addCategory} />}
    </div>
  );
}
