import { StorageProvider } from "../interfaces/storage.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../interfaces/http-client.ts";

export interface AuthenticationResult {
  atprotoClient: ATProtoHttpClient;
  mastodonClient: MastodonHttpClient;
}

export class AuthenticationManager {
  constructor(
    private storage: StorageProvider,
    private createATProtoClient: (
      pdsUrl: string,
      accessToken: string,
      refreshToken: string,
      did: string,
      onTokenRefresh?: (
        tokens: { accessJwt: string; refreshJwt: string },
      ) => Promise<void>,
      appPassword?: string,
    ) => ATProtoHttpClient,
    private createMastodonClient: (
      instanceUrl: string,
      accessToken: string,
    ) => MastodonHttpClient,
  ) {}

  /**
   * Validate authentication credentials and create API clients
   */
  validateAuthenticationAndCreateClients(account: any): AuthenticationResult {
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
    let atprotoClient: ATProtoHttpClient;
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

    return { atprotoClient, mastodonClient };
  }
}
