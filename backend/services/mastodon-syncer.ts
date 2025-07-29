import { StorageProvider } from "../interfaces/storage.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../interfaces/http-client.ts";
import { ATProtoPost, RetryConfig } from "../../shared/types.ts";
import { PostTransformer } from "./post-transformer.ts";
import { BRIDGE_CONFIG } from "../../config.ts";

export interface SyncResult {
  successful: number;
  failed: number;
  errors: any[];
}

export class MastodonSyncer {
  constructor(
    private storage: StorageProvider,
    private retryConfig: RetryConfig = BRIDGE_CONFIG.sync.retry,
  ) {}

  /**
   * Sync posts to Mastodon
   */
  async syncPosts(
    posts: ATProtoPost[],
    atprotoClient: ATProtoHttpClient,
    mastodonClient: MastodonHttpClient,
  ): Promise<SyncResult> {
    let successful = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const post of posts) {
      try {
        // Sync the post to Mastodon
        await this.syncPostToMastodon(post, atprotoClient, mastodonClient);
        successful++;
        console.log(`Successfully synced post ${post.uri}`);
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error
          ? error.message
          : "Unknown error";

        errors.push({
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

    return { successful, failed, errors };
  }

  /**
   * Sync a single post to Mastodon
   */
  async syncPostToMastodon(
    post: ATProtoPost,
    atprotoClient: ATProtoHttpClient,
    mastodonClient: MastodonHttpClient,
  ): Promise<void> {
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

        // Format the post for Mastodon (adds footnotes, handles character limits)
        const mastodonFormatted = PostTransformer.formatForMastodon(
          transformation,
        );

        // Create the post
        const post = await mastodonClient.createPost({
          status: mastodonFormatted.status,
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
