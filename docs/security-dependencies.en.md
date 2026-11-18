# Dependency security checks

[简体中文](security-dependencies.md) | English

On 2026-11-18, `pnpm audit` reported one high-severity finding against the previous lockfile. The advisory covers `picomatch <= 4.0.7` and listed no patched upstream release on that date. The affected parser compiles some single-branch repeated extglobs into regular expressions with excessive backtracking. See [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

The browser sidebar, Vite, the Rolldown Babel plugin, tinyglobby and fdir resolve their existing `picomatch` imports to `@ryotsu/picomatch@4.0.7-a`, an independently maintained MIT fork. Every file in the npm tarball was compared with the [pinned fix commit](https://github.com/ryotsu-kankichi/secured-picomatch/commit/3ab5a7627d480259e3d9ca67fbc14c125d374f0e). The lockfile pins the tarball integrity. The package has no runtime dependencies or install hooks.

The Cloudflare CLI bundled `picomatch@4.0.5` in its Wrangler configuration migration tool. A lockfile audit could not identify this copy. The repository removes the embedded implementation with `patches/cf-picomatch.patch` and declares a direct CLI dependency on the same fixed matcher. Downstream products read both patches from their pinned base.

The fork simplifies repeated wildcard segments where it can establish equivalence. Complex branches for which it cannot do so take the parser’s literal fallback, which limits some custom patterns. The repository’s `patches/picomatch-compat.patch` keeps the single-branch guard active even when the caller disables the recursion-depth limit. It also restores four behaviors from 4.0.7 covering negated character classes, POSIX punctuation, globstars across newlines and double stars adjacent to file extensions.

`pnpm check:dependencies` verifies package resolution by actual consumers, the browser POSIX entry, path scanning, regex generation, directory traversal and Vite’s sensitive-file protection. It also runs the installed `cf migrate --dry-run` command and checks function coverage to confirm that file discovery uses the fixed implementation. `pnpm audit` runs against the complete lockfile. When upgrading the matcher or the Cloudflare CLI, review the matcher embedded in the CLI and recheck API and security-fork compatibility.
