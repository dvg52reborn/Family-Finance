import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { messages, type Lang } from '../src/lib/i18n';
import { fmtDate, fundsAsOf, prevMonth } from '../src/lib/finance';
import { fill } from '../src/components/Common';
import OverviewPage from '../src/pages/OverviewPage';
import ExpensesPage from '../src/pages/ExpensesPage';
import BudgetPage from '../src/pages/BudgetPage';
import IncomePage from '../src/pages/IncomePage';
import ReportsPage from '../src/pages/ReportsPage';
import SettingsPage from '../src/pages/SettingsPage';
import { statusText } from '../src/components/CloudPanel';
import type { CloudState, SyncStatus } from '../src/lib/sync/useCloud';
import type { FamilyInfo } from '../src/lib/sync/cloud';
import { ConversionModal, ExpenseModal, IncomeModal, CategoryModal } from '../src/components/Modals';

const cats = [{ id: 1, name: 'Food & groceries', color: '#f59e0b', createdAt: '' }, { id: 2, name: 'Budget overrun', color: '#d9453a', createdAt: '' }];
const mkE = (o: object) => ({ id: 1, title: 'Rice', amount: 120, currency: 'GHS' as const, categoryId: 1, date: '2026-11-03', notes: 'n', recurring: false, recurringFrequency: '' as const, outsideBudget: false, createdAt: '', updatedAt: '', ...o });
const expenses = [mkE({}), mkE({ id: 2, recurring: true, recurringFrequency: 'monthly' }), mkE({ id: 3, recurringParentId: 2 }),
  mkE({ id: 4, outsideBudget: true }), mkE({ id: 5, title: 'Budget overrun', categoryId: 2, outsideBudget: true, autoOverrun: '2026-11', amount: 160 })];
const allowances = [{ id: 1, startDate: '2026-11-01', endDate: '', amount: 200, note: 'Nov', createdAt: '', updatedAt: '' }, { id: 2, startDate: '2026-10-01', endDate: '2026-10-31', amount: 400, note: '', createdAt: '', updatedAt: '' }];
const incomes = [{ id: 1, title: 'Salary', amount: 3000, currency: 'GHS', date: '2026-11-01', notes: '' }, { id: 2, title: 'Support', amount: 100000, currency: 'XOF', date: '2026-11-02', notes: '' },
  { id: 3, title: 'Gift', amount: 50, currency: 'USD', date: '2026-11-02', notes: '' }, { id: 4, title: 'Old', amount: 5, currency: 'XOF', date: '2020-01-01', notes: '' }];
const conversions = [{ id: 1, date: '2026-11-04', fromCurrency: 'GHS', fromAmount: 100, toCurrency: 'XOF', rate: 55, toAmount: 5500, notes: 'bank' }];
const live = { rates: { USD: 1, GHS: 12, XOF: 600, EUR: 0.9, GBP: 0.8, NGN: 1500, CAD: 1.4 }, fetchedAt: '2026-11-14T10:00:00Z' };
const prefs: Record<string, string> = { 'overview.funds': 'USD', 'overview.income': 'XOF', 'income.total': 'EUR', 'income.month': 'GBP', 'income.funds': 'CAD', reports: 'NGN' };
const curOf = (k: string) => prefs[k] ?? 'GHS';
const audit = [{ id: 1, entity: 'conversion' as const, entityId: 1, action: 'created' as const, summary: '', title: '100 GHS → 5500 XOF', at: new Date().toISOString() },
  { id: 2, entity: 'expense' as const, entityId: 1, action: 'updated' as const, summary: '', title: 'Rice', at: new Date().toISOString(), changes: [{ field: 'amount', from: '1', to: '2' }] },
  { id: 3, entity: 'expense' as const, entityId: 1, action: 'created' as const, summary: 'Added “Old”', at: new Date().toISOString() }];
const fi = { openings: { GHS: 100 }, incomes, conversions, expenses, allowances };
const closing = fundsAsOf('2026-11', fi), opening = fundsAsOf(prevMonth('2026-11'), fi);
const noop = () => {}; const noopA = async () => {};

// cloud stubs: SettingsPage needs the object returned by useCloud(); one stub per status
const owner: FamilyInfo = { id: 'f1', name: 'Mensah family', role: 'owner', invite_code: 'ABCD-EFGH', members: [
  { user_id: 'u1', display_name: 'Ama', email: 'ama@example.com', role: 'owner', joined_at: '2026-11-01T00:00:00Z' },
  { user_id: 'u2', display_name: 'Kofi', email: 'kofi@example.com', role: 'member', joined_at: '2026-11-02T00:00:00Z' }] };
