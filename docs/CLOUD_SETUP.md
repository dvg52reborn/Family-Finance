# Cloud setup (Supabase) — Family Finance Manager 1.0.0

Cloud sync is optional. Without it the app works exactly as before, with the data on one device. With it, everyone in the family signs in and sees the same data on every phone, tablet and computer, and edits made offline are sent when the device is back online.

You need: a free account at https://supabase.com, and about 15 minutes. You do this **once**; family members only create an account and join.

> **Not tested against a real Supabase project by the author.** The sync logic and the SQL were tested with simulated servers and a real Postgres database, but never with Supabase itself. Please run the checklist in section 7 with your own project before you trust it with real family data, and keep a backup (Settings > Backup).

## 1. Create the project
1. Sign in at supabase.com and choose **New project**.
2. Give it a name (for example `family-finance`), choose a region close to you, and set a database password. Save the password somewhere safe; the app does not need it.
3. Wait until the project says it is ready.

## 2. Create the tables and rules
1. In the Supabase dashboard open **SQL Editor** and choose **New query**.
2. Open `supabase/setup.sql` from this project, copy **the whole file**, paste it, and press **Run**.
3. It should finish without errors. It is safe to run again later: it only adds what is missing.

This creates the family, member and record tables, the rules that let a signed-in person read only their own family's records, and the functions the app calls.

## 3. Authentication settings
In **Authentication** (menu names change from time to time; look for the Email sign-in settings):

- **Email sign-in must be on** (it is by default).
- **Turn off "Confirm email"** for the simplest setup. Otherwise every new account must click a link in an e-mail before it can sign in, and the e-mail may be slow (see "E-mail limits" below).
- **URL configuration**: set the **Site URL** to the address where you host the app (the https link you share with the family), and add the same address under **Redirect URLs**. The password-reset e-mail sends people back to the app's address; if this is not set, the link may open a wrong page.

With "Confirm email" off, anyone could create an account with any e-mail address, but an account without an invite code sees no family data. Once everyone in the family has an account you can also switch off **new sign-ups** in the same area if you want to be stricter.

## 4. Connect the app to your project
You need two values, from **Project Settings > API** (also shown as "API keys"):
- **Project URL**, like `https://abcdxyz.supabase.co`
- the **anon public** key (newer projects may call it the **publishable** key)

Use only these. **Never put the `service_role` / secret key in the app.** The anon/publishable key is designed to be public; the access rules from step 2 are what protect the data.

Pick one way:

**A. config.json (best for sharing a link).** Copy `public/config.example.json` to `public/config.json`, fill in the two values, then `npm run build`. Or, after building, put a file called `config.json` next to `index.html` inside `dist`:

    { "supabaseUrl": "https://abcdxyz.supabase.co", "supabaseAnonKey": "your-anon-key" }

Then everyone who opens your link is already connected.

**B. Paste in the app.** Open the app, go to **Settings > Family sync**, paste the URL and key, and press Connect. This is stored on that device only; use it for testing, or when you cannot edit the hosted files.

The app looks in this order: values pasted in the app, then `config.json`, then build-time variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Values must start with `https://`.

## 5. First use
**First device (the owner)**
1. Settings > Family sync > **Create account** (e-mail and password), then sign in.
2. Under **Create a family**, enter a family name and your name and press **Create family**.
3. **This device's data becomes the family's data.** If you have data from version 0.7.1, bring it in *before* this step (see section 6).
4. Copy the **invite code** shown to the owner.

**Every other device or person**
1. Open the same app link, create an account, sign in.
2. Under **Join with an invite code**, enter the code and your name and press **Join**.
3. **The family's data replaces whatever is on that device.** The app asks you to confirm.

**Same person, another device:** sign in with the same account and press **Link this device** (the family's data replaces what is on that device).

Rules: one family per account; the owner can generate a new invite code and remove members; members can leave at any time; the owner can only leave after the other members are removed, and **an owner who leaves alone deletes the family and all its records from the cloud** (the copies on devices stay).

## 6. Moving data from 0.7.1
Version 0.8.0 uses a new local database, so nothing moves by itself.
1. In 0.7.1: **Settings > Backup**, save the file.
2. In 0.8.0: **Settings > Restore backup**, choose the file. Old backups are converted on the way in.
3. Check the data, **then** create the family (section 5), so the family starts with the right data.

## 7. Test it with your project (please do this)
1. Sign up and sign in on device A. Create a family.
2. Add an expense on A. Open the app on device B, sign up, join with the code. The expense appears on B.
3. Add an expense on B. It appears on A within a few seconds (or press **Sync now**).
4. Put B in airplane mode, add and edit entries, reconnect. They appear on A.
5. Edit the same entry on both devices while one is offline; the later edit should win after reconnecting.
6. Delete an entry on A; it disappears on B.
7. Reload both. Nothing changes or duplicates.
8. Try "Forgot password" and check that the link returns to the app.

If something fails, note which step and what the app showed, and report it.

## E-mail limits
Supabase's built-in e-mail sender is **rate limited** (only a few e-mails per hour for the whole project) and is meant for testing. Password-reset e-mails can therefore be slow or temporarily refused ("Too many attempts"). For a family this is usually fine; if it becomes a problem you can connect your own e-mail service in Supabase (Authentication > SMTP settings), or reset the password from the Supabase dashboard (Authentication > Users). With "Confirm email" off, sign-up needs no e-mail at all.

## What to know before relying on it
- **Not end-to-end encrypted.** The data is stored in your own Supabase project. Only signed-in members of the family can read it through the app, but you (as project owner) and Supabase can see it in the dashboard.
- **Last edit wins**, decided by each device's clock. A phone with a badly wrong date or time can overwrite newer edits or lose its own. Keep automatic date and time on.
- **Offline first.** Every device keeps a full local copy and works without internet. Changes wait on the device ("pending") until it can sync. If a device is cleared before it has synced, those pending changes are lost.
- **Deleting is shared.** Deleting an entry on one device deletes it for everyone.
- **Restoring a backup while synced replaces the data for the whole family.** Only the owner can do it (the button is disabled for members). The app warns the owner, downloads a **safety backup** of the current data automatically (`family-finance-safety-backup-<date-time>.json`), and asks the owner to confirm the file is in the Downloads folder before anything is replaced. To undo a restore, restore that safety file the same way. Ask the other members to open the app online and let it sync before you restore. A device that is not in a family (or has left it) can restore its own data as before.
- **Free projects can be paused** by Supabase after a period of inactivity. Check Supabase's current rules and keep a backup now and then.
- Keep **regular backups** (Settings > Backup). They are your safety net against mistakes, which sync would otherwise copy to every device.

## Messages you may see
| Message | What to do |
|---|---|
| Wrong email or password | Check both; use "Forgot password" if needed |
| An account with this email already exists | Sign in instead |
| Confirm your email first | Turn off "Confirm email" (section 3) or click the link in the e-mail |
| Too many attempts | Wait a few minutes (e-mail limits above) |
| That invite code is not valid | Ask the owner for the current code; it changes when regenerated |
| Your session expired | Sign in again |
| No internet connection | Nothing is lost; the app syncs when you are back online |

## Upgrading a project that was set up before allowances

If your Supabase project was created with an older `supabase/setup.sql`, run `supabase/add-allowances.sql` once in the SQL editor
before any device syncs with the allowances version. Without it, Supabase refuses allowance records and sync reports an error.
Projects created with the current `setup.sql` already have it. The script is safe to run more than once.
