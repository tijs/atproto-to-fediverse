import { ATProtoHttpClient } from "../interfaces/http-client.ts";
import { ATProtoApiClient } from "./atproto-api-client.ts";
import { ATProtoPasswordClient } from "./atproto-password-client.ts";

/**
 * Adapter that implements the ATProtoHttpClient interface using either OAuth tokens or App Password
 */
export class ATProtoClientAdapter implements ATProtoHttpClient {
  private oauthClient?: ATProtoApiClient;
  private passwordClient?: ATProtoPasswordClient;
  private useAppPassword: boolean;

  constructor(
    pdsUrl: string,
    accessTokenOrHandle: string,
    refreshTokenOrAppPassword: string,
    did: string,
    onTokenRefresh?: (
      tokens: { accessJwt: string; refreshJwt: string },
    ) => Promise<void>,
    appPassword?: string,
  ) {
    // If appPassword is provided, use App Password authentication
    this.useAppPassword = !!appPassword;

    if (this.useAppPassword && appPassword) {
      console.log("Using App Password authentication for ATProto");
      this.passwordClient = new ATProtoPasswordClient(
        pdsUrl,
        accessTokenOrHandle, // This is actually the handle
        appPassword,
        did,
      );
    } else {
      console.log("Using OAuth token authentication for ATProto");
      this.oauthClient = new ATProtoApiClient(
        pdsUrl,
        accessTokenOrHandle, // This is the access token
        refreshTokenOrAppPassword, // This is the refresh token
        did,
        onTokenRefresh,
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.useAppPassword && this.passwordClient) {
      // Login with App Password
      await this.passwordClient.login();
    } else if (this.oauthClient) {
      // Resume OAuth session
      await this.oauthClient.resumeSession();
    }
  }

  private async ensureInitialized(): Promise<void> {
    // Always ensure we're authenticated before making API calls
    await this.initialize();
  }

  async fetchPosts(params: {
    actor: string;
    limit: number;
    cursor?: string;
  }): Promise<any> {
    // Post fetching only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Post fetching requires App Password authentication");
    }

    const result = await this.passwordClient.fetchRecentPosts(
      params.limit,
      params.cursor,
    );

    // Transform to match expected interface
    return {
      feed: result.posts.map((post) => ({
        post: {
          uri: post.uri,
          cid: post.cid,
          author: post.author,
          record: post.record,
          indexedAt: post.indexedAt,
        },
      })),
      cursor: result.cursor,
    };
  }

  async getPost(uri: string): Promise<any> {
    // Post fetching only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Post fetching requires App Password authentication");
    }

    const post = await this.passwordClient.getPost(uri);
    if (!post) {
      throw new Error("Post not found");
    }

    return {
      thread: {
        post: {
          uri: post.uri,
          cid: post.cid,
          author: post.author,
          record: post.record,
          indexedAt: post.indexedAt,
        },
      },
    };
  }

  async getProfile(_actor: string): Promise<any> {
    // Profile can be fetched with either client
    const client = this.useAppPassword ? this.passwordClient : this.oauthClient;
    if (!client) throw new Error("No client available");

    return await client.getProfile();
  }

  resolveHandle(_handle: string): Promise<any> {
    // The official API doesn't expose this directly, but we can use identity resolver
    throw new Error(
      "resolveHandle not implemented - use identity resolver instead",
    );
  }

  getBlob(_did: string, cid: string): Promise<string> {
    // Blob operations only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Blob operations require App Password authentication");
    }

    return Promise.resolve(this.passwordClient.resolveBlobUrl(cid));
  }

  resolveBlobUrl(cid: string): string {
    // Blob operations only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Blob operations require App Password authentication");
    }

    return this.passwordClient.resolveBlobUrl(cid);
  }

  /**
   * Get blob as Blob object for media processing
   */
  async getBlobAsBlob(cid: string): Promise<Blob> {
    // Blob operations only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Blob operations require App Password authentication");
    }

    return await this.passwordClient.getBlob(cid);
  }

  /**
   * Fetch posts with cursor support for better pagination
   */
  async fetchPostsWithCursor(params: {
    startCursor?: string;
    sinceTime?: string;
    limit: number;
  }): Promise<{ posts: any[]; cursor?: string }> {
    await this.ensureInitialized();

    // Post fetching only available with App Password client
    if (!this.useAppPassword || !this.passwordClient) {
      throw new Error("Post fetching requires App Password authentication");
    }

    const result = await this.passwordClient.fetchPostsWithCursor(
      params.startCursor,
      params.sinceTime,
      params.limit,
    );

    // Transform to match expected interface
    return {
      posts: result.posts.map((post) => ({
        post: {
          uri: post.uri,
          cid: post.cid,
          author: post.author,
          record: post.record,
          indexedAt: post.indexedAt,
        },
      })),
      cursor: result.cursor,
    };
  }

  async refreshToken(_refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    if (this.useAppPassword) {
      // App passwords don't need refresh
      throw new Error("App passwords don't require token refresh");
    }

    if (!this.oauthClient) {
      throw new Error("No OAuth client available for token refresh");
    }

    // Resume session handles token refresh
    await this.oauthClient.resumeSession();
    const session = this.oauthClient.getSession();

    if (!session) {
      throw new Error("Failed to refresh token");
    }

    // Return in expected format
    return {
      access_token: session.accessJwt,
      refresh_token: session.refreshJwt,
      expires_in: 3600, // Default to 1 hour
    };
  }
}
