import { useState } from 'react';
import type { Lang, Translation } from '../lib/i18n';
import type { CloudState, useCloud } from '../lib/sync/useCloud';
import { fill } from './Common';

type Cloud = ReturnType<typeof useCloud>;
export const cloudError = (t: Translation, code: string | null) => (code ? ((t as unknown as Record<string, string>)[`cloudErr_${code}`] ?? t.cloudErr_unknown) : '');
export const statusText = (t: Translation, s: CloudState['status']) =>
  ({ loading: t.syncLoading, unconfigured: t.syncOff, signedOut: t.syncSignedOut, noFamily: t.syncNoFamily, needsLink: t.syncLink, idle: t.syncIdle, syncing: t.syncSyncing, offline: t.syncOffline, error: t.syncError })[s];

/** Everything about accounts and the shared family workspace, one step at a time. */
export default function CloudPanel({ t, lang, cloud }: { t: Translation; lang: Lang; cloud: Cloud }) {
  const { state, actions, configured } = cloud;
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [f, setF] = useState({ url: '', key: '', email: '', password: '', name: '', display: '', code: '', newPassword: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const run = async (job: Promise<string | null>, okText = '') => { const err = await job; setMsg(err ? { ok: false, text: cloudError(t, err) } : okText ? { ok: true, text: okText } : null); return !err; };
  const pastedConfig = (() => { try { return !!localStorage.getItem('ffm-cloud-config'); } catch { return false; } })();   // storage can be missing (tests) or blocked (private mode)
  const when = (iso: string | null) => (iso ? fill(t.cloudLastSync, { time: new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH') }) : t.cloudNeverSynced);
  const note = msg && <p className={msg.ok ? 'hint ok' : 'hint bad'} role="status">{msg.text}</p>;
  const fam = state.family;

  let body: React.ReactNode;
  if (state.status === 'loading') body = <p className="muted">{t.syncLoading}</p>;
  else if (!configured) {
    body = (
      <form className="cloud-form" onSubmit={(e) => { e.preventDefault(); actions.saveConfig({ url: f.url.trim(), anonKey: f.key.trim() }); }}>
        <p className="muted">{t.cloudIntro}</p>
        <label>{t.cloudUrl}<input value={f.url} onChange={set('url')} placeholder="https://xxxx.supabase.co" required pattern="https://.+" /></label>
        <label>{t.cloudKey}<input value={f.key} onChange={set('key')} required minLength={20} /></label>
        <div className="btn-row left"><button className="primary" type="submit">{t.cloudConnect}</button></div>
      </form>
    );
  } else if (state.recovery) {
    body = (
      <form className="cloud-form" onSubmit={async (e) => { e.preventDefault(); if (await run(actions.setPassword(f.newPassword), t.cloudPasswordSaved)) setF({ ...f, newPassword: '' }); }}>
        <h3 className="sub-h">{t.cloudNewPassword}</h3>
        <label>{t.cloudPassword}<input type="password" value={f.newPassword} onChange={set('newPassword')} minLength={6} required autoComplete="new-password" /></label>
        <div className="btn-row left"><button className="primary" type="submit" disabled={state.busy}>{t.cloudSavePassword}</button></div>{note}
      </form>
    );
  } else if (state.status === 'signedOut') {
    body = (
      <form className="cloud-form" onSubmit={async (e) => {
        e.preventDefault();
        if (mode === 'reset') { await run(actions.resetPassword(f.email), t.cloudResetSent); return; }
        if (mode === 'signup') { const ok = await run(actions.signUp(f.email, f.password)); if (ok) setMsg({ ok: true, text: t.cloudSignedUp }); return; }
        await run(actions.signIn(f.email, f.password));
      }}>
        <p className="muted">{t.cloudConnected}</p>
        <label>{t.cloudEmail}<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
        {mode !== 'reset' && <label>{t.cloudPassword}<input type="password" value={f.password} onChange={set('password')} minLength={6} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>}
        <div className="btn-row left">
          <button className="primary" type="submit" disabled={state.busy}>{mode === 'signup' ? t.cloudSignUp : mode === 'reset' ? t.cloudSendReset : t.cloudSignIn}</button>
          {mode !== 'signin' && <button type="button" className="outline" onClick={() => { setMode('signin'); setMsg(null); }}>{t.cloudHaveAccount}</button>}
          {mode === 'signin' && <button type="button" className="outline" onClick={() => { setMode('signup'); setMsg(null); }}>{t.cloudNoAccount}</button>}
          {mode === 'signin' && <button type="button" className="link" onClick={() => { setMode('reset'); setMsg(null); }}>{t.cloudForgot}</button>}
        </div>{note}
        {pastedConfig && <button type="button" className="link" onClick={() => actions.saveConfig(null)}>{t.cloudDisconnect}</button>}
      </form>
    );
  } else if (state.status === 'noFamily') {
    body = (
      <div className="cloud-two">
        <p className="muted full">{fill(t.cloudAccount, { email: state.email ?? '' })} · <button className="link" onClick={() => void run(actions.signOut())}>{t.cloudSignOut}</button></p>
        <form className="cloud-form" onSubmit={(e) => { e.preventDefault(); void run(actions.createFamily(f.name, f.display)); }}>
          <h3 className="sub-h">{t.cloudCreateTitle}</h3>
          <label>{t.cloudFamilyName}<input value={f.name} onChange={set('name')} maxLength={80} required /></label>
          <label>{t.cloudYourName}<input value={f.display} onChange={set('display')} maxLength={60} required /></label>
          <p className="hint">{t.cloudCreateNote}</p>
          <div className="btn-row left"><button className="primary" type="submit" disabled={state.busy}>{t.cloudCreate}</button></div>
        </form>
        <form className="cloud-form" onSubmit={(e) => { e.preventDefault(); if (confirm(t.confirmJoin)) void run(actions.joinFamily(f.code, f.display)); }}>
          <h3 className="sub-h">{t.cloudJoinTitle}</h3>
          <label>{t.cloudCode}<input value={f.code} onChange={set('code')} maxLength={20} required autoCapitalize="characters" /></label>
          <label>{t.cloudYourName}<input value={f.display} onChange={set('display')} maxLength={60} required /></label>
          <p className="hint">{t.cloudJoinNote}</p>
          <div className="btn-row left"><button className="primary" type="submit" disabled={state.busy}>{t.cloudJoin}</button></div>
        </form>
        <div className="full">{note}</div>
      </div>
    );
  } else if (state.status === 'needsLink' && fam) {
    body = (
      <div className="cloud-form">
        <h3 className="sub-h">{t.cloudLinkTitle}</h3>
        <p className="muted">{fill(t.cloudLinkText, { name: fam.name })}</p>
        <div className="btn-row left"><button className="primary" disabled={state.busy} onClick={() => { if (confirm(t.confirmJoin)) void run(actions.linkDevice()); }}>{t.cloudLink}</button>
          <button className="outline" onClick={() => void run(actions.signOut())}>{t.cloudSignOut}</button></div>{note}
      </div>
    );
  } else if (fam) {
    body = (
      <div className="cloud-form">
        <p className="muted">{fill(t.cloudAccount, { email: state.email ?? '' })} · <button className="link" onClick={() => void run(actions.signOut())}>{t.cloudSignOut}</button></p>
        <div className="sync-line"><span className={`dot ${state.status}`} /><strong>{statusText(t, state.status)}</strong><span className="muted">{when(state.lastSync)}</span>
          {state.pending > 0 && <span className="pill outside">{fill(t.cloudPending, { n: state.pending })}</span>}
          <button className="outline" onClick={actions.syncNow}>{t.cloudSyncNow}</button></div>
        {state.status === 'error' && <p className="hint bad" role="alert">{cloudError(t, state.error)}</p>}
        <h3 className="sub-h">{t.cloudFamily}: {fam.name}</h3>
        {fam.role === 'owner' && fam.invite_code && (
          <div className="code-box">
            <small>{t.cloudInvite}</small><strong className="code">{fam.invite_code}</strong>
            <div className="btn-row left">
              <button className="outline" onClick={() => { void navigator.clipboard?.writeText(fam.invite_code!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? t.cloudCopied : t.cloudCopy}</button>
              <button className="outline" onClick={() => void run(actions.regenerateInvite())}>{t.cloudRegenerate}</button>
            </div>
            <p className="hint">{t.cloudInviteHint}</p>
          </div>
        )}
        <h3 className="sub-h">{t.cloudMembers}</h3>
        {fam.members.map((m) => (
          <div className="activity-row" key={m.user_id}>
            <span className="activity-dot" /><span><strong>{m.display_name || m.email}</strong> <span className="muted">{m.display_name ? m.email : ''}</span></span>
            <small>{m.role === 'owner' ? t.cloudRole_owner : t.cloudRole_member}</small>
            {fam.role === 'owner' && m.role !== 'owner' && <button className="link" onClick={() => { if (confirm(fill(t.confirmRemoveMember, { name: m.display_name || m.email }))) void run(actions.removeMember(m.user_id)); }}>{t.cloudRemove}</button>}
          </div>
        ))}
        {note}
        <div className="btn-row left"><button className="outline" onClick={() => { if (confirm(t.confirmLeave)) void run(actions.leaveFamily()); }}>{t.cloudLeave}</button></div>
        <p className="hint">{t.cloudPrivacy}</p>
      </div>
    );
  }
  return <section className="panel cloud-panel"><div className="panel-head"><div><h2>{t.cloudTitle}</h2></div></div>{body}</section>;
}
