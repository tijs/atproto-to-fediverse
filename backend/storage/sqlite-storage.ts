import {
  PostTracking,
  PostTrackingStorage,
  Settings,
  SettingsStorage,
  StorageProvider,
  SyncLog,
  SyncLogStorage,
  UserAccount,
  UserAccountStorage,
} from "../interfaces/storage.ts";

const sqlite = (await import("https://esm.town/v/stevekrouse/sqlite")).sqlite;

class SQLiteUserAccountStorage implements UserAccountStorage {
  async create(): Promise<UserAccount> {
    const now = Date.now();
    const result = await sqlite.execute(
      `INSERT INTO bridge_user_accounts_v1 (id, setup_completed, created_at, updated_at) 
       VALUES (1, FALSE, ?, ?) 
       ON CONFLICT(id) DO UPDATE SET updated_at = ?
       RETURNING *`,
      [now, now, now],
    );
    return result.rows[0] as unknown as UserAccount;
  }

  async getSingle(): Promise<UserAccount | null> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_user_accounts_v1 WHERE id = 1`,
    );
    return result.rows.length > 0
      ? result.rows[0] as unknown as UserAccount
      : null;
  }

  async updateSingle(updates: Partial<UserAccount>): Promise<void> {
    const fields = Object.keys(updates).filter((key) => key !== "id");
    if (fields.length === 0) return;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => (updates as any)[field]);

    await sqlite.execute(
      `UPDATE bridge_user_accounts_v1 SET ${setClause}, updated_at = ? WHERE id = 1`,
      [...values, Date.now()],
    );
  }
}

class SQLiteSettingsStorage implements SettingsStorage {
  async create(): Promise<Settings> {
    const now = Date.now();
    const result = await sqlite.execute(
      `INSERT INTO bridge_settings_v1 (id, sync_enabled, sync_interval_minutes, created_at, updated_at) 
       VALUES (1, TRUE, 15, ?, ?) 
       ON CONFLICT(id) DO UPDATE SET updated_at = ?
       RETURNING *`,
      [now, now, now],
    );
    return result.rows[0] as unknown as Settings;
  }

  async getSingle(): Promise<Settings | null> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_settings_v1 WHERE id = 1`,
    );
    return result.rows.length > 0
      ? result.rows[0] as unknown as Settings
      : null;
  }

  async updateSingle(updates: Partial<Settings>): Promise<void> {
    const fields = Object.keys(updates).filter((key) => key !== "id");
    if (fields.length === 0) return;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => (updates as any)[field]);

    await sqlite.execute(
      `UPDATE bridge_settings_v1 SET ${setClause}, updated_at = ? WHERE id = 1`,
      [...values, Date.now()],
    );
  }
}

class SQLitePostTrackingStorage implements PostTrackingStorage {
  async create(
    data: Omit<PostTracking, "id" | "created_at" | "updated_at">,
  ): Promise<PostTracking> {
    const now = Math.floor(Date.now() / 1000); // Convert to Unix seconds
    const result = await sqlite.execute(
      `INSERT INTO bridge_post_tracking_v1 
       (atproto_uri, atproto_cid, atproto_rkey, content_hash, atproto_created_at, sync_status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) 
       RETURNING *`,
      [
        data.atproto_uri,
        data.atproto_cid,
        data.atproto_rkey,
        data.content_hash,
        data.atproto_created_at,
        now,
        now,
      ],
    );
    return result.rows[0] as unknown as PostTracking;
  }

  async getByUri(uri: string): Promise<PostTracking | null> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_post_tracking_v1 WHERE atproto_uri = ?`,
      [uri],
    );
    return result.rows.length > 0
      ? result.rows[0] as unknown as PostTracking
      : null;
  }

  async updateByUri(
    uri: string,
    updates: Partial<PostTracking>,
  ): Promise<void> {
    const fields = Object.keys(updates).filter((key) =>
      !["id", "atproto_uri"].includes(key)
    );
    if (fields.length === 0) return;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => (updates as any)[field]);

    await sqlite.execute(
      `UPDATE bridge_post_tracking_v1 SET ${setClause}, updated_at = ? WHERE atproto_uri = ?`,
      [...values, Math.floor(Date.now() / 1000), uri], // Convert to Unix seconds
    );
  }

  async getPending(): Promise<PostTracking[]> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_post_tracking_v1 WHERE sync_status = 'pending' ORDER BY created_at ASC`,
    );
    return result.rows as unknown as PostTracking[];
  }

  async getFailed(): Promise<PostTracking[]> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_post_tracking_v1 WHERE sync_status = 'failed' ORDER BY created_at DESC`,
    );
    return result.rows as unknown as PostTracking[];
  }

  async getRecent(limit: number = 20): Promise<PostTracking[]> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_post_tracking_v1 ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return result.rows as unknown as PostTracking[];
  }

  async getStats(): Promise<any> {
    const result = await sqlite.execute(
      `SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN sync_status = 'success' THEN 1 END) as successful_posts,
        COUNT(CASE WHEN sync_status = 'failed' THEN 1 END) as failed_posts,
        COUNT(CASE WHEN sync_status = 'pending' THEN 1 END) as pending_posts,
        MAX(created_at) as last_sync
       FROM bridge_post_tracking_v1`,
    );
    return result.rows[0];
  }
}

class SQLiteSyncLogStorage implements SyncLogStorage {
  async create(data: Omit<SyncLog, "id" | "created_at">): Promise<SyncLog> {
    const now = Math.floor(Date.now() / 1000); // Convert to Unix seconds
    const result = await sqlite.execute(
      `INSERT INTO bridge_sync_logs_v1 
       (sync_type, posts_fetched, posts_synced, posts_failed, posts_skipped, error_message, duration_ms, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
       RETURNING *`,
      [
        data.sync_type,
        data.posts_fetched,
        data.posts_synced,
        data.posts_failed,
        data.posts_skipped,
        data.error_message || null,
        data.duration_ms || null,
        now,
      ],
    );
    return result.rows[0] as unknown as SyncLog;
  }

  async getRecent(limit: number = 20): Promise<SyncLog[]> {
    const result = await sqlite.execute(
      `SELECT * FROM bridge_sync_logs_v1 ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return result.rows as unknown as SyncLog[];
  }
}

export class SQLiteStorageProvider implements StorageProvider {
  userAccounts: UserAccountStorage;
  settings: SettingsStorage;
  postTracking: PostTrackingStorage;
  syncLogs: SyncLogStorage;

  constructor() {
    this.userAccounts = new SQLiteUserAccountStorage();
    this.settings = new SQLiteSettingsStorage();
    this.postTracking = new SQLitePostTrackingStorage();
    this.syncLogs = new SQLiteSyncLogStorage();
  }

  async initialize(): Promise<void> {
    // Database migrations are handled separately
    // This method exists for interface compatibility
  }
}
