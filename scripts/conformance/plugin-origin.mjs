/** Keep declared runtime authorship consistent with recorded reuse provenance. */
export function checkPluginOrigin(manifest, origin, source) {
  const label = manifest.name;
  const fork = manifest.dshBase?.forkOf;
  const reuse = manifest.dshBase?.reuse;
  const isFork = fork !== undefined || reuse?.mode === "fork";
  const failures = [];
  if (isFork && origin !== "fork") {
    failures.push(`${label}: ${source} must be fork when forkOf or reuse.mode declares a fork`);
  } else if (!isFork && origin === "fork") {
    failures.push(`${label}: ${source} fork requires recorded fork provenance`);
  }
  if (fork !== undefined && reuse !== undefined && reuse.mode !== "fork") {
    failures.push(`${label}: ${source} forkOf conflicts with reuse.mode ${reuse.mode}`);
  }
  return failures;
}
