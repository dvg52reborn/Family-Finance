export type Frequency = 'weekly' | 'monthly' | 'yearly';

export type ExpenseCategory = { id?: number; name: string; color: string; createdAt: string };

export type Expense = {
  id?: number;
  title: string;
  amount: number;
  currency: 'GHS';
  categoryId: number;
  date: string;
  notes: string;
  /** True only on the recurring template (the first occurrence). */
  recurring: boolean;
  recurringFrequency: Frequency | '';
  /** Template only: how many later occurrences have been generated so far. */
  generatedCount?: number;
  /** Generated occurrences only: id of the template they came from. */
  recurringParentId?: number;
  outsideBudget: boolean;
  /** Set (to 'YYYY-MM') on the automatic budget-overrun entry of that month. Managed by the app. */
  autoOverrun?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditChange = { field: string; from: string; to: string };
export type AuditRecord = {
  id?: number;
  entity: 'expense' | 'income' | 'category' | 'conversion';
  entityId: number;
  action: 'created' | 'updated' | 'deleted' | 'generated';
  /** Legacy English summary (older records only). */
  summary: string;
  /** Structured fields so history can be shown in any language. */
  title?: string;
  changes?: AuditChange[];
  at: string;
};

export type MonthlyBudget = { id?: number; month: string; amount: number; currency: 'GHS' };
/** Spending money taken from the GHS balance for a period. endDate '' = still open. amount is the current amount; spent is worked out from expenses. */
export type Allowance = { id?: number; startDate: string; endDate: string; amount: number; note: string; createdAt: string; updatedAt: string };
export type IncomeEntry = { id?: number; title: string; amount: number; currency: string; date: string; notes: string };

/** A currency exchange the family actually did: fromAmount fromCurrency became toAmount toCurrency. */
export type Conversion = { id?: number; date: string; fromCurrency: string; fromAmount: number; toCurrency: string; rate: number; toAmount: number; notes: string };
export type Setting = { key: string; value: unknown };
