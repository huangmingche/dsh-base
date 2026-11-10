/** The application owns its entry/configuration; build mechanics are reusable. */
import { fileURLToPath } from "node:url";
import { defineDshViteConfig } from "../../packages/build/dsh-base-build-product/src/vite.mjs";
export { dshSource, defineDshViteConfig } from "../../packages/build/dsh-base-build-product/src/vite.mjs";
export default defineDshViteConfig({ appRoot: fileURLToPath(new URL(".", import.meta.url)) });
