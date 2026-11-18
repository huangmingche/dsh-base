/** Project the deployed account lifecycle onto the official account/watch stream. */
import type { LocalAccountUser } from "./account-transport.ts";

export async function* accountUpdates<View>(
  users: AsyncIterable<LocalAccountUser | null>,
  viewOf: (user: LocalAccountUser | null) => View,
): AsyncGenerator<{ type: "snapshot" | "credentials-changed"; state: View }> {
  let previousId: string | null | undefined;
  for await (const user of users) {
    const id = user?.id ?? null;
    const type = previousId === undefined || previousId === id ? "snapshot" : "credentials-changed";
    previousId = id;
    yield { type, state: viewOf(user) };
  }
}

/** The official Host returns null/false while Platform notification credentials are absent. */
export const platformNotifications = {
  getNotifications: async () => ({ ok: true as const, value: null }),
  getNotificationContent: async () => ({ ok: true as const, value: null }),
  reportNotificationEvent: async () => ({ ok: true as const, value: false }),
};
