// Abstract storage interfaces for dependency injection and testability

export interface UserAccount {
  id: number;
  atproto_did?: string;
  atproto_handle?: string;
  atproto_access_token?: string;
  atproto_refresh_token?: string;
  atproto_token_expires_at?: number;
  mastodon_instance_url?: string;
  mastodon_username?: string;
  mastodon_access_token?: string;
  mastodon_client_id?: string;
  mastodon_client_secret?: string;
  setup_completed: boolean;
  last_sync_at?: number;
  last_sync_cursor?: string;
  created_at: number;
  updated_at: number;
}

export interface PostTracking {
  id: number;
  atproto_uri: string;
  atproto_cid: string;
  atproto_rkey: string;
  mastodon_id?: string;
  mastodon_url?: string;
  content_hash: string;
  sync_status: "pending" | "success" | "failed" | "skipped";
  error_message?: string;
  retry_count: number;
  max_retries: number;
  atproto_created_at: number;
  synced_at?: number;
  created_at: number;
  updated_at: number;
}

export interface Settings {
  id: number;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  skip_replies: boolean;
  skip_mentions: boolean;
  skip_reposts: boolean;
  include_media: boolean;
  compress_images: boolean;
  created_at: number;
  updated_at: number;
}

export interface SyncLog {
  id: number;
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
  created_at: number;
}

export interface SyncStats {
  total_posts: number;
  successful_posts: number;
  failed_posts: number;
  pending_posts: number;
  last_sync: number | null;
}

// Storage interface for user accounts (single user)
export interface UserAccountStorage {
  create(): Promise<UserAccount>;
  getSingle(): Promise<UserAccount | null>;
  updateSingle(updates: Partial<UserAccount>): Promise<void>;
}

// Storage interface for settings (single user)
export interface SettingsStorage {
  create(): Promise<Settings>;
  getSingle(): Promise<Settings | null>;
  updateSingle(updates: Partial<Settings>): Promise<void>;
}

// Storage interface for post tracking (single user)
export interface PostTrackingStorage {
  create(data: {
    atproto_uri: string;
    atproto_cid: string;
    atproto_rkey: string;
    content_hash: string;
    atproto_created_at: number;
  }): Promise<PostTracking>;
  getByUri(atprotoUri: string): Promise<PostTracking | null>;
  updateByUri(
    atprotoUri: string,
    updates: Partial<PostTracking>,
  ): Promise<void>;
  getPending(): Promise<PostTracking[]>;
  getFailed(): Promise<PostTracking[]>;
  getRecent(limit?: number): Promise<PostTracking[]>;
  getStats(): Promise<SyncStats>;
}

// Storage interface for sync logs (single user)
export interface SyncLogStorage {
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
  }): Promise<SyncLog>;
  getRecent(limit?: number): Promise<SyncLog[]>;
}

// Combined storage interface
export interface StorageProvider {
  userAccounts: UserAccountStorage;
  settings: SettingsStorage;
  postTracking: PostTrackingStorage;
  syncLogs: SyncLogStorage;

  // Initialize storage (run migrations, etc.)
  initialize(): Promise<void>;
}
