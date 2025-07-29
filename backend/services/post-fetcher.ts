import { ATProtoHttpClient } from "../interfaces/http-client.ts";
import { ATProtoPost } from "../../shared/types.ts";

export interface PostFetchResult {
  posts: ATProtoPost[];
  cursor?: string;
}

export class PostFetcher {
  constructor() {}

  /**
   * Fetch posts from ATProto feed
   */
  async fetchPosts(
    atprotoClient: ATProtoHttpClient,
    account: any,
  ): Promise<PostFetchResult> {
    return await this.fetchPostsWithCursor(
      atprotoClient,
      account.atproto_did,
      account.last_sync_cursor,
      account.last_sync_at,
      50,
    );
  }

  /**
   * Fetch posts using cursor-based pagination
   */
  private async fetchPostsWithCursor(
    atprotoClient: ATProtoHttpClient,
    actorDid: string,
    lastCursor?: string,
    lastSyncAt?: number,
    limit: number = 50,
  ): Promise<PostFetchResult> {
    let allPosts: ATProtoPost[] = [];
    let currentCursor = lastCursor;
    let hasMore = true;
    let finalCursor: string | undefined;

    // Calculate time filter - always limit to 24 hours ago to prevent going too far back
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const fallbackTime = lastSyncAt && lastSyncAt > oneDayAgo
      ? new Date(lastSyncAt).toISOString()
      : new Date(oneDayAgo).toISOString();

    // Use the cursor-based method if available, otherwise fall back to regular fetch
    if ("fetchPostsWithCursor" in atprotoClient) {
      // Reset cursor if it's older than 1 day to get recent posts
      const cursorDate = lastCursor ? new Date(lastCursor).getTime() : 0;
      const shouldResetCursor = cursorDate < oneDayAgo;

      const result = await (atprotoClient as any).fetchPostsWithCursor({
        startCursor: shouldResetCursor ? undefined : lastCursor,
        sinceTime: fallbackTime, // Add back time filter to limit to 24 hours
        limit,
      });

      allPosts = result.posts.map((item: any) => ({
        uri: item.post.uri,
        cid: item.post.cid,
        author: item.post.author,
        record: item.post.record,
        indexedAt: item.post.indexedAt,
      }));

      finalCursor = result.cursor;
    } else {
      // Fallback to original pagination logic
      while (hasMore && allPosts.length < limit) {
        const response = await atprotoClient.fetchPosts({
          actor: actorDid,
          limit: Math.min(50, limit - allPosts.length),
          cursor: currentCursor,
        });

        if (!response.feed || response.feed.length === 0) {
          hasMore = false;
          break;
        }

        // Transform to ATProtoPost format
        const posts = response.feed.map((item: any) => ({
          uri: item.post.uri,
          cid: item.post.cid,
          author: item.post.author,
          record: item.post.record,
          indexedAt: item.post.indexedAt,
        }));

        // If we have a last sync time, filter out posts older than that
        const newPosts = lastSyncAt
          ? posts.filter((post) => post.record.createdAt > fallbackTime)
          : posts;

        allPosts = allPosts.concat(newPosts);
        finalCursor = response.cursor;
        currentCursor = response.cursor;

        // Stop if we got fewer posts than requested (end of feed)
        // or if we've reached posts older than our sync time
        if (
          response.feed.length < 50 ||
          (lastSyncAt && newPosts.length < posts.length)
        ) {
          hasMore = false;
        }

        // Stop if no cursor (end of feed)
        if (!response.cursor) {
          hasMore = false;
        }
      }
    }

    return {
      posts: allPosts.slice(0, limit),
      cursor: finalCursor,
    };
  }
}
