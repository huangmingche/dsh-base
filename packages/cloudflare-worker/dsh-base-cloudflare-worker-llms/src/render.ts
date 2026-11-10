/** Plain Markdown content describing only the registered public documents. */
import type { LocaleId } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { PUBLIC_PAGES, hasPageLocale, isIndexablePage, type PublicPage } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { resolvePageCopy, type SiteSeoConfig } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { documentUrl } from "../../../boot/dsh-base-site-seo/src/render.ts";

function inline(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/[\\`*_[\]<>]/gu, character => `\\${character}`);
}

/** No fetch, generated full-text pages, private paths, or inference is involved. */
export function renderLlms(config: SiteSeoConfig, locale: LocaleId, origin: string, registered: readonly PublicPage[] = PUBLIC_PAGES): string {
  const introduction = config.llms?.introduction ?? resolvePageCopy(config, "/", locale).description;
  const pages = registered.filter(page => isIndexablePage(page) && hasPageLocale(page, locale)).map(page => {
    const copy = resolvePageCopy(config, page.path, locale, page.copy);
    const url = documentUrl(config, page.path, locale, origin);
    return `- [${inline(copy.title)}](<${url}>): ${inline(copy.description)}`;
  });
  return `# ${inline(config.site.name)}\n\n> ${inline(introduction)}\n\n## Pages\n\n${pages.join("\n")}\n${config.llms?.guidance === undefined ? "" : `\n## Guidance\n\n${config.llms.guidance}\n`}`;
}
