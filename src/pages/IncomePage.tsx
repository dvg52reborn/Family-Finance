import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Lang, Translation } from '../lib/i18n';
import { fundsIn, incomeIn, money, thisMonth } from '../lib/finance';
import { liveRate, type LiveRates } from '../lib/liveRates';
import type { Conversion, IncomeEntry } from '../types/finance';
import { BalanceCards, CurrencySelect, LiveRatesNotice, LiveStamp, fill } from '../components/Common';

type Props = {
  t: Translation; lang: Lang; incomes: IncomeEntry[]; conversions: Conversion[]; live: LiveRates; funds: Record<string, number>;
  curOf: (key: string) => string; setCur: (key: string, c: string) => void; onRefreshLive: () => void;
  onAddIncome: () => void; onEditIncome: (i: IncomeEntry) => void; onDeleteIncome: (i: IncomeEntry) => void;
  onAddExchange: () => void; onEditExchange: (c: Conversion) => void; onDeleteExchange: (c: Conversion) => void;
};

export default function IncomePage({ t, lang, incomes, conversions, live, funds, curOf, setCur, onRefreshLive, onAddIncome, onEditIncome, onDeleteIncome, onAddExchange, onEditExchange, onDeleteExchange }: Props) {
  const totalCur = curOf('income.total'), monthCur = curOf('income.month'), fundsCur = curOf('income.funds');
  const sum = (cur: string, pick: (i: IncomeEntry) => boolean) => {
    const rows = incomes.filter(pick).map((i) => incomeIn(i, cur, live));
    return { total: rows.reduce<number>((s, v) => s + (v ?? 0), 0), missing: rows.filter((v) => v === null).length };
  };
  const all = sum(totalCur, () => true);
  const now = sum(monthCur, (i) => i.date.startsWith(thisMonth()));
  const fundsTotal = fundsIn(funds, fundsCur, live);
  const num = (n: number) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH', { maximumFractionDigits: 6 });
  const sorted = [...conversions].sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  const note = (missing: number, fallback: string) => (missing ? fill(t.entriesWithoutRate, { n: missing }) : fallback);
  return (
    <>
      <p className="subtitle">{t.incomeSubtitle}</p>
      <LiveRatesNotice t={t} live={live} onRetry={onRefreshLive} />
      <section className="stats three">
        <div className="stat-card"><div className="stat-top"><span>{t.totalIncome}</span><CurrencySelect t={t} value={totalCur} onChange={(c) => setCur('income.total', c)} /></div><strong>{money(all.total, lang, totalCur)}</strong><small>{note(all.missing, t.convertedNote)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.incomeThisMonth}</span><CurrencySelect t={t} value={monthCur} onChange={(c) => setCur('income.month', c)} /></div><strong>{money(now.total, lang, monthCur)}</strong><small>{note(now.missing, t.convertedNote)}</small></div>
        <div className="stat-card"><div className="stat-top"><span>{t.totalFunds}</span><CurrencySelect t={t} value={fundsCur} onChange={(c) => setCur('income.funds', c)} /></div>
          <strong className={fundsTotal.total < 0 ? 'neg' : ''}>{money(fundsTotal.total, lang, fundsCur)}</strong>
          <small>{fundsTotal.missing.length ? fill(t.notConverted, { list: fundsTotal.missing.join(', ') }) : fill(t.sumConverted, { cur: fundsCur })}</small></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.fundsByCurrency}</h2><p>{t.fundsHint}</p></div></div>
        <BalanceCards lang={lang} funds={funds} />
        <LiveStamp t={t} lang={lang} live={live} />
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.incomeLedger}</h2><p>{t.incomeRecordsOriginalCurrency}</p></div><button className="primary" onClick={onAddIncome}><Plus size={16} />{t.addIncome}</button></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.source}</th><th>{t.date}</th><th>{t.amount.replace(' (GHS)', '')}</th><th>{t.currency}</th><th>{fill(t.approxValue, { cur: totalCur })}</th><th>{t.notes}</th><th></th></tr></thead>
            <tbody>
              {incomes.map((i) => {
                const v = incomeIn(i, totalCur, live);
                const r = i.currency === totalCur ? null : liveRate(i.currency, totalCur, live);
                return (
                  <tr key={i.id}>
                    <td><strong>{i.title}</strong></td><td>{i.date}</td>
                    <td className="amount">{money(i.amount, lang, i.currency)}</td>
                    <td><span className="category-chip">{i.currency}</span></td>
                    <td>{v === null ? <span className="muted">—</span> : <>{money(v, lang, totalCur)}{r && <small className="muted block">{t.rateUsed}: {num(r)}</small>}</>}</td>
                    <td>{i.notes || '—'}</td>
                    <td><div className="row-actions"><button title={t.edit} onClick={() => onEditIncome(i)}><Pencil size={15} /></button><button title={t.delete} onClick={() => onDeleteIncome(i)}><Trash2 size={15} /></button></div></td>
                  </tr>
                );
              })}
              {!incomes.length && <tr><td colSpan={7} className="empty"><strong>{t.noIncomeEntries}</strong><button className="primary" onClick={onAddIncome}>{t.addIncome}</button></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{t.currencyExchanges}</h2><p>{t.exchangesHint}</p></div><button className="primary" onClick={onAddExchange}><Plus size={16} />{t.addExchange}</button></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.date}</th><th>{t.exchangeFrom}</th><th>{t.rate}</th><th>{t.receivedAmount}</th><th>{t.notes}</th><th></th></tr></thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={x.id}>
                  <td>{x.date}</td>
                  <td className="amount">{money(x.fromAmount, lang, x.fromCurrency)}</td>
                  <td>{fill(t.rateLine, { from: x.fromCurrency, rate: num(x.rate), to: x.toCurrency })}</td>
                  <td className="amount">{money(x.toAmount, lang, x.toCurrency)}</td>
                  <td>{x.notes || '—'}</td>
                  <td><div className="row-actions"><button title={t.edit} onClick={() => onEditExchange(x)}><Pencil size={15} /></button><button title={t.delete} onClick={() => onDeleteExchange(x)}><Trash2 size={15} /></button></div></td>
                </tr>
              ))}
              {!sorted.length && <tr><td colSpan={6} className="empty"><strong>{t.noExchanges}</strong><button className="primary" onClick={onAddExchange}>{t.addExchange}</button></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
