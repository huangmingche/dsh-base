# Browser Loader compatibility

Browser-only modules without Node or Workers imports. Static official module loading bypasses the Node resolver; filesystem writes, require and loader hooks reject explicitly. The build package maps these modules only in the `client` environment, preserving real Node compatibility for Workers.

The package is named `@dsh-base/client-browser-compat` and declares `dshBase.boot.kind: "browser-support"` for client-plane boundaries and strict typechecking. It has no composition entry and cannot be imported by Worker, Think or platform-neutral shared packages. The physical build path remains `packages/boot/browser-compat`.
