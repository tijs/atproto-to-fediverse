// Dependency-injected sync service for better testability

import { StorageProvider } from "../interfaces/storage.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../interfaces/http-client.ts";
import { ATProtoPost, RetryConfig, SyncResult } from "../../shared/types.ts";
import { SetupValidator } from "./setup-validator.ts";
import { AuthenticationManager } from "./authentication-manager.ts";
import { PostFetcher } from "./post-fetcher.ts";
import { PostFilterManager } from "./post-filter.ts";
import { MastodonSyncer } from "./mastodon-syncer.ts";

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
  private setupValidator: SetupValidator;
  private authenticationManager: AuthenticationManager;
  private postFetcher: PostFetcher;
  private postFilterManager: PostFilterManager;
  private mastodonSyncer: MastodonSyncer;

  constructor(dependencies: SyncServiceDependencies) {
    this.storage = dependencies.storage;

    this.setupValidator = new SetupValidator(dependencies.storage);
    this.authenticationManager = new AuthenticationManager(
      dependencies.storage,
      dependencies.createATProtoClient,
      dependencies.createMastodonClient,
    );
    this.postFetcher = new PostFetcher();
    this.postFilterManager = new PostFilterManager();
    this.mastodonSyncer = new MastodonSyncer(
      dependencies.storage,
      dependencies.retryConfig,
    );
  }

  /**
   * Get the post filter manager (for customizing filters)
   */
  getPostFilterManager(): PostFilterManager {
    return this.postFilterManager;
  }

  /**
   * Filter posts based on settings and existing tracking
   */
  private async filterPosts(
    posts: ATProtoPost[],
    settings: any,
  ): Promise<ATProtoPost[]> {
    const filteredPosts: ATProtoPost[] = [];

    for (const post of posts) {
      // Apply filtering rules
      if (!this.postFilterManager.shouldSyncPost(post, settings)) {
        console.log(`Skipping post ${post.uri} (filtered by settings)`);
        continue;
      }

      // Check if post already exists
      const existingPost = await this.storage.postTracking.getByUri(post.uri);
      if (existingPost) {
        console.log(`Post ${post.uri} already tracked`);
        continue;
      }

      filteredPosts.push(post);
    }

    return filteredPosts;
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
      // Validate setup
      const { account, settings, shouldProceed } = await this.setupValidator
        .validateSetup();
      if (!shouldProceed) {
        return { ...result, success: true };
      }

      // Validate authentication and create clients
      const { atprotoClient, mastodonClient } = this.authenticationManager
        .validateAuthenticationAndCreateClients(account);

      // Fetch posts from ATProto
      const { posts, cursor: newCursor } = await this.postFetcher.fetchPosts(
        atprotoClient,
        account,
      );
      result.postsProcessed = posts.length;

      console.log(`Found ${posts.length} posts for user`);

      // Filter posts
      const filteredPosts = await this.filterPosts(posts, settings);

      console.log(`${filteredPosts.length} posts passed filtering`);

      // Sync filtered posts
      const syncResults = await this.mastodonSyncer.syncPosts(
        filteredPosts,
        atprotoClient,
        mastodonClient,
      );

      result.postsSuccessful += syncResults.successful;
      result.postsFailed += syncResults.failed;
      result.errors.push(...syncResults.errors);

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
}
