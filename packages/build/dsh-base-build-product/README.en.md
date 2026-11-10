# Product build adapter

This build-only package lets an independent product consume the base as a read-only Git submodule. It provides no runtime capabilities or composition entries.

`./vite` exports `defineDshViteConfig({ productRoot, appRoot })` and `dshSource(options)`; tools load from the product app dependency environment. `./cloudflare` exports `createDshCloudflareConfig(cfConfig, { deploymentPath, entrypoint })`; the product supplies its installed `cf/config` API.

Generated data maps to the product `.artifacts/dsh/<base-relative-path>`. Official source always comes from the base's pinned nested submodule and declared exports. Product server SDK dependencies install in `packages/build/product-server-dependencies`, keeping browser and server React environments isolated.

During development, the adapter caps the compatibility date at the installed workerd version and disables remote bindings by default. `DSH_LOCAL_COMPATIBILITY_DATE` overrides only the local date; production build/deploy retain their configured date. The shared product CLI prepares local D1 schemas before starting the server.
