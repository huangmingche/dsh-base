/** Live product name in the official name slot; the official mark remains its fallback. */
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { SiteConfigService } from '@dsh-base/client-site-config/client';
export interface BrandFace { readonly hooks: { readonly siteConfig: Pick<SiteConfigService, 'getSnapshot' | 'subscribe'> } }
export function ProductBrandName(props: PropsRuntime<'sidebar.brand.name'> & InjectFace<BrandFace>) {
  const name = props.useSiteConfig(snapshot => snapshot.config.brand.name);
  return <span>{name}</span>;
}
