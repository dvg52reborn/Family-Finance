import type { Lang } from '../lib/i18n';
import { locale } from '../lib/finance';

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const compact = (n: number, lang: Lang) => new Intl.NumberFormat(locale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Grouped monthly bars (no chart library needed). Two series: income and expenses. */
export function MonthlyBars(p: { labels: string[]; income: number[]; expenses: number[]; incomeLabel: string; expenseLabel: string; lang: Lang; title: string }) {
  const W = 720, H = 250, L = 46, B = 28, T = 10, R = 8;
  const max = niceMax(Math.max(...p.income, ...p.expenses, 0));
  const plotH = H - B - T, plotW = W - L - R, slot = plotW / p.labels.length, bw = Math.min(16, slot / 2.6);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  return (
    <div className="chart">
      <div className="legend"><span><i style={{ background: '#4ab58a' }} />{p.incomeLabel}</span><span><i style={{ background: '#f2994a' }} />{p.expenseLabel}</span></div>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.title}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#e7ecf2" />
              <text x={L - 6} y={y(max * f) + 3} textAnchor="end" fontSize="10" fill="#98a2b3">{compact(max * f, p.lang)}</text>
            </g>
          ))}
          {p.labels.map((lab, i) => {
            const cx = L + slot * i + slot / 2;
            return (
              <g key={lab}>
                <rect x={cx - bw - 1} y={y(p.income[i])} width={bw} height={Math.max(0, T + plotH - y(p.income[i]))} rx="2" fill="#4ab58a"><title>{`${lab} · ${p.incomeLabel}: ${Math.round(p.income[i])}`}</title></rect>
                <rect x={cx + 1} y={y(p.expenses[i])} width={bw} height={Math.max(0, T + plotH - y(p.expenses[i]))} rx="2" fill="#f2994a"><title>{`${lab} · ${p.expenseLabel}: ${Math.round(p.expenses[i])}`}</title></rect>
                <text x={cx} y={H - 9} textAnchor="middle" fontSize="10" fill="#98a2b3">{lab}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Horizontal bars, one per category. */
export function CategoryBars({ rows, format }: { rows: { name: string; color: string; value: number }[]; format: (n: number) => string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="cat-bars">
      {rows.map((r) => (
        <div className="cat-row" key={r.name}>
          <div className="cat-line"><span><i className="category-dot" style={{ background: r.color }} />{r.name}</span><span>{format(r.value)} · {total ? Math.round((r.value / total) * 100) : 0}%</span></div>
          <div className="progress"><i style={{ width: `${(r.value / max) * 100}%`, background: r.color }} /></div>
        </div>
      ))}
    </div>
  );
}
