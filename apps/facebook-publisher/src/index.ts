import { D1SocialPostRepository, type D1Client } from "@magyarsportonline/db/d1";
import { processFacebookMessage, type FacebookQueueMessage, type QueueMessage } from "./facebook";

interface Env {
  DB?: D1Client;
  FACEBOOK_AUTO_PUBLISH?: string;
  FACEBOOK_AUTO_PUBLISH_START_AT?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_GRAPH_API_VERSION: string;
}

interface MessageBatch<T> {
  messages: readonly QueueMessage<T>[];
}

export default {
  async queue(batch: MessageBatch<FacebookQueueMessage>, env: Env): Promise<void> {
    if (!env.DB) throw new Error("Facebook publisher has no D1 binding");
    const repository = new D1SocialPostRepository(env.DB);
    for (const message of batch.messages) {
      await processFacebookMessage(message, env, {
        repository,
        fetch: (input, init) => globalThis.fetch(input, init),
        logger: console,
      });
    }
  },
};
