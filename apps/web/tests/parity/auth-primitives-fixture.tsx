/** Compare local-account controls with untouched pinned DSH primitives. */
import { useState } from 'react';
import { Button, Input, LinkIconRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { LoginSurface } from '../../../../packages/client/dsh-base-client-auth-login/src/client/LoginDialog.tsx';
import { dialogCopy } from '../../../../packages/client/dsh-base-client-auth-login/src/client/dialog-locales.ts';
import { loginCopy } from '../../../../packages/client/dsh-base-client-auth-login/src/client/locales.ts';
import '../../../../packages/client/dsh-base-client-auth-login/src/client/login.css';

type Atom = 'submit' | 'provider' | 'input' | 'create';
interface ReferenceLayout {
  bodyHeight: number;
  bodyX?: number;
  bodyY?: number;
  atom?: Atom;
  rect?: { x: number; y: number; width: number; height: number };
}

export function AuthPrimitivesFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const words = dialogCopy(locale), copy = loginCopy(locale);
  const [layout, setLayout] = useState<ReferenceLayout>({ bodyHeight: 400 });
  const [open, setOpen] = useState(true);
  (window as any).__AUTH_PRIMITIVES__ = { setLayout, close: () => setOpen(false) };
  if (adapted) return open ? <LoginSurface onClose={() => setOpen(false)} onSignedIn={() => { throw new Error('Primitive fixture must never authenticate'); }} /> : null;
  // Spacers reproduce only the measured layout occupied by our own auth flow.
  // The modal chrome and each compared atom retain their official CSS unchanged.
  const atom = layout.atom === 'submit' ? <Button variant="primary" type="submit" style={{ width: '100%' }}>{words.continue}</Button>
    : layout.atom === 'provider' ? <Button variant="outline" disabled title={words.unavailable} style={{ width: '100%' }} icon={<LinkIconRegular kind="url" href="https://google.com" size={16} />}>{words.google}</Button>
    : layout.atom === 'input' ? <Input name="username" placeholder={words.identifier} autoComplete="username" className="auth-reference-fill" />
    : layout.atom === 'create' ? <Button variant="ghost" style={{ width: '100%' }}>{copy.createSwitch}</Button> : null;
  return <>
    <style>{'.auth-reference-fill { width: 100%; }.auth-reference-scroll { min-height: 0; overflow-y: auto; overflow-wrap: anywhere; }'}</style>
    <Modal open={open} title={words.title} description={words.intro} closeLabel={words.close} onClose={() => setOpen(false)} contentClassName="auth-reference-scroll">
      <div data-reference-auth-body style={{ height: layout.bodyHeight, position: 'relative' }}>
        {atom && layout.rect && <div data-reference-auth-atom style={{ position: 'absolute', display: 'flex', left: layout.rect.x - (layout.bodyX ?? 0), top: layout.rect.y - (layout.bodyY ?? 0), width: layout.rect.width, height: layout.rect.height }}>{atom}</div>}
      </div>
    </Modal>
  </>;
}