const member: FamilyInfo = { ...owner, role: 'member', invite_code: null };
const mkCloud = (status: SyncStatus, o: Partial<CloudState> = {}, configured = status !== 'unconfigured') => {
  const inFamily = ['idle', 'syncing', 'offline', 'error'].includes(status);
  const state: CloudState = { status, email: status === 'signedOut' || status === 'unconfigured' || status === 'loading' ? null : 'ama@example.com',
    family: inFamily || status === 'needsLink' ? owner : null, lastSync: inFamily ? '2026-11-14T10:00:00Z' : null, pending: 0, error: null, recovery: false, busy: false, ...o };
  const action = async () => null as string | null;
  return { state, configured, actions: { saveConfig: noop, signIn: action, signUp: action, signOut: action, resetPassword: action, setPassword: action, createFamily: action, joinFamily: action,
    linkDevice: action, leaveFamily: action, regenerateInvite: action, removeMember: action, syncNow: noop } };
};
const statuses: SyncStatus[] = ['loading', 'unconfigured', 'signedOut', 'noFamily', 'needsLink', 'idle', 'syncing', 'offline', 'error'];

for (const lang of ['en', 'fr'] as Lang[]) {
  const t = messages[lang];
  const out: Record<string, string> = {
    overview: renderToStaticMarkup(<OverviewPage t={t} lang={lang} month="2026-11" setMonth={noop} expenses={expenses} allowances={allowances} categories={cats} incomes={incomes} conversions={conversions} live={live} closing={closing} opening={opening} activity={audit} curOf={curOf} setCur={noop} onRefreshLive={noop} />),
    expenses: renderToStaticMarkup(<ExpensesPage t={t} lang={lang} month="2026-11" setMonth={noop} expenses={expenses} allowances={allowances} categories={cats} activity={audit} onAdd={noop} onEdit={noop} onDelete={noop} onAddCategory={noop} />),
    budget: renderToStaticMarkup(<BudgetPage t={t} lang={lang} month="2026-11" setMonth={noop} expenses={expenses} categories={cats} allowances={allowances} today="2026-11-14" onCreate={async () => 'ok' as const} onChangeAmount={async () => 'ok' as const} onSetEnd={async () => 'ok' as const} onDelete={noopA} />),
    income: renderToStaticMarkup(<IncomePage t={t} lang={lang} incomes={incomes} conversions={conversions} live={live} funds={closing} curOf={curOf} setCur={noop} onRefreshLive={noop} onAddIncome={noop} onEditIncome={noop} onDeleteIncome={noop} onAddExchange={noop} onEditExchange={noop} onDeleteExchange={noop} />),
    reports: renderToStaticMarkup(<ReportsPage t={t} lang={lang} allowances={allowances} expenses={expenses} categories={cats} incomes={incomes} live={live} curOf={curOf} setCur={noop} onRefreshLive={noop} />),
    settings: renderToStaticMarkup(<SettingsPage t={t} lang={lang} setLang={noop} categories={cats} expenses={expenses} history={audit} cloud={mkCloud('idle')} openings={{ GHS: 100 }} onSaveOpenings={noopA} renewal={{ enabled: true, useDefault: false, defaultAmount: 0 }} onSaveRenewal={noopA} version="0.7.0" onAddCategory={noop} onDeleteCategory={noop} onBackup={noop} onRestore={noop} />),
    modals: [<ExpenseModal key="a" t={t} lang={lang} categories={cats} expense={expenses[1]} onClose={noop} onSave={noopA} />, <ExpenseModal key="b" t={t} lang={lang} categories={cats} expense={expenses[2]} onClose={noop} onSave={noopA} />,
      <IncomeModal key="c" t={t} lang={lang} income={incomes[0]} onClose={noop} onSave={noopA} />, <ConversionModal key="d" t={t} lang={lang} conversion={conversions[0]} onClose={noop} onSave={noopA} />,
      <ConversionModal key="e" t={t} lang={lang} conversion={null} onClose={noop} onSave={noopA} />, <CategoryModal key="f" t={t} onClose={noop} onSave={noopA} />].map((m) => renderToStaticMarkup(m)).join(''),
  };
  for (const [name, html] of Object.entries(out)) {
    assert.ok(html.length > 200, `${lang}/${name} too short`);
    assert.ok(!/undefined|NaN|\[object|\{[a-z]+\}/.test(html), `${lang}/${name} has undefined/NaN/unfilled placeholder: ${html.match(/.{30}(undefined|NaN|\[object|\{[a-z]+\}).{30}/)?.[0]}`);
  }
  // expenses page: in-budget capped at budget (200), out-of-budget = 120 + 160 overrun-from-sync row is NOT double counted: analytic overrun used
  assert.ok(out.expenses.includes(t.inBudgetSpent) && out.expenses.includes(t.outBudgetSpent) && out.expenses.includes(t.monthTotal), 'three totals shown');
  assert.ok(out.expenses.includes(t.overrunTitle), 'overrun row labelled');
  assert.ok(out.overview.includes(t.fundsByCurrency) && out.overview.includes(t.monthMovement) && out.overview.includes('USD'), 'overview sections');
  assert.ok(out.income.includes(t.currencyExchanges) && out.income.includes('bank'), 'exchange table');
  assert.ok(out.settings.includes(t.openingBalances), 'opening balances');
  assert.ok(out.settings.includes(t.renewalTitle) && out.settings.includes(t.renewalOn) && out.settings.includes(t.saveRenewal), 'renewal settings');
  assert.ok(out.budget.includes(t.newAllowance) && out.budget.includes(t.alwTable), 'budget page: new allowance button and record table');
  for (const h of [t.alwStarted, t.alwCompleted, t.alwAmount, t.alwSpent, t.alwLeft, t.alwStatus, t.alwNote]) assert.ok(out.budget.includes(`<th>${h}</th>`), `budget table column ${h}`);
  assert.ok(out.budget.includes(t.alwActive) && out.budget.includes(t.alwClosed) && out.budget.includes(t.alwOpenEnd), 'status and open end shown');
  assert.ok(out.budget.includes(t.alwChangeAmount), 'the active allowance can have its amount changed');
  assert.ok(out.overview.includes(fill(t.alwFromDate, { start: fmtDate('2026-11-01', lang) })), 'overview shows the allowance start date (no end date set)');
  assert.ok(out.expenses.includes(fill(t.alwFromDate, { start: fmtDate('2026-11-01', lang) })), 'expenses page shows the allowance start date');
  const selects = (html: string) => (html.match(/class="cur-select"/g) || []).length;
  assert.equal(selects(out.overview), 2, 'overview: separate selectors for total funds and income');
  assert.equal(selects(out.income), 3, 'income: separate selectors for total income, income this month and total funds');
  assert.equal(selects(out.reports), 1, 'reports: one selector');
  assert.ok(out.overview.includes('<option value="USD" selected') || /<option value="USD" selected=""/.test(out.overview), 'funds card remembers USD');
  assert.ok(out.overview.includes(t.totalFunds) && out.income.includes(t.totalFunds), 'total funds card');
  assert.ok(!out.income.includes(t.incomeEntries) && !out.income.includes('<span>' + t.currencyExchanges + '</span>'), 'entry counters removed from income tab');
  assert.ok(out.income.includes('class="stats three"'), 'three cards');
  // funds panels list currencies separately and never show an approximate value inside a balance card
  assert.ok(!/class="balance"[^>]*>(?:(?!<\/div>).)*≈/.test(out.overview), 'balance cards are not mixed');
  assert.ok(out.reports.includes('NGN'), 'report currency applied');
  assert.ok(out.overview.includes(t.liveRatesUpdated.split('{')[0].trim()), 'live-rate timestamp shown');
  assert.ok(out.reports.includes('<svg'), 'chart rendered');

  // cloud section of Settings: every status renders, with no undefined/NaN/unfilled placeholder
  const page = (cloud: ReturnType<typeof mkCloud>) => renderToStaticMarkup(<SettingsPage t={t} lang={lang} setLang={noop} categories={cats} expenses={expenses} history={audit} cloud={cloud} openings={{ GHS: 100 }} onSaveOpenings={noopA} renewal={{ enabled: true, useDefault: false, defaultAmount: 0 }} onSaveRenewal={noopA} version="0.8.0" onAddCategory={noop} onDeleteCategory={noop} onBackup={noop} onRestore={noop} />);
  const bad = /undefined|NaN|\[object|\{[a-z]+\}/;
  const cloudHtml: Record<string, string> = {};
  for (const st of statuses) {
    const html = cloudHtml[st] = page(mkCloud(st));
    assert.ok(html.includes(t.cloudTitle), `${lang}/${st}: cloud panel title`);
    assert.ok(!bad.test(html), `${lang}/${st}: undefined/NaN/placeholder: ${html.match(/.{30}(undefined|NaN|\[object|\{[a-z]+\}).{30}/)?.[0]}`);
  }
  cloudHtml.recovery = page(mkCloud('signedOut', { recovery: true }));
  cloudHtml.owner = page(mkCloud('idle', { pending: 3 }));
  cloudHtml.member = page(mkCloud('idle', { family: member }));
  cloudHtml.errorShown = page(mkCloud('error', { error: 'invalid_code' }));
  cloudHtml.unknownError = page(mkCloud('error', { error: 'something_new' }));
  for (const [k, html] of Object.entries(cloudHtml)) assert.ok(!bad.test(html), `${lang}/${k}: undefined/NaN/placeholder`);
  assert.ok(cloudHtml.unconfigured.includes(t.cloudConnect) && cloudHtml.unconfigured.includes(t.cloudUrl), 'unconfigured: shows how to connect');
  assert.ok(cloudHtml.signedOut.includes(t.cloudSignIn) && cloudHtml.signedOut.includes(t.cloudEmail), 'signed out: sign-in form');
  assert.ok(cloudHtml.recovery.includes(t.cloudNewPassword) && !cloudHtml.recovery.includes(t.cloudSignIn), 'recovery: new-password form only');
  assert.ok(cloudHtml.noFamily.includes(t.cloudCreateTitle) && cloudHtml.noFamily.includes(t.cloudJoinTitle), 'no family: create and join');
  assert.ok(cloudHtml.needsLink.includes(t.cloudLinkTitle) && cloudHtml.needsLink.includes('Mensah family'), 'needs link: names the family');
  for (const st of ['idle', 'syncing', 'offline', 'error'] as const) assert.ok(cloudHtml[st].includes(statusText(t, st)), `${lang}/${st}: status text`);
  assert.ok(cloudHtml.owner.includes('ABCD-EFGH') && cloudHtml.owner.includes(t.cloudRegenerate) && cloudHtml.owner.includes(t.cloudRemove), 'owner sees invite code and can remove members');
  assert.ok(cloudHtml.owner.includes(fill(t.cloudPending, { n: 3 })), 'pending changes shown');
  assert.ok(!cloudHtml.member.includes('ABCD-EFGH') && !cloudHtml.member.includes(t.cloudRegenerate) && !cloudHtml.member.includes(t.cloudRemove), 'member sees no invite code and cannot remove');
  // restore button while synced: members cannot, the owner is warned, a device without a family is unchanged
  const restoreBtn = (html: string) => html.match(/<button[^>]*>[^<]*<\/button>/g)!.find((b) => b.includes(t.restoreBackup))!;
  assert.ok(restoreBtn(cloudHtml.member).includes('disabled') && cloudHtml.member.includes('class="hint bad"'), 'member: restore disabled and explained');
  assert.ok(!restoreBtn(cloudHtml.owner).includes('disabled') && cloudHtml.owner.includes('hint'), 'owner: restore allowed');
  assert.ok(cloudHtml.owner.includes(t.restoreFamilyHint.slice(0, 30)), 'owner: family warning shown');
  for (const st of ['unconfigured', 'signedOut', 'noFamily', 'needsLink']) assert.ok(!restoreBtn(cloudHtml[st]).includes('disabled') && !cloudHtml[st].includes(t.restoreFamilyHint.slice(0, 30)), `${st}: restore unchanged`);
  assert.ok(restoreBtn(cloudHtml.loading).includes('disabled'), 'loading: restore waits');
  assert.ok(cloudHtml.errorShown.includes(t.cloudErr_invalid_code), 'known error is translated');
  assert.ok(cloudHtml.unknownError.includes(t.cloudErr_unknown), 'unknown error falls back to the generic message');
}
const fr = messages.fr;
const frOverview = renderToStaticMarkup(<OverviewPage t={fr} lang="fr" month="2026-11" setMonth={noop} expenses={expenses} allowances={allowances} categories={cats} incomes={incomes} conversions={conversions} live={null} closing={closing} opening={opening} activity={audit} curOf={curOf} setCur={noop} onRefreshLive={noop} />);
assert.ok(frOverview.includes('Fonds totaux') && frOverview.includes('taux du marché en direct ne peuvent pas') && frOverview.includes('Modification · dépense') && frOverview.includes('Ajout · échange'), 'French overview');
assert.ok(frOverview.includes('Création') === false);
console.log('render tests passed (en + fr)');
