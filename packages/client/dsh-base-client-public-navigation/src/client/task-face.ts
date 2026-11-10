import type { TaskManagerInjected } from '@dsh-base/client-schedule/src/client/TaskManagerPage.tsx'
import type { CatalogSnapshot } from '@dsh-base/client-schedule/src/client/catalog-source.ts'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule/client'

/** An anonymous preview is explicitly not an authoritative task-catalog read. */
export function publicTaskFace(signIn: () => void): TaskManagerInjected {
  const snapshot: CatalogSnapshot<ScheduleCatalogEntry> = { records: [], status: 'ready', deleting: [], settled: false, readRequest: 0, readSettled: 0 }
  return {
    hooks: { catalog: { getSnapshot: () => snapshot, subscribe: () => () => {} } },
    onNewTask: signIn,
    onBeforeCreate: () => { signIn(); return false },
    onRetry: async () => { signIn() },
    onClearEnded: async () => { signIn() },
    onCreateTask: async () => { signIn(); return { failed: 'host.createError' } },
    onDelete: async () => { signIn(); return 'failed' },
    onOpenSession: signIn,
    loadHistory: async () => { signIn(); throw new Error('auth/required: Sign in to read your tasks.') },
    hostActions: {
      edit: async () => { signIn(); return { failed: 'host.saveError' } },
      run: async () => { signIn(); return { failed: 'host.runError' } },
      // The guest preview never reads private task limits.
      loadNewSessionInterval: async () => undefined,
    },
  }
}
