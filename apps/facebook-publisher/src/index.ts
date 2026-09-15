import { SocialPostRepository, createDatabaseClient } from "@magyarsportonline/db";
import { processFacebookMessage, type FacebookQueueMessage, type QueueMessage } from "./facebook";

interface Env {
  HYPERDRIVE: { connectionString: string };
  FACEBOOK_AUTO_PUBLISH?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_GRAPH_API_VERSION: string;
}

interface MessageBatch<T> {
  messages: readonly QueueMessage<T>[];
}

export default {
  async queue(batch: MessageBatch<FacebookQueueMessage>, env: Env): Promise<void> {
    const db = createDatabaseClient(env.HYPERDRIVE.connectionString, {
      max: 5,
      fetchTypes: true,
      prepare: true,
    });
    const repository = new SocialPostRepository(db);
    for (const message of batch.messages) {
      await processFacebookMessage(message, env, {
        repository,
        fetch,
        logger: console,
      });
    }
  },
};
