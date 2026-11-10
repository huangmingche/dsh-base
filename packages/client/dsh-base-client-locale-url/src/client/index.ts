import { z } from "zod";
/** URL locale strategy over the official DSH locale runtime. */
import type { Context } from "@deepseek-ai/cordis";
import { synchronizeLocaleAddress, type LocaleFace } from "./address.ts";
export { activeLocale, addressFor, synchronizeLocaleAddress } from "./address.ts";

export const Config = z.object({}).default({});

export const name = "@dsh-base/client-locale-url";
export const inject = ["locale"];

/** Keep the address prefix in sync with the active UI locale. */
export function apply(ctx: Context): void {
  const locale = ctx.get("locale") as unknown as LocaleFace;
  if (locale === undefined) return;
  ctx.effect(() => synchronizeLocaleAddress(locale, { location, history }), "dsh-base: URL locale address synchronization");
}
