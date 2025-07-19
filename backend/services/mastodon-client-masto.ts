import { createRestAPIClient } from "https://esm.sh/masto@7.2.0";
import { MastodonHttpClient } from "../interfaces/http-client.ts";

/**
 * Mastodon client using masto.js library for better reliability and media handling
 */
export class MastodonClientMasto implements MastodonHttpClient {
  private client: any;
  private instanceUrl: string;
  private accessToken: string;

  constructor(instanceUrl: string, accessToken: string) {
    this.instanceUrl = instanceUrl.replace(/\/$/, ""); // Remove trailing slash
    this.accessToken = accessToken;

    this.client = createRestAPIClient({
      url: this.instanceUrl,
      accessToken: this.accessToken,
    });
  }

  async verifyCredentials(): Promise<any> {
    try {
      return await this.client.v1.accounts.verifyCredentials();
    } catch (error) {
      console.error("Failed to verify Mastodon credentials:", error);
      throw error;
    }
  }

  async getAccount(): Promise<any> {
    return await this.verifyCredentials();
  }

  async getInstance(): Promise<any> {
    try {
      return await this.client.v1.instance.fetch();
    } catch (error) {
      console.error("Failed to get Mastodon instance info:", error);
      throw error;
    }
  }

  async uploadMedia(file: Blob, description?: string): Promise<any> {
    try {
      console.log("Uploading media to Mastodon:", {
        size: file.size,
        type: file.type,
        description: description?.substring(0, 50),
      });

      const mediaAttachment = await this.client.v1.media.create({
        file,
        description,
      });

      console.log("Media upload successful:", {
        id: mediaAttachment.id,
        type: mediaAttachment.type,
        url: mediaAttachment.url,
      });

      return mediaAttachment;
    } catch (error) {
      console.error("Failed to upload media to Mastodon:", error);
      throw error;
    }
  }

  async getMediaStatus(mediaId: string): Promise<any> {
    try {
      return await this.client.v1.media.fetch(mediaId);
    } catch (error) {
      console.error("Failed to get media status:", error);
      throw error;
    }
  }

  async createPost(params: {
    status: string;
    media_ids?: string[];
    sensitive?: boolean;
    spoiler_text?: string;
    visibility?: "public" | "unlisted" | "private" | "direct";
  }): Promise<any> {
    try {
      console.log("Creating Mastodon post:", {
        statusLength: params.status.length,
        mediaCount: params.media_ids?.length || 0,
        visibility: params.visibility || "public",
      });

      const status = await this.client.v1.statuses.create({
        status: params.status,
        mediaIds: params.media_ids,
        sensitive: params.sensitive,
        spoilerText: params.spoiler_text,
        visibility: params.visibility || "public",
      });

      console.log("Post created successfully:", {
        id: status.id,
        url: status.url,
        mediaAttachments: status.mediaAttachments?.length || 0,
      });

      return status;
    } catch (error) {
      console.error("Failed to create Mastodon post:", error);
      throw error;
    }
  }

  // OAuth registration methods (still needed for initial setup)
  async registerApp(params: {
    client_name: string;
    redirect_uris: string;
    scopes?: string;
    website?: string;
  }): Promise<any> {
    try {
      const response = await fetch(`${this.instanceUrl}/api/v1/apps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: params.client_name,
          redirect_uris: params.redirect_uris,
          scopes: params.scopes || "read write",
          website: params.website,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to register app: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to register Mastodon app:", error);
      throw error;
    }
  }

  async exchangeCodeForToken(params: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    grant_type: string;
    code: string;
  }): Promise<any> {
    try {
      const response = await fetch(`${this.instanceUrl}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to exchange code for token: ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to exchange code for token:", error);
      throw error;
    }
  }
}
