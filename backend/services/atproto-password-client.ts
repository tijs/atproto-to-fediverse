import { BskyAgent } from "https://esm.sh/@atproto/api@0.15.23";
import { ATProtoPost } from "../../shared/types.ts";

/**
 * ATProto client using App Password authentication
 * Supports both bsky.social and self-hosted PDS instances
 */
export class ATProtoPasswordClient {
  private agent: BskyAgent;
  private did: string;
  private handle: string;
  private appPassword: string;
  private pdsUrl: string;

  constructor(
    pdsUrl: string,
    handle: string,
    appPassword: string,
    did: string,
  ) {
    // Use BskyAgent with the user's PDS URL (supports self-hosted PDS)
    this.agent = new BskyAgent({
      service: pdsUrl,
    });
    this.did = did;
    this.handle = handle;
    this.appPassword = appPassword;
    this.pdsUrl = pdsUrl;
  }

  /**
   * Login using App Password
   */
  async login(): Promise<void> {
    await this.agent.login({
      identifier: this.handle,
      password: this.appPassword,
    });
  }

  /**
   * Get the current session info
   */
  getSession() {
    return this.agent.session;
  }

  /**
   * Fetch recent posts from the user's timeline
   */
  async fetchRecentPosts(
    limit: number = 50,
    cursor?: string,
  ): Promise<{ posts: ATProtoPost[]; cursor?: string }> {
    const response = await this.agent.getAuthorFeed({
      actor: this.handle,
      limit,
      cursor,
    });

    if (!response.success) {
      throw new Error("Failed to fetch author feed");
    }

    return this.transformResponse(response);
  }

  private transformResponse(response: any) {
    // Transform the feed items to our ATProtoPost format
    const posts: ATProtoPost[] = response.data.feed.map((item) => ({
      uri: item.post.uri,
      cid: item.post.cid,
      author: {
        did: item.post.author.did,
        handle: item.post.author.handle,
        displayName: item.post.author.displayName || undefined,
        avatar: item.post.author.avatar || undefined,
      },
      record: {
        text: (item.post.record as any).text || "",
        createdAt: (item.post.record as any).createdAt,
        embed: (item.post.record as any).embed,
        facets: (item.post.record as any).facets,
        reply: (item.post.record as any).reply,
      },
      indexedAt: item.post.indexedAt,
    }));

    return {
      posts,
      cursor: response.data.cursor,
    };
  }

  /**
   * Fetch posts since a specific timestamp
   */
  fetchPostsSince(
    sinceTime: string,
    limit: number = 50,
  ): Promise<{ posts: ATProtoPost[]; cursor?: string }> {
    return this.fetchPostsWithCursor(undefined, sinceTime, limit);
  }

  /**
   * Fetch posts starting from a cursor with optional time filtering
   */
  async fetchPostsWithCursor(
    startCursor?: string,
    sinceTime?: string,
    limit: number = 50,
  ): Promise<{ posts: ATProtoPost[]; cursor?: string }> {
    let allPosts: ATProtoPost[] = [];
    let cursor: string | undefined = startCursor;
    let hasMore = true;
    let finalCursor: string | undefined;

    while (hasMore && allPosts.length < limit) {
      const { posts, cursor: nextCursor } = await this.fetchRecentPosts(
        Math.min(50, limit - allPosts.length),
        cursor,
      );

      if (posts.length === 0) {
        hasMore = false;
        break;
      }

      let postsToAdd = posts;

      // Apply time filter if provided
      if (sinceTime) {
        postsToAdd = posts.filter((post) => post.record.createdAt > sinceTime);

        // If we got filtered posts and some were too old, we can stop
        if (postsToAdd.length < posts.length) {
          allPosts = allPosts.concat(postsToAdd);
          finalCursor = nextCursor;
          hasMore = false;
          break;
        }
      }

      allPosts = allPosts.concat(postsToAdd);
      finalCursor = nextCursor;
      cursor = nextCursor;

      // Stop if we got fewer posts than requested (reached end)
      if (posts.length < 50) {
        hasMore = false;
      }

      // Stop if no cursor (reached end)
      if (!nextCursor) {
        hasMore = false;
      }
    }

    return {
      posts: allPosts.slice(0, limit),
      cursor: finalCursor,
    };
  }

  /**
   * Get a specific post by URI
   */
  async getPost(uri: string): Promise<ATProtoPost | null> {
    const response = await this.agent.getPostThread({
      uri,
      depth: 0,
    });

    if (!response.success) {
      return null;
    }

    const thread = response.data.thread;
    if (!thread || thread.$type !== "app.bsky.feed.defs#threadViewPost") {
      return null;
    }
    const post = (thread as any).post;

    return {
      uri: post.uri,
      cid: post.cid,
      author: {
        did: post.author.did,
        handle: post.author.handle,
        displayName: post.author.displayName || undefined,
        avatar: post.author.avatar || undefined,
      },
      record: {
        text: (post.record as any).text || "",
        createdAt: (post.record as any).createdAt,
        embed: (post.record as any).embed,
        facets: (post.record as any).facets,
        reply: (post.record as any).reply,
      },
      indexedAt: post.indexedAt,
    };
  }

  /**
   * Resolve a blob reference to a URL
   * Tries PDS first, falls back to AppView
   */
  resolveBlobUrl(blobRef: string): string {
    // Use the PDS URL for blob resolution (supports self-hosted PDS)
    return `${this.pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${this.did}&cid=${blobRef}`;
  }

  /**
   * Get blob data as ArrayBuffer
   * Tries PDS first, falls back to AppView if PDS fails
   */
  async getBlobData(blobRef: string): Promise<ArrayBuffer> {
    // Try PDS first
    let url = this.resolveBlobUrl(blobRef);
    let response = await fetch(url);

    // If PDS fails, try AppView (bsky.social)
    if (!response.ok && this.pdsUrl !== "https://bsky.social") {
      url =
        `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${this.did}&cid=${blobRef}`;
      response = await fetch(url);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch blob from both PDS and AppView`);
    }

    return await response.arrayBuffer();
  }

  /**
   * Get blob as Blob object for media uploads
   */
  async getBlob(blobRef: string): Promise<Blob> {
    const data = await this.getBlobData(blobRef);
    return new Blob([data]);
  }

  /**
   * Get user profile information
   */
  async getProfile(): Promise<any> {
    const response = await this.agent.getProfile({
      actor: this.did,
    });

    if (!response.success) {
      throw new Error("Failed to get profile");
    }

    return response.data;
  }

  /**
   * Verify credentials and test connection
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      // Try to get the current session
      const response = await this.agent.api.com.atproto.server.getSession();
      return response.success;
    } catch (error) {
      console.error("Credential verification error:", error);
      return false;
    }
  }
}
