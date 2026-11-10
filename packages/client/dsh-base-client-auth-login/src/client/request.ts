/** Public UI intent only: opening this dialog never grants account access. */
export interface LoginRequest { readonly mode?: 'sign-in' | 'register' | 'forgot-password' | 'reset-password'; readonly next?: string }
export const LOGIN_REQUEST_EVENT = 'dsh-base:request-login';

/** Shared by plugin actions; credentials and permissions remain server-owned. */
export function requestLogin(options: LoginRequest = {}): void {
  window.dispatchEvent(new CustomEvent<LoginRequest>(LOGIN_REQUEST_EVENT, { detail: options }));
}
