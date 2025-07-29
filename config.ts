/**
 * Bridge Configuration
 *
 * Edit these settings to customize the behavior of your ATProto to Fediverse bridge.
 * This file contains all the configuration options that users might want to modify
 * when running their own instance.
 */

export const BRIDGE_CONFIG = {
  /**
   * Post Filtering Options
   * Configure which types of posts should be synced to Mastodon
   */
  filters: {
    // Skip posts that are replies to other posts
    skip_replies: true,

    // Skip posts that start with @mentions
    skip_mentions: true,

    // Skip reposts/quote posts (since Mastodon can't display the referenced content)
    skip_reposts: true,
  },

  /**
   * Media Handling Options
   * Configure how images and videos are processed
   */
  media: {
    // Include images and videos in synced posts
    include_media: true,

    // Compress images before uploading (reduces quality but saves bandwidth)
    compress_images: false,
  },

  /**
   * Sync Behavior Options
   * Configure general sync behavior
   */
  sync: {
    // Maximum number of posts to fetch in each sync operation
    max_posts_per_sync: 50,

    // Retry configuration for failed posts
    retry: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
    },
  },
} as const;

/**
 * Type helper for the config object
 */
export type BridgeConfig = typeof BRIDGE_CONFIG;
