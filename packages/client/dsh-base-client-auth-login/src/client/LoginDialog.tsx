/** Local-account flow composed from the pinned official DSH dialog and form atoms. */
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, LinkIconRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { loginCopy } from './locales.ts';
import { dialogCopy } from './dialog-locales.ts';
import { emailCopy } from './email-locales.ts';
import { emailCallbackURL, resetTokenFromURL, withoutEmailToken } from './email-flow.ts';
import { readAuthPolicy, LOADING_AUTH_POLICY } from './registration-policy.ts';
import type { LoginRequest } from './request.ts';
import { loginNavigation } from './login-navigation.ts';
import { loginReturnPath } from './return-url.ts';
import { conversionConsentHeaders } from '@dsh-base/client-google-analytics/consent';

export interface LoginDialogProps {
  readonly mode?: LoginRequest['mode'];
  readonly next?: string | null;
  readonly onSignedIn: () => void;
  readonly onClose: () => void;
}
type Step = 'identifier' | 'password' | 'register' | 'forgot-password' | 'reset-password' | 'verification';

export function LoginSurface({ mode, next, onSignedIn, onClose }: LoginDialogProps) {
  const { locale } = loginNavigation(new URL(location.href), document.documentElement.lang || navigator.language);
  const copy = loginCopy(locale), words = dialogCopy(locale), mail = emailCopy(locale);
  const [policy, setPolicy] = useState(LOADING_AUTH_POLICY);
  const [initialURL] = useState(() => new URL(location.href));
  const initialMode = mode ?? initialURL.searchParams.get('mode');
  const [step, setStep] = useState<Step>(initialMode === 'register' || initialMode === 'forgot-password' || initialMode === 'reset-password' ? initialMode : 'identifier');
  const [resetToken, setResetToken] = useState(() => initialMode === 'reset-password' ? resetTokenFromURL(initialURL) : undefined);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => initialURL.searchParams.get('verified') === '1' ? mail.verified : null);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController>();
  const id = useId();
  const register = step === 'register';
  const registrationAllowed = policy.registration === 'enabled';
  const recovery = step === 'forgot-password', resetting = step === 'reset-password', verification = step === 'verification';
  const mailStep = recovery || resetting || verification;
  const mailAllowed = verification ? policy.emailVerificationEnabled : policy.passwordResetEnabled;
  const policyReason = policy.registration === 'loading' ? copy.checkingPolicy : policy.registration === 'unavailable' ? copy.policyUnavailable : copy.registrationClosed;
  const mailReason = policy.registration === 'loading' ? copy.checkingPolicy : mail.unavailable;
  const clearToken = (finish = false) => history.replaceState(history.state, '', withoutEmailToken(new URL(location.href), finish));

  useEffect(() => {
    const controller = new AbortController();
    // Retain a reset credential in component memory, never in subsequent history/referrers.
    if (initialURL.searchParams.has('token')) clearToken();
    void readAuthPolicy(fetch, controller.signal).then(value => { if (!controller.signal.aborted) setPolicy(value); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (step === 'password' || step === 'reset-password') passwordInput.current?.focus();
  }, [step]);
  const changeStep = (next: Step) => {
    if (step === 'reset-password' && next !== step) { setResetToken(undefined); clearToken(true); }
    setStep(next); setPassword(''); setConfirmation(''); setError(null); setNotice(null);
  };
  const close = () => { request.current?.abort(); setResetToken(undefined); clearToken(true); onClose(); };

  const submit = async () => {
    if (busy || (register && !registrationAllowed) || (mailStep && !mailAllowed) || (resetting && !resetToken)) return;
    if (step === 'identifier') { setStep('password'); return; }
    if (resetting && password !== confirmation) { setError(mail.mismatch); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = identifier.trim();
      const endpoint = recovery ? '/api/auth/request-password-reset' : resetting ? '/api/auth/reset-password' : verification ? '/api/auth/send-verification-email'
        : register ? '/api/auth/sign-up/email' : value.includes('@') ? '/api/auth/sign-in/email' : '/api/auth/sign-in/username';
      const payload = recovery ? { email: email.trim(), redirectTo: emailCallbackURL(initialURL, locale, 'reset') }
        : resetting ? { newPassword: password, token: resetToken }
          : verification ? { email: email.trim(), callbackURL: emailCallbackURL(initialURL, locale, 'verification') }
            : register ? { username: value, name: value, email: email.trim(), password, callbackURL: emailCallbackURL(initialURL, locale, 'verification') }
              : value.includes('@') ? { email: value, password } : { username: value, password };
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'accept-language': locale, ...(register ? conversionConsentHeaders() : {}) },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { user?: { id?: unknown }; token?: unknown; message?: string; code?: string; error?: string };
      if (controller.signal.aborted) return;
      if (mailStep) {
        if (!response.ok) { setError(resetting && ['INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(body.code ?? '') ? mail.invalidToken : copy.requestFailed); return; }
        if (resetting) { clearToken(true); setResetToken(undefined); changeStep('identifier'); setNotice(mail.resetDone); }
        else setNotice(recovery ? mail.resetSent : mail.verifySent);
        return;
      }
      if (!response.ok || typeof body.user?.id !== 'string') {
        const code = body.code ?? body.error;
        if (code === 'EMAIL_NOT_VERIFIED') {
          if (value.includes('@')) setEmail(value);
          changeStep('verification'); setNotice(mail.verificationRequired); return;
        }
        setError(code === 'USERNAME_IS_ALREADY_TAKEN' || code === 'USER_ALREADY_EXISTS' || body.message?.toLowerCase().includes('already')
          ? copy.alreadyRegistered : code === 'INVALID_USERNAME_OR_PASSWORD' || code === 'INVALID_EMAIL_OR_PASSWORD' || body.message?.toLowerCase().includes('invalid')
            ? copy.invalidCredentials : copy.requestFailed);
        return;
      }
      if (register && (policy.emailVerificationRequired || body.token === null)) {
        changeStep('verification'); setNotice(mail.verificationRequired); return;
      }
      onSignedIn();
    } catch { if (!controller.signal.aborted) setError(copy.connectionFailed); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const google = async () => {
    if (busy || !policy.googleEnabled) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/auth/sign-in/social', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: new URL(loginReturnPath(next ?? initialURL.searchParams.get('next'), location.origin), location.origin).href, disableRedirect: true }) });
      const body = await response.json().catch(() => ({})) as { url?: unknown };
      if (controller.signal.aborted) return;
      if (!response.ok || typeof body.url !== 'string') { setError(copy.requestFailed); return; }
      const target = new URL(body.url);
      if (target.origin !== 'https://accounts.google.com' || target.username || target.password) { setError(copy.requestFailed); return; }
      location.assign(target.href);
    } catch { if (!controller.signal.aborted) setError(copy.connectionFailed); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <Modal open onClose={close} closeLabel={words.close}
    title={recovery ? mail.forgotTitle : resetting ? mail.resetTitle : verification ? mail.verifyTitle : register ? copy.createTitle : step === 'password' ? words.passwordTitle : words.title}
    description={recovery ? mail.forgotIntro : resetting ? mail.resetIntro : verification ? mail.verifyIntro : step === 'password' ? identifier : words.intro}
    className="dsh-auth-dialog" contentClassName="dsh-auth-scroll">
    <div className="dsh-auth-content" data-auth-dialog data-auth-step={step}>
      {step === 'identifier' && <>
        <div className="dsh-auth-providers">
          <Button variant="outline" className="dsh-auth-secondary" disabled={busy || !policy.googleEnabled} title={policy.googleEnabled ? undefined : words.unavailable} onClick={() => void google()} icon={<LinkIconRegular kind="url" href="https://google.com" size={16} />}>{words.google}</Button>
          <Button variant="outline" className="dsh-auth-secondary" disabled title={words.otherProvidersUnavailable} icon={<LinkIconRegular kind="url" href="https://apple.com" size={16} />}>{words.apple}</Button>
          <Button variant="outline" className="dsh-auth-secondary" disabled title={words.otherProvidersUnavailable} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a14 14 0 0 1-6-6l2-2-2-5Z" /></svg>}>{words.phone}</Button>
        </div>
        <p className="dsh-auth-hint">{policy.googleEnabled ? words.otherProvidersUnavailable : words.unavailable}</p>
        <div className="dsh-auth-divider" aria-hidden="true"><span />{words.or}<span /></div>
      </>}
      <form className="dsh-auth-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {(step === 'identifier' || register) && <>
          <label className="dsh-auth-sr" htmlFor={`${id}-username`}>{register ? copy.username : words.identifier}</label>
          <Input id={`${id}-username`} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            placeholder={register ? copy.username : words.identifier} required minLength={register ? 3 : undefined} maxLength={register ? 30 : 254}
            value={identifier} disabled={busy} onChange={event => setIdentifier(event.target.value)} />
        </>}
        {(register || recovery || verification) && <>
          <label className="dsh-auth-sr" htmlFor={`${id}-email`}>{copy.email}</label>
          <Input id={`${id}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" placeholder={copy.email} required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
          {register && <p className="dsh-auth-hint">{copy.usernameHint}</p>}
        </>}
        {(step === 'password' || register || resetting) && <>
          <label className="dsh-auth-sr" htmlFor={`${id}-password`}>{copy.password}</label>
          <Input ref={passwordInput} id={`${id}-password`} name="password" type="password" autoComplete={register || resetting ? 'new-password' : 'current-password'} placeholder={copy.password}
            required minLength={8} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
          {register && <p className="dsh-auth-hint">{copy.passwordHint}</p>}
        </>}
        {resetting && <>
          <label className="dsh-auth-sr" htmlFor={`${id}-confirmation`}>{mail.confirmPassword}</label>
          <Input id={`${id}-confirmation`} name="confirmation" type="password" autoComplete="new-password" placeholder={mail.confirmPassword} required minLength={8} maxLength={128} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
          {!resetToken && <p className="dsh-auth-error" role="alert">{mail.invalidToken}</p>}
        </>}
        {notice && <p className="dsh-auth-hint" role="status">{notice}</p>}
        {error && <p className="dsh-auth-error" role="alert">{error}</p>}
        <Button variant="primary" className="dsh-auth-primary" type="submit" disabled={busy || (register && !registrationAllowed) || (mailStep && !mailAllowed) || (resetting && !resetToken)}>{busy ? copy.wait : recovery ? mail.sendReset : resetting ? mail.reset : verification ? mail.resend : register ? copy.create : words.continue}</Button>
      </form>
      {step !== 'identifier' && <Button variant="ghost" className="dsh-auth-link" disabled={busy} onClick={() => changeStep('identifier')}>{register ? copy.haveAccount : words.back}</Button>}
      {!register && !mailStep && <Button variant="ghost" className="dsh-auth-link" disabled={busy} onClick={() => changeStep('register')}>{copy.createSwitch}</Button>}
      {!recovery && <Button variant="ghost" className="dsh-auth-link" data-auth-email="reset" disabled={busy || !policy.passwordResetEnabled} title={!policy.passwordResetEnabled ? mailReason : undefined} onClick={() => { if (identifier.includes('@')) setEmail(identifier.trim()); changeStep('forgot-password'); }}>{mail.forgot}</Button>}
      {step === 'identifier' && <Button variant="ghost" className="dsh-auth-link" data-auth-email="verification" disabled={busy || !policy.emailVerificationEnabled} title={!policy.emailVerificationEnabled ? mailReason : undefined} onClick={() => changeStep('verification')}>{mail.resend}</Button>}
      {(!policy.email.ready || (mailStep && !mailAllowed)) && <p className="dsh-auth-hint" role="status">{mailReason}</p>}
      {register && !registrationAllowed && <p className="dsh-auth-hint" role="status">{policyReason}</p>}
    </div>
  </Modal>;
}
