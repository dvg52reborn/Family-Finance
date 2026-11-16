import { restoreGate } from '../lib/backup';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Lang, Translation } from '../lib/i18n';
import { catLabel } from '../lib/i18n';
import { CURRENCIES, auditText, currencyName } from '../lib/finance';
import type { AuditRecord, Expense, ExpenseCategory } from '../types/finance';
import { fill } from '../components/Common';
import CloudPanel from '../components/CloudPanel';
import type { useCloud } from '../lib/sync/useCloud';
import type { RenewalRule } from '../lib/allowances';

type Props = {
  t: Translation; lang: Lang; setLang: (l: Lang) => void; categories: ExpenseCategory[]; expenses: Expense[]; history: AuditRecord[];
  cloud: ReturnType<typeof useCloud>; openings: Record<string, number>; onSaveOpenings: (o: Record<string, number>) => Promise<void>;
  renewal: RenewalRule; onSaveRenewal: (r: RenewalRule) => Promise<void>;
  version: string; onAddCategory: () => void; onDeleteCategory: (c: ExpenseCategory) => void; onBackup: () => void; onRestore: (file: File) => void;
};

export default function SettingsPage({ t, lang, setLang, categories, expenses, history, cloud, openings, onSaveOpenings, renewal, onSaveRenewal, version, onAddCategory, onDeleteCategory, onBackup, onRestore }: Props) {
  const gate = restoreGate(cloud.state.status, cloud.state.family?.role);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(CURRENCIES.map((c) => [c, openings[c] ? String(openings[c]) : ''])));
  const [saved, setSaved] = useState(false);
  const [rn, setRn] = useState({ enabled: renewal.enabled, useDefault: renewal.useDefault, defaultAmount: renewal.defaultAmount ? String(renewal.defaultAmount) : '' });
  const [rnSaved, setRnSaved] = useState(false);
  return (
    <>
      <p className="subtitle">{t.settingsSubtitle}</p>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.language}</h2></div>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="plain-select"><option value="en">English</option><option value="fr">Français</option></select>
        </div>
        <p className="muted small">{t.appVersion} {version}</p>
        <p className="hint">{t.installHelp}</p>
      </section>
      <CloudPanel t={t} lang={lang} cloud={cloud} />
      <section className="panel">
        <div className="panel-head"><div><h2>{t.openingBalances}</h2><p>{t.openingHint}</p></div></div>
        <form className="opening-grid" onSubmit={async (e) => {
          e.preventDefault();
          await onSaveOpenings(Object.fromEntries(CURRENCIES.map((c) => [c, Number(draft[c]) || 0])));
          setSaved(true);
        }}>
          {CURRENCIES.map((c) => <label key={c}>{currencyName(c, lang)}<input type="number" step="0.01" value={draft[c]} onChange={(e) => { setSaved(false); setDraft({ ...draft, [c]: e.target.value }); }} placeholder="0" /></label>)}
          <div className="opening-actions"><button className="primary" type="submit">{t.saveOpening}</button>{saved && <span className="hint">{t.openingSaved}</span>}</div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.renewalTitle}</h2><p>{t.renewalHint}</p></div></div>
        <form className="opening-grid" onSubmit={async (e) => {
          e.preventDefault();
          await onSaveRenewal({ enabled: rn.enabled, useDefault: rn.useDefault, defaultAmount: Number(rn.defaultAmount) || 0 });
          setRnSaved(true);
        }}>
          <label className="check full"><input type="checkbox" checked={rn.enabled} onChange={(e) => { setRnSaved(false); setRn({ ...rn, enabled: e.target.checked }); }} />{t.renewalOn}</label>
          <label className="check full"><input type="checkbox" checked={rn.useDefault} disabled={!rn.enabled} onChange={(e) => { setRnSaved(false); setRn({ ...rn, useDefault: e.target.checked }); }} />{t.renewalUseDefault}</label>
          <label>{t.renewalDefaultAmount}<input type="number" min="0" step="0.01" value={rn.defaultAmount} disabled={!rn.enabled || !rn.useDefault} onChange={(e) => { setRnSaved(false); setRn({ ...rn, defaultAmount: e.target.value }); }} placeholder="0" /></label>
          <div className="opening-actions"><button className="primary" type="submit">{t.saveRenewal}</button>{rnSaved && <span className="hint">{t.saved}</span>}</div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.categoriesTitle}</h2></div><button className="outline" onClick={onAddCategory}>+ {t.customCategory}</button></div>
        {categories.map((c) => {
          const used = expenses.filter((e) => e.categoryId === c.id).length;
          return (
            <div className="activity-row" key={c.id}>
              <span className="category-dot" style={{ background: c.color }} /><span>{catLabel(c.name, lang)}</span>
              <small>{fill(t.categoryUsage, { n: used })}</small>
              <div className="row-actions"><button title={used ? t.deleteCategoryBlocked : t.delete} disabled={used > 0} onClick={() => onDeleteCategory(c)}><Trash2 size={15} /></button></div>
            </div>
          );
        })}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.backup}</h2><p>{t.backupHint}</p></div>
          <div className="btn-row"><button className="outline" disabled={gate === 'member' || gate === 'wait'} onClick={() => fileRef.current?.click()}>{t.restoreBackup}</button><button className="primary" onClick={onBackup}>{t.exportBackup}</button></div>
        </div>
        {gate !== 'free' && <p className={gate === 'owner' ? 'hint' : 'hint bad'}>{gate === 'owner' ? t.restoreFamilyHint : gate === 'wait' ? t.restoreWait : t.restoreMemberBlocked}</p>}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestore(f); e.target.value = ''; }} />
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.fullHistory}</h2><p>{t.historyLimit}</p></div></div>
        {history.length ? history.map((a) => <div className="activity-row" key={a.id}><span className="activity-dot" /><span>{auditText(a, t, lang)}</span><small>{new Date(a.at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH')}</small></div>) : <p className="muted">{t.noActivity}</p>}
      </section>
    </>
  );
}
