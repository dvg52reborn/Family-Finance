# Family Finance Manager v0.8.0

React + TypeScript + Vite. Data is stored on this device (IndexedDB via Dexie). Optional family sync through your own Supabase project (0.8.0).

    npm install
    npm run dev       # development
    npm run build     # type-check + production build
    npm test          # funds, recurring, budgets, rates, fresh database, backups, cloud config, sync, SQL, EN/FR rendering

## Family funds (new in 0.5.0)
Funds are the lump sum the family owns, per currency, carried over from month to month and allowed to go negative.

    funds(currency) = opening balance + income - exchanged out + exchanged in - spending (GHS)

- **Opening balances** are entered per currency in Settings.
- **Income** belongs to its month; the funds it creates carry over.
- **Exchanges** (Income page): amount + currency, destination currency, rate (or online rate). The amount received is calculated; the source currency is reduced and the destination currency increased.
- **Out-of-budget expenses** come straight off the funds.
- **Monthly budget** is set aside from the funds for the current month. When the month is over, only what was really spent stays spent: the unspent part returns to the funds.
- **Budget overrun**: spending above the monthly budget is added to the expenses table automatically as an out-of-budget "Budget overrun" entry and comes off the funds. It updates itself when expenses or the budget change.

## Pages
- **Overview**: family funds, funds by currency, monthly movement (opening, income, exchanges, spending, closing), budget progress, top categories, recent activity.
- **Expenses**: in-budget, out-of-budget and total monthly expenses, budget remaining.
- **Budget, Reports, Settings**: as in 0.4.0, plus opening balances.

Currencies: GHS, XOF, USD, EUR, GBP, NGN, CAD.

## Rates (0.6.0)
- **Exchange table** (Income page): only the rate the family typed (or filled in with "Use online rate" and may edit) on that row. The amount received is `amount x rate`; funds never use any other rate for exchanges.
- **Every other conversion** (income totals, total funds, report figures) uses **live market rates** (open.er-api.com, quoted against USD, crossed for any pair). They are cached for offline use and refreshed every 30 minutes, or with "Refresh live rates". If live rates are unavailable, amounts in other currencies are left out of converted figures and a notice is shown; nothing is guessed.
- **Selectors**: each converted figure has its own currency selector (Overview: total funds, income this month; Income: total income, income this month, total funds). Reports uses one selector for the whole report so that income, expenses and net add up. Each choice is remembered.
- Funds are always listed per currency; "Total funds" is the only combined figure.

## Fresh start and backups
0.8.0 uses a new database (`family-finance-manager-v7`); data stored in the browser by earlier versions is not read automatically, and the old database is left untouched (clear the site data to remove it).
To bring old data in on purpose, use **Settings > Restore backup** with a backup file from any earlier version (0.4 onward, including 0.7.1). Old files are converted on the way in: saved exchange rates are skipped (the app now uses live market rates), every record gets a new unique id (links between records are kept), and recurring expenses that fell due since the backup are created. Restoring replaces the data on the device. Damaged files and files from a newer version are rejected without changing anything. Backups made by 0.8.0 use format 7.

Records no longer use the numbers 1, 2, 3...: ids are unique, so data from several devices can never collide. Built-in categories keep ids 1-6 (the "Budget overrun" category is 7), and generated records (recurring occurrences, budget overruns, one budget per month) get the same id on every device, so two devices never create duplicates of them.

## Run it on any device (0.7.0)
The app is an installable web app (PWA): it works offline after the first visit and can be added to the home screen.

1. `npm install` then `npm run build`. The `dist` folder is the whole app and works from any address or sub-folder.
2. Put `dist` on any static host, for example drag the folder onto https://app.netlify.com/drop, or use Cloudflare Pages, Vercel or GitHub Pages. You get an https link to share.
3. Open the link on each device. Chrome, Edge and Android show "Install app" in the sidebar; on iPhone/iPad use Share, then "Add to Home Screen".

Installing and offline use need https (localhost is fine for testing). Without cloud sync each device keeps its own data; use backup/restore to move data between devices.

## Family sync (0.8.0)
Optional. Everyone signs in with e-mail and password; one family per account; the owner shares an invite code; members join with it.

- **Cloud**: your own free Supabase project. Setup takes about 15 minutes and is described step by step in [docs/CLOUD_SETUP.md](docs/CLOUD_SETUP.md): create the project, run `supabase/setup.sql`, turn off "Confirm email", then give the app the project URL and anon key through `public/config.json` (see `public/config.example.json`) or by pasting them in **Settings > Family sync**.
- **Offline first**: every device keeps a full local copy (IndexedDB) and works without internet. Local edits are sent when the device is online; changes from other devices arrive within seconds (live updates, with a periodic safety check).
- **Last edit wins**: if two devices change the same record, the later edit is kept. "Later" is judged by each device's clock, so a phone with a badly wrong date or time can lose or overwrite edits.
- **Joining replaces local data**: a device that joins (or links to) a family gets the family's data instead of its own. The first device that creates the family brings its data in.
- **Roles**: the owner can regenerate the invite code and remove members; members can leave.
- **Restoring a backup while synced**: a restore replaces the data of every device in the family, so only the **owner** can do it; for members the button is disabled. The owner first gets a warning, then the app **automatically downloads a safety backup** of the current data (`family-finance-safety-backup-<date-time>.json`), then asks the owner to confirm that the file is in the Downloads folder. Only then is the data replaced. To undo, restore the safety backup the same way. Ask members to sync before a restore: edits a member made offline and had not yet sent may survive or be overwritten, depending on the device clocks. A device that is not linked to a family restores as always.
- **Privacy**: data is stored in your Supabase project and readable through the app only by signed-in members of the family. It is **not end-to-end encrypted**; the project owner and Supabase can see it in the dashboard.
- **E-mail limits**: Supabase's built-in e-mail sender allows only a few e-mails per hour, so password-reset e-mails may be slow or refused. With "Confirm email" off, sign-up needs no e-mail.

**How it was tested.** The sync engine runs against simulated servers (two devices, offline edits, deletes, clock skew, paging, convergence). `supabase/setup.sql` runs on a real Postgres (PGlite) in `tests/sql.test.ts`. **Nothing has been run against a real Supabase project or in a real browser**; follow the checklist in docs/CLOUD_SETUP.md with your own project before relying on it, and keep regular backups.

**How it was tested (restore).** The rule "who may restore" is unit-tested, the Settings button is render-tested for owner, member and not-linked devices, and a two-device test checks that a restore reaches the other device and that restoring the safety backup brings everything back. The confirmation dialogs and the file download themselves have not been tried in a browser.

**Upgrading from 0.7.1**: download a backup in 0.7.1, restore it in 0.8.0 (Settings > Restore backup), check it, then create the family.

## Project layout
- `src/lib/db.ts` database and ids; `src/lib/finance.ts` funds, budgets, recurring; `src/lib/backup.ts` backup format 7 and import of older files
- `src/lib/sync/` `engine.ts` (hook-free sync engine), `cloud.ts` (config, Supabase calls, error mapping), `useCloud.ts` (React hook)
- `src/components/CloudPanel.tsx` sign in, family, members, invite code; sync badge in the sidebar
- `supabase/setup.sql` tables, access rules and functions
- `tests/` run with `npm test`: logic, fresh, backup, cloud, sync, sql, render

## Roadmap
Polish after real-world testing of sync is next.
