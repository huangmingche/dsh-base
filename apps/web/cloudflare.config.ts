/** Deployment identity belongs to this app; the shared factory owns base bindings. */
import * as cloudflareConfig from "cf/config";
import { createDshCloudflareConfig } from "../../packages/build/dsh-base-build-product/src/cloudflare.mjs";
export default createDshCloudflareConfig(cloudflareConfig);
