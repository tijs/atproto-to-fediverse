import { runMigrations } from "./backend/database/migrations.ts";
import { SyncService } from "./backend/services/sync-service.ts";
import { SQLiteStorageProvider } from "./backend/storage/sqlite-storage.ts";
import { ATProtoClientAdapter } from "./backend/services/atproto-client-adapter.ts";
import { MastodonClientMasto } from "./backend/services/mastodon-client-masto.ts";

/**
 * Cron job for syncing posts from ATProto to Mastodon
 *
 * This function runs on a schedule (15 minutes for free tier)
 * and syncs posts for the single user.
 */
export default async function () {
  console.log("Cron job started:", new Date().toISOString());

  try {
    // Ensure database is initialized
    await runMigrations();

    // Set up dependencies for the sync service
    const storage = new SQLiteStorageProvider();
    const syncService = new SyncService({
      storage,
      createATProtoClient: (
        pdsUrl,
        accessToken,
        refreshToken,
        did,
        onTokenRefresh,
        appPassword,
      ) =>
        new ATProtoClientAdapter(
          pdsUrl,
          accessToken,
          refreshToken,
          did,
          onTokenRefresh,
          appPassword,
        ),
      createMastodonClient: (instanceUrl, accessToken) =>
        new MastodonClientMasto(instanceUrl, accessToken),
    });

    // Run sync for the single user
    await syncService.syncAllUsers();

    // Clean up old post logs to prevent database bloat
    try {
      await storage.cullOldPostLogs(100); // Keep only the 100 most recent posts
      console.log("Old post logs cleaned up successfully");
    } catch (error) {
      console.error("Failed to clean up old post logs:", error);
      // Don't fail the cron job if cleanup fails
    }

    console.log("Cron job completed successfully");
  } catch (error) {
    console.error("Cron job failed:", error);

    // In a production environment, you might want to send an alert
    // or log to an external service here
  }
}
