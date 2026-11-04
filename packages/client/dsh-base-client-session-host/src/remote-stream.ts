/** Physical Workers carrier classification under the unchanged official supervisor. */
import { RemoteStream, RemoteStreamCarrierError, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import { WireStreamCarrierFailure } from './wire-stream.ts';

/** Reuse official generation, accepted-baseline, retry, restart and cancellation semantics. */
export function createHostRemoteStream<Item>(
  connection: Pick<ConnectionHandle, 'generation'>,
  options: RemoteStreamOptions<Item>,
): RemoteStream<Item> {
  return new RemoteStream(connection, {
    ...options,
    async *open(signal) {
      try { yield* options.open(signal); }
      catch (error) {
        if (error instanceof WireStreamCarrierFailure) {
          throw new RemoteStreamCarrierError(error.message, { cause: error });
        }
        throw error;
      }
    },
  });
}
