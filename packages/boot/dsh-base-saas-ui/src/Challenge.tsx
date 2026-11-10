import { useEffect, useRef, useState } from 'react';
interface Turnstile { render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; theme: 'auto' }) => string; remove: (id: string) => void }
declare global { interface Window { turnstile?: Turnstile } }
let pending: Promise<Turnstile> | undefined;
/** The fixed Cloudflare script is requested only by a mounted, configured challenge. */
function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    const timeout = setTimeout(() => { script.remove(); pending = undefined; reject(new Error('Challenge timeout')); }, 15_000);
    script.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else { pending = undefined; reject(new Error('Challenge unavailable')); } };
    script.onerror = () => { clearTimeout(timeout); script.remove(); pending = undefined; reject(new Error('Challenge unavailable')); };
    document.head.append(script);
  });
  return pending;
}
export function Challenge({ siteKey, action, onToken, failedLabel }: { readonly siteKey: string; readonly action: string; readonly onToken: (token: string) => void; readonly failedLabel: string }) {
  const host = useRef<HTMLDivElement>(null), callback = useRef(onToken); callback.current = onToken;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true, id: string | undefined, service: Turnstile | undefined;
    callback.current('');
    void load().then(value => {
      if (!live || !host.current) return; service = value;
      id = value.render(host.current, { sitekey: siteKey, action, theme: 'auto', callback: token => { if (live) callback.current(token); },
        'expired-callback': () => { if (live) callback.current(''); }, 'error-callback': () => { if (live) { callback.current(''); setFailed(true); } } });
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (id !== undefined) service?.remove(id); };
  }, [siteKey, action]);
  return <div>{failed ? <p role="alert">{failedLabel}</p> : null}<div ref={host} /></div>;
}
