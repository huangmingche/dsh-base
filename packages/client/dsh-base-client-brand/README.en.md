# Official sidebar name seam

The official brand plugin registers only for the official build profile; other deployments use `SidebarRoot` fallbacks. This plugin fills only the public `sidebar.brand.name` slot, reading the configured site name through the framework-injected `siteConfig` observable. Shared defaults cover the first render, and a successful administrator save refreshes the public snapshot and name.

This is the user-approved site-name consumer for global settings. It never registers the mark slot: official `FishLogo` and its version-copy behavior remain. No CSS, sidebar layout or interaction changes are added; the name inherits the original slot typography.

Occupying the name slot still replaces its fallback version line and version-copy action. The official mark and Settings version remain unchanged, and `dshBase.reuse` tracks this gap. The official brand plugin stays enabled/no-op and is not replaced.
