# Browser Loader compatibility

Browser-only modules without Node or Workers imports. Static official module loading bypasses the Node resolver; filesystem writes, require and loader hooks reject explicitly. The build package maps these modules only in the `client` environment, preserving real Node compatibility for Workers.
