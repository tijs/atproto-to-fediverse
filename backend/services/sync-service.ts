// Dependency-injected sync service for better testability

import { StorageProvider } from "../interfaces/storage.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../interfaces/http-client.ts";
import { PostTransformer } from "./post-transformer.ts";
import { ATProtoPost, RetryConfig, SyncResult } from "../../shared/types.ts";

export interface SyncServiceDependencies {
  storage: StorageProvider;
  createATProtoClient: (
    pdsUrl: string,
    accessToken: string,
    refreshToken: string,
    did: string,
    onTokenRefresh?: (
      tokens: { accessJwt: string; refreshJwt: string },
    ) => Promise<void>,
    appPassword?: string,
  ) => ATProtoHttpClient;
  createMastodonClient: (
    instanceUrl: string,
    accessToken: string,
  ) => MastodonHttpClient;
  retryConfig?: RetryConfig;
}

export class SyncService {
  private storage: StorageProvider;
  private createATProtoClient: (
    pdsUrl: string,
    accessToken: string,
    refreshToken: string,
    did: string,
    onTokenRefresh?: (
      tokens: { accessJwt: string; refreshJwt: string },
    ) => Promise<void>,
    appPassword?: string,
  ) => ATProtoHttpClient;
  private createMastodonClient: (
    instanceUrl: string,
    accessToken: string,
  ) => MastodonHttpClient;
  private retryConfig: RetryConfig;

  constructor(dependencies: SyncServiceDependencies) {
    this.storage = dependencies.storage;
    this.createATProtoClient = dependencies.createATProtoClient;
    this.createMastodonClient = dependencies.createMastodonClient;
    this.retryConfig = dependencies.retryConfig || {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
    };
  }

  /**
   * Sync posts for the single user
   */
  async syncAllUsers(): Promise<void> {
    const startTime = Date.now();
    console.log("Starting sync for single user...");

    try {
      const account = await this.storage.userAccounts.getSingle();

      if (!account) {
        console.log("No user account found - skipping sync");
        return;
      }

      if (!account.atproto_access_token || !account.mastodon_access_token) {
        console.log("User account not fully configured - skipping sync");
        return;
      }

      await this.syncUser();
    } catch (error) {
      console.error("Sync error:", error);
    }

    console.log(`Sync completed in ${Date.now() - startTime}ms`);
  }

