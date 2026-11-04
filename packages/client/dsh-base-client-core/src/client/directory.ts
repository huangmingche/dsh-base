import { useSyncExternalStore } from "react";

/** One native Think conversation in the sidebar directory. */
export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "error" | "submitted";
  pinned?: boolean;
  archived?: boolean;
}

export interface DirectorySnapshot {
  chats: ChatRecord[];
  currentId: string;
}

const STORAGE_KEY = "dsh-base:chat-directory";
const DEFAULT_CHAT: ChatRecord = {
  id: "default",
  title: "Main conversation",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: "idle",
};

function read(): DirectorySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<DirectorySnapshot>;
      if (Array.isArray(parsed.chats) && parsed.chats.length > 0) {
        const currentId = typeof parsed.currentId === "string"
          && parsed.chats.some((chat) => chat.id === parsed.currentId)
          ? parsed.currentId
          : parsed.chats[0]!.id;
        return { chats: parsed.chats as ChatRecord[], currentId };
      }
    }
  } catch {
    // Corrupt or unavailable storage falls back to the seeded conversation.
  }
  return { chats: [DEFAULT_CHAT], currentId: DEFAULT_CHAT.id };
}

let snapshot = read();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode/quota: the session still works for this tab.
  }
}

function publish(next: DirectorySnapshot): void {
  snapshot = next;
  persist();
  for (const listener of [...listeners]) listener();
}

export function getDirectory(): DirectorySnapshot {
  return snapshot;
}

export function subscribeDirectory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDirectory(): DirectorySnapshot {
  return useSyncExternalStore(subscribeDirectory, getDirectory, getDirectory);
}

export function useCurrentChatId(): string {
  return useSyncExternalStore(
    subscribeDirectory,
    () => snapshot.currentId,
    () => snapshot.currentId,
  );
}

/** Open an existing conversation by id. */
export function selectChat(id: string): void {
  if (id === snapshot.currentId || !snapshot.chats.some((chat) => chat.id === id)) return;
  publish({ ...snapshot, currentId: id });
}

/** Create and select a fresh Think conversation. */
export function createChat(): string {
  const now = Date.now();
  const chat: ChatRecord = {
    id: `chat-${crypto.randomUUID()}`,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    status: "idle",
  };
  publish({ chats: [chat, ...snapshot.chats], currentId: chat.id });
  return chat.id;
}

/** Remove one conversation; an emptied directory keeps one fresh chat. */
export function deleteChat(id: string): void {
  const chats = snapshot.chats.filter((chat) => chat.id !== id);
  if (chats.length === 0) {
    createChat();
    return;
  }
  const currentId = snapshot.currentId === id ? chats[0]!.id : snapshot.currentId;
  publish({ chats, currentId });
}

/** Patch one conversation; missing ids are ignored. */
export function updateChat(id: string, patch: Partial<Omit<ChatRecord, "id">>): void {
  let changed = false;
  const chats = snapshot.chats.map((chat) => {
    if (chat.id !== id) return chat;
    const next = { ...chat, ...patch };
    if (next.title === chat.title && next.updatedAt === chat.updatedAt && next.status === chat.status
      && next.pinned === chat.pinned && next.archived === chat.archived) return chat;
    changed = true;
    return next;
  });
  if (!changed) return;
  const ordered = [...chats].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  publish({ ...snapshot, chats: ordered });
}

/** Pin or unpin one conversation. */
export function setChatPinned(id: string, pinned: boolean): void {
  updateChat(id, { pinned });
}

/** Archive or restore one conversation. */
export function setChatArchived(id: string, archived: boolean): void {
  updateChat(id, { archived, ...(archived ? { pinned: false } : {}) });
}

/** Relative label for a directory row. */
export function relativeTimeLabel(updatedAt: number, now = Date.now()): string {
  const diff = Math.max(0, now - updatedAt);
  const minute = 60_000;
  if (diff < minute) return "now";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}m`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}h`;
  return `${Math.floor(diff / (24 * 60 * minute))}d`;
}
