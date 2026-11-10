import type { GlobalSettingsKey } from './locales.ts';
export interface FieldSpec {
  readonly path: readonly string[];
  readonly label: GlobalSettingsKey;
  readonly kind?: 'text' | 'multiline' | 'list' | 'number' | 'frequency' | 'boolean' | 'conversion';
  readonly defaultValue?: boolean;
  readonly optional?: boolean;
  readonly hint?: GlobalSettingsKey;
  readonly locked?: boolean;
}
const field = (path: string, label: GlobalSettingsKey, rest: Omit<FieldSpec, 'path' | 'label'> = {}): FieldSpec => ({ path: path.split('.'), label, ...rest });
export const SITE_FIELDS: readonly FieldSpec[] = [
  field('seo.site.name', 'name'), field('seo.site.url', 'origin', { optional: true, hint: 'originHint' }),
  field('seo.site.twitter', 'twitter', { optional: true }), field('seo.site.github', 'github', { optional: true }),
  field('seo.site.contactEmail', 'contactEmail', { optional: true }), field('links.docs', 'docs', { optional: true }),
  field('links.supportEmail', 'supportEmail', { optional: true }), field('links.github', 'githubLink', { optional: true }),
];
export const IMAGE_FIELDS: readonly FieldSpec[] = [
  ...(['svg', 'ico', 'png16', 'png32', 'appleTouch', 'icon192', 'icon512', 'maskable512'] as const).map(key => field(`seo.icons.${key}`, key, { hint: 'assetHint' })),
  field('seo.image.url', 'imageUrl', { hint: 'assetHint' }), field('seo.image.width', 'width', { kind: 'number' }), field('seo.image.height', 'height', { kind: 'number' }),
  field('seo.image.type', 'imageType'), field('seo.image.alt', 'imageAlt', { optional: true }),
  field('seo.manifest.shortName', 'shortName', { optional: true }), field('seo.manifest.themeColor', 'themeColor'), field('seo.manifest.backgroundColor', 'backgroundColor'),
  field('seo.manifest.display', 'display', { locked: true, hint: 'displayHint' }),
];
export const ROBOT_FIELDS: readonly FieldSpec[] = [field('seo.robots.disallow', 'disallow', { kind: 'list', optional: true, hint: 'lineItems' }), field('seo.robots.extraLines', 'extraLines', { kind: 'list', optional: true, hint: 'lineItems' })];
export const LLMS_FIELDS: readonly FieldSpec[] = [
  field('seo.llms.enabled', 'llmsEnabled', { kind: 'boolean', defaultValue: true, hint: 'llmsHint' }),
  field('seo.llms.introduction', 'introduction', { kind: 'multiline', optional: true }),
  field('seo.llms.guidance', 'guidance', { kind: 'multiline', optional: true }),
];
export const ANALYTICS_FIELDS: readonly FieldSpec[] = [
  field('analytics.google.enabled', 'googleEnabled', { kind: 'boolean', defaultValue: false, hint: 'googleHint' }),
  field('analytics.google.measurementId', 'measurementId', { optional: true, hint: 'measurementHint' }),
  field('analytics.conversions.mode', 'conversionMode', { kind: 'conversion', hint: 'conversionHint' }),
  field('analytics.conversions.campaigns', 'conversionCampaigns', { kind: 'list', optional: true, hint: 'conversionCampaignHint' }),
];
export type SettingsScope = 'global' | 'seo' | 'sitemap' | 'robots' | 'manifest' | 'llms' | 'googleAnalytics';
/** The official keyed row contract is <bundle package name>#<composition row id>. */
export const SETTINGS_ROWS = [
  { scope: 'seo', key: 'dsh-base:global#cloudflare:worker:seo' },
  { scope: 'sitemap', key: 'dsh-base:global#cloudflare:worker:sitemap' },
  { scope: 'robots', key: 'dsh-base:global#cloudflare:worker:robots' },
  { scope: 'manifest', key: 'dsh-base:global#cloudflare:worker:manifest' },
  { scope: 'llms', key: 'dsh-base:global#cloudflare:worker:llms' },
  { scope: 'googleAnalytics', key: 'dsh-base:global#client:google-analytics' },
  { scope: 'googleAnalytics', key: 'dsh-base:global#cloudflare:worker:google-analytics' },
] as const satisfies readonly { readonly scope: SettingsScope; readonly key: string }[];
export const SCOPE_DESCRIPTIONS = {
  global: 'description', seo: 'seoDescription', sitemap: 'sitemapDescription', robots: 'robotsDescription', manifest: 'manifestDescription', llms: 'llmsDescription', googleAnalytics: 'googleDescription',
} as const satisfies Record<SettingsScope, GlobalSettingsKey>;
export function siteFields(scope: SettingsScope): readonly FieldSpec[] {
  return scope === 'global' ? SITE_FIELDS : scope === 'seo' ? SITE_FIELDS.filter(spec => spec.path[0] === 'seo') : [];
}
export function imageFields(scope: SettingsScope): readonly FieldSpec[] {
  if (scope === 'global') return IMAGE_FIELDS;
  if (scope === 'manifest') return IMAGE_FIELDS.filter(spec => spec.path[1] === 'manifest' || spec.path[1] === 'icons' && ['svg', 'icon192', 'icon512', 'maskable512'].includes(spec.path[2]!));
  if (scope === 'seo') return IMAGE_FIELDS.filter(spec => spec.path[1] === 'image' || spec.path[1] === 'icons' && !['icon192', 'icon512', 'maskable512'].includes(spec.path[2]!));
  return [];
}
export const LANGUAGES = { en: 'English', zh: '简体中文', ja: '日本語', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский', pt: 'Português' } as const;
export function localeFields(locale: string): readonly FieldSpec[] {
  const prefix = ['seo', 'locales', locale];
  return [
    { path: [...prefix, 'title'], label: 'title' }, { path: [...prefix, 'description'], label: 'pageDescription', kind: 'multiline' },
    { path: [...prefix, 'keywords'], label: 'keywords', kind: 'list', hint: 'lineItems' }, { path: [...prefix, 'ogImageAlt'], label: 'imageAlt', optional: true },
  ];
}
export function pageFields(path: string, scope: SettingsScope = 'global'): readonly FieldSpec[] {
  const prefix = ['seo', 'pages', path];
  const fields: readonly FieldSpec[] = [
    { path: [...prefix, 'title'], label: 'title', optional: true }, { path: [...prefix, 'description'], label: 'pageDescription', optional: true, kind: 'multiline' },
    { path: [...prefix, 'keywords'], label: 'keywords', optional: true, kind: 'list', hint: 'lineItems' },
    { path: [...prefix, 'priority'], label: 'priority', optional: true }, { path: [...prefix, 'changefreq'], label: 'changefreq', kind: 'frequency', optional: true },
    { path: [...prefix, 'lastmod'], label: 'lastmod', optional: true, hint: 'lastmodHint' }, { path: [...prefix, 'image'], label: 'imageUrl', optional: true, hint: 'assetHint' },
  ];
  return scope === 'global' ? fields : scope === 'seo' ? fields.filter(spec => !SITEMAP_PAGE_FIELDS.has(spec.path.at(-1)!)) : scope === 'sitemap' ? fields.filter(spec => SITEMAP_PAGE_FIELDS.has(spec.path.at(-1)!)) : [];
}
const SITEMAP_PAGE_FIELDS = new Set(['priority', 'changefreq', 'lastmod']);
/** Reset only this row's fields. SEO copy and sitemap hints share the same page record. */
export function resetPageFields(value: unknown, path: string, scope: SettingsScope): Record<string, unknown> | undefined {
  if (scope === 'global' || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const next = { ...value } as Record<string, unknown>;
  for (const spec of pageFields(path, scope)) delete next[spec.path.at(-1)!];
  return Object.keys(next).length ? next : undefined;
}