  /**
   * Sync posts for the single user
   */
  async syncUser(): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      postsProcessed: 0,
      postsSuccessful: 0,
      postsFailed: 0,
      errors: [],
    };

    try {
      // Get user account
      const account = await this.storage.userAccounts.getSingle();
      if (!account) {
        throw new Error("User account not found");
      }

      // Check if user has completed setup
      if (!account.setup_completed) {
        throw new Error("User setup not completed");
      }

      // Get settings
      const settings = await this.storage.settings.getSingle();
      if (!settings?.sync_enabled) {
        console.log("Sync disabled for user");
        return { ...result, success: true };
      }

      // Validate required tokens
      if (
        !account.atproto_access_token || !account.atproto_pds_url ||
        !account.atproto_did
      ) {
        throw new Error("Missing ATProto credentials");
      }

      if (!account.mastodon_access_token || !account.mastodon_instance_url) {
        throw new Error("Missing Mastodon credentials");
      }

      // Initialize ATProto client - prefer App Password from env if available
      let atprotoClient;
      let appPassword: string | undefined;
      try {
        appPassword = Deno.env.get("ATPROTO_APP_PASSWORD");
      } catch (_error) {
        // Environment access not available (e.g., in tests without --allow-env)
        appPassword = undefined;
      }

      if (appPassword && account.atproto_handle) {
        console.log(
          "Using App Password from environment for ATProto authentication",
        );
        atprotoClient = this.createATProtoClient(
          account.atproto_pds_url,
          account.atproto_handle, // Use handle instead of access token
          appPassword, // Use app password from env instead of refresh token
          account.atproto_did,
          undefined, // No token refresh callback needed for app passwords
          appPassword, // Pass app password to enable app password mode
        );
      } else {
        console.log("Using OAuth tokens for ATProto authentication");
        atprotoClient = this.createATProtoClient(
          account.atproto_pds_url,
          account.atproto_access_token,
          account.atproto_refresh_token || "",
          account.atproto_did,
          async (tokens) => {
            // Update stored tokens when they're refreshed
            console.log("Updating refreshed ATProto tokens in sync service");
            await this.storage.userAccounts.updateSingle({
              atproto_access_token: tokens.accessJwt,
              atproto_refresh_token: tokens.refreshJwt,
              atproto_token_expires_at: Date.now() + (3600 * 1000), // Assume 1 hour expiry
            });
          },
        );
      }

      const mastodonClient = this.createMastodonClient(
        account.mastodon_instance_url,
        account.mastodon_access_token,
      );

      // Get posts since last sync using cursor-based pagination
      const { posts, cursor: newCursor } = await this.fetchPostsWithCursor(
        atprotoClient,
        account.atproto_did,
        account.last_sync_cursor,
        account.last_sync_at,
        50,
      );
      result.postsProcessed = posts.length;

      console.log(`Found ${posts.length} posts for user`);

      // Process each post
      for (const post of posts) {
        try {
          // Skip posts that should not be synced
          if (PostTransformer.shouldSkipPost(post)) {
            console.log(`Skipping post ${post.uri} (reply or empty)`);
            continue;
          }

          // Check if post already exists
          const existingPost = await this.storage.postTracking.getByUri(
            post.uri,
          );
          if (existingPost) {
            console.log(`Post ${post.uri} already tracked`);
            continue;
          }

          // Create tracking record
          const contentHash = PostTransformer.generateContentHash(post);
          await this.storage.postTracking.create({
            atproto_uri: post.uri,
            atproto_cid: post.cid,
            atproto_rkey: post.uri.split("/").pop()!,
            content_hash: contentHash,
            atproto_created_at: Math.floor(
              new Date(post.record.createdAt).getTime() / 1000,
            ),
          });

          // Transform post
          const transformation = PostTransformer.transformPost(post);

          // Resolve blob URLs using the ATProto client
          const resolvedTransformation = PostTransformer.resolveBlobUrls(
            transformation,
            atprotoClient,
          );

          // Cross-post to Mastodon with retry logic
          const mastodonPost = await this.crossPostWithRetry(
            mastodonClient,
            resolvedTransformation,
          );

          // Update tracking record
          await this.storage.postTracking.updateByUri(post.uri, {
            mastodon_id: mastodonPost.id,
            mastodon_url: mastodonPost.url,
            sync_status: "success",
            synced_at: Math.floor(Date.now() / 1000),
          });

          result.postsSuccessful++;
          console.log(
            `Successfully synced post ${post.uri} to ${mastodonPost.url}`,
          );
        } catch (error) {
          result.postsFailed++;
          const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";

          result.errors.push({
            postUri: post.uri,
            message: errorMessage,
            retryable: this.isRetryableError(error),
          });

          // Update tracking record with error
          await this.storage.postTracking.updateByUri(post.uri, {
            sync_status: "failed",
            error_message: errorMessage,
            retry_count: 0,
          });

          console.error(`Failed to sync post ${post.uri}:`, error);
        }
      }

      // Update last sync time and cursor
      await this.storage.userAccounts.updateSingle({
        last_sync_at: Date.now(),
        last_sync_cursor: newCursor,
      });

      result.success = true;
    } catch (error) {
      console.error(`User sync error:`, error);
      result.errors.push({
        postUri: "general",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: false,
      });
    }

    // Log sync operation
    await this.storage.syncLogs.create({
      sync_type: "cron",
      posts_fetched: result.postsProcessed,
      posts_synced: result.postsSuccessful,
      posts_failed: result.postsFailed,
      posts_skipped: result.postsProcessed - result.postsSuccessful -
        result.postsFailed,
      error_message: result.errors.length > 0
        ? result.errors[0].message
        : undefined,
      duration_ms: Date.now() - startTime,
    });

    return result;
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
  ): Promise<{ posts: ATProtoPost[]; cursor?: string }> {
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

  /**
   * Cross-post to Mastodon with retry logic
   */
  private async crossPostWithRetry(
    mastodonClient: MastodonHttpClient,
    transformation: any,
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Upload media if present
        const mediaIds: string[] = [];
        if (transformation.media.length > 0) {
          for (const media of transformation.media) {
            try {
              // Get actual blob data from the resolved URL
              const response = await fetch(media.url);
              const blob = await response.blob();
              console.log(`Fetched ${media.type} blob:`, {
                url: media.url,
                size: blob.size,
                type: blob.type,
              });

              const uploadedMedia = await mastodonClient.uploadMedia(
                blob,
                media.description,
              );
              mediaIds.push(uploadedMedia.id);
              console.log(
                `Successfully uploaded ${media.type} to Mastodon:`,
                uploadedMedia.id,
              );
            } catch (error) {
              console.error(`Failed to upload media: ${media.url}`, error);
              // Continue with post even if media upload fails
            }
          }
        }

        // Create the post
        const post = await mastodonClient.createPost({
          status: transformation.text,
          media_ids: mediaIds,
          visibility: "public",
        });

        return post;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");

        if (attempt === this.retryConfig.maxRetries) {
          throw lastError;
        }

        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay *
            Math.pow(this.retryConfig.backoffFactor, attempt),
          this.retryConfig.maxDelay,
        );

        console.log(`Retry attempt ${attempt + 1} in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("fetch") || message.includes("network") ||
      message.includes("timeout")
    ) {
      return true;
    }

    // HTTP 5xx errors
    if (
      message.includes("500") || message.includes("502") ||
      message.includes("503") || message.includes("504")
    ) {
      return true;
    }

    // Rate limiting
    if (message.includes("429") || message.includes("rate limit")) {
      return true;
    }

    // Media processing errors
    if (message.includes("media processing")) {
      return true;
    }

    return false;
  }
}
