/** Preserve the real Host filesystem namespace without synthetic transcript fallbacks. */
import type { OfficialWorkspaceFilesGateway } from "@dsh-base/client-session-host";

export function createWorkspaceFilesRemote(gateway: () => OfficialWorkspaceFilesGateway | undefined) {
  const current = () => {
    const value = gateway();
    if (value === undefined) throw Object.assign(new Error("Workspace files Host is unavailable."), { code: "workspace-file/unavailable" });
    return value;
  };
  const call = async <T>(operation: () => Promise<T>) => {
    try { return await operation(); }
    catch (error) {
      const failure = error as { code?: string; message?: string; details?: unknown };
      return { ok: false as const, error: {
        code: failure.code ?? "workspace-file/unavailable",
        message: failure.message ?? "Workspace files request failed.", details: failure.details ?? {},
      } };
    }
  };
  return {
    list: (...args: Parameters<OfficialWorkspaceFilesGateway["list"]>) => call(() => current().list(...args)),
    stat: (...args: Parameters<OfficialWorkspaceFilesGateway["stat"]>) => call(() => current().stat(...args)),
    read: (...args: Parameters<OfficialWorkspaceFilesGateway["read"]>) => call(() => current().read(...args)),
    readBytes: (...args: Parameters<OfficialWorkspaceFilesGateway["readBytes"]>) => call(() => current().readBytes(...args)),
    changes: (...args: Parameters<OfficialWorkspaceFilesGateway["changes"]>) => current().changes(...args),
  };
}
