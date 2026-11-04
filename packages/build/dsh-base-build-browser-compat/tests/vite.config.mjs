import { fileURLToPath } from "node:url";
import { browserCompatibility } from "../src/vite.mjs";
import { dshSource } from "../../../../apps/web/vite.config.ts";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export default {
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [browserCompatibility({ appRoot: `${root}apps/web`, sourceRoot: `${root}.submodules/deepseek-harness` }), dshSource()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: `${root}.artifacts/browser-compat`, emptyOutDir: true },
};
