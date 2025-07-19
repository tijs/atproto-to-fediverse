// In-memory implementation of storage interfaces for testing

import {
  PostTracking,
  PostTrackingStorage,
  Settings,
  SettingsStorage,
  StorageProvider,
  SyncLog,
  SyncLogStorage,
  SyncStats,
  UserAccount,
  UserAccountStorage,
} from "../interfaces/storage.ts";

export class InMemoryUserAccountStorage implements UserAccountStorage {
  private account: UserAccount | null = null;

  create(): Promise<UserAccount> {
    this.account = {
      id: 1,
      setup_completed: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return Promise.resolve(this.account);
  }

  getSingle(): Promise<UserAccount | null> {
    return Promise.resolve(this.account);
  }

  updateSingle(updates: Partial<UserAccount>): Promise<void> {
    if (this.account) {
      Object.assign(this.account, updates, { updated_at: Date.now() });
    }
    return Promise.resolve();
  }

  // Test helpers
  clear(): void {
    this.account = null;
  }

  size(): number {
    return this.account ? 1 : 0;
  }
}

export class InMemorySettingsStorage implements SettingsStorage {
  private settings: Settings | null = null;

  create(): Promise<Settings> {
    this.settings = {
      id: 1,
      sync_enabled: true,
      sync_interval_minutes: 15,
      skip_replies: true,
      skip_mentions: false,
      skip_reposts: false,
      include_media: true,
      compress_images: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return Promise.resolve(this.settings);
  }

  getSingle(): Promise<Settings | null> {
    return Promise.resolve(this.settings);
  }

  updateSingle(updates: Partial<Settings>): Promise<void> {
    if (this.settings) {
      Object.assign(this.settings, updates, { updated_at: Date.now() });
    }
    return Promise.resolve();
  }

  // Test helpers
  clear(): void {
    this.settings = null;
  }

  size(): number {
    return this.settings ? 1 : 0;
  }
}

export class InMemoryPostTrackingStorage implements PostTrackingStorage {
  private posts = new Map<string, PostTracking>();
  private nextId = 1;

  create(data: {
    atproto_uri: string;
    atproto_cid: string;
    atproto_rkey: string;
    content_hash: string;
    atproto_created_at: number;
  }): Promise<PostTracking> {
    const post: PostTracking = {
      id: this.nextId++,
      atproto_uri: data.atproto_uri,
      atproto_cid: data.atproto_cid,
      atproto_rkey: data.atproto_rkey,
      content_hash: data.content_hash,
      sync_status: "pending",
      retry_count: 0,
      max_retries: 3,
      atproto_created_at: data.atproto_created_at,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.posts.set(data.atproto_uri, post);
    return Promise.resolve(post);
  }

  getByUri(atprotoUri: string): Promise<PostTracking | null> {
    return Promise.resolve(this.posts.get(atprotoUri) || null);
  }

  updateByUri(
    atprotoUri: string,
    updates: Partial<PostTracking>,
  ): Promise<void> {
    const post = this.posts.get(atprotoUri);
    if (post) {
      Object.assign(post, updates, { updated_at: Date.now() });
      this.posts.set(atprotoUri, post);
    }
    return Promise.resolve();
  }

  getPending(): Promise<PostTracking[]> {
    return Promise.resolve(
      Array.from(this.posts.values())
        .filter((post) =>
          post.sync_status === "pending" &&
          post.retry_count < post.max_retries
        )
        .sort((a, b) => a.atproto_created_at - b.atproto_created_at),
    );
  }

  getFailed(): Promise<PostTracking[]> {
    return Promise.resolve(
      Array.from(this.posts.values())
        .filter((post) => post.sync_status === "failed")
        .sort((a, b) => b.updated_at - a.updated_at),
    );
  }

  getRecent(limit: number = 50): Promise<PostTracking[]> {
    return Promise.resolve(
      Array.from(this.posts.values())
        .sort((a, b) => b.atproto_created_at - a.atproto_created_at)
        .slice(0, limit),
    );
  }

  getStats(): Promise<SyncStats> {
    const allPosts = Array.from(this.posts.values());

    const stats = {
      total_posts: allPosts.length,
      successful_posts:
        allPosts.filter((p) => p.sync_status === "success").length,
      failed_posts: allPosts.filter((p) => p.sync_status === "failed").length,
      pending_posts: allPosts.filter((p) => p.sync_status === "pending").length,
      last_sync: allPosts
        .filter((p) => p.synced_at)
        .reduce((latest, post) => Math.max(latest, post.synced_at!), 0) || null,
    };

    return Promise.resolve(stats);
  }

  // Test helpers
  clear(): void {
    this.posts.clear();
    this.nextId = 1;
  }

  size(): number {
    return this.posts.size;
  }

  getAll(): PostTracking[] {
    return Array.from(this.posts.values());
  }
}

export class InMemorySyncLogStorage implements SyncLogStorage {
  private logs = new Map<number, SyncLog>();
  private nextId = 1;

  create(data: {
    sync_type: "manual" | "cron" | "webhook";
    posts_fetched: number;
    posts_synced: number;
    posts_failed: number;
    posts_skipped: number;
    error_message?: string;
    stack_trace?: string;
    duration_ms?: number;
    cursor_start?: string;
    cursor_end?: string;
  }): Promise<SyncLog> {
    const log: SyncLog = {
      id: this.nextId++,
      sync_type: data.sync_type,
      posts_fetched: data.posts_fetched,
      posts_synced: data.posts_synced,
      posts_failed: data.posts_failed,
      posts_skipped: data.posts_skipped,
      error_message: data.error_message,
      stack_trace: data.stack_trace,
      duration_ms: data.duration_ms,
      cursor_start: data.cursor_start,
      cursor_end: data.cursor_end,
      created_at: Date.now(),
    };
    this.logs.set(log.id, log);
    return Promise.resolve(log);
  }

  getRecent(limit: number = 20): Promise<SyncLog[]> {
    return Promise.resolve(
      Array.from(this.logs.values())
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit),
    );
  }

  // Test helpers
  clear(): void {
    this.logs.clear();
    this.nextId = 1;
  }

  size(): number {
    return this.logs.size;
  }

  getAll(): SyncLog[] {
    return Array.from(this.logs.values());
  }
}

export class InMemoryStorageProvider implements StorageProvider {
  public userAccounts: InMemoryUserAccountStorage;
  public settings: InMemorySettingsStorage;
  public postTracking: InMemoryPostTrackingStorage;
  public syncLogs: InMemorySyncLogStorage;

  constructor() {
    this.userAccounts = new InMemoryUserAccountStorage();
    this.settings = new InMemorySettingsStorage();
    this.postTracking = new InMemoryPostTrackingStorage();
    this.syncLogs = new InMemorySyncLogStorage();
  }

  initialize(): Promise<void> {
    // No initialization needed for in-memory storage
    return Promise.resolve();
  }

  // Test helpers
  clear(): void {
    this.userAccounts.clear();
    this.settings.clear();
    this.postTracking.clear();
    this.syncLogs.clear();
  }

  size(): { accounts: number; settings: number; posts: number; logs: number } {
    return {
      accounts: this.userAccounts.size(),
      settings: this.settings.size(),
      posts: this.postTracking.size(),
      logs: this.syncLogs.size(),
    };
  }
}
