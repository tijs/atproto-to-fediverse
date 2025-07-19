import { BskyAgent } from "https://esm.sh/@atproto/api@0.15.23";

export class ATProtoApiClient {
  private agent: BskyAgent;
  private did: string;
  private pdsUrl: string;
  private initialAccessToken: string;
  private initialRefreshToken: string;
  private onTokenRefresh?: (
    tokens: { accessJwt: string; refreshJwt: string },
  ) => Promise<void>;

  constructor(
    pdsUrl: string,
    accessToken: string,
    refreshToken: string,
    did: string,
    onTokenRefresh?: (
      tokens: { accessJwt: string; refreshJwt: string },
    ) => Promise<void>,
  ) {
    // Use BskyAgent with bsky.social
    this.agent = new BskyAgent({
      service: "https://bsky.social",
      persistSession: (evt, session) => {
        // Handle session updates (including token refresh)
        if (evt === "update" && session && this.onTokenRefresh) {
          console.log("ATProto session updated, tokens refreshed");
          this.onTokenRefresh({
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
          }).catch((error) => {
            console.error("Failed to persist refreshed tokens:", error);
          });
        }
      },
    });
    this.did = did;
    this.pdsUrl = pdsUrl;
    this.initialAccessToken = accessToken;
    this.initialRefreshToken = refreshToken;
    this.onTokenRefresh = onTokenRefresh;
  }

  /**
   * Resume session and refresh tokens if needed
   */
  async resumeSession(): Promise<void> {
    try {
      console.log("Attempting to resume ATProto session with DID:", this.did);
      console.log("Access token length:", this.initialAccessToken.length);
      console.log("Refresh token length:", this.initialRefreshToken.length);
      console.log(
        "Access token starts with:",
        this.initialAccessToken.substring(0, 20) + "...",
      );
      console.log(
        "Refresh token starts with:",
        this.initialRefreshToken.substring(0, 20) + "...",
      );

      // Create session data - let the library handle DPoP automatically
      const sessionData = {
        did: this.did,
        accessJwt: this.initialAccessToken,
        refreshJwt: this.initialRefreshToken,
        handle: "", // Will be filled by resumeSession
        active: true,
      };

      // The library should automatically handle DPoP and token refresh
      await this.agent.resumeSession(sessionData);
      console.log("ATProto session resumed successfully");
    } catch (error) {
      console.error("Failed to resume ATProto session:", error);

      // Log the specific error for debugging
      if (error && typeof error === "object" && "error" in error) {
        console.error("Server error code:", error.error);
      }

      // If we get InvalidToken, try to get a fresh session using password auth
      if (
        error instanceof Error && (
          error.message.includes("InvalidToken") ||
          error.message.includes("Bad token scope")
        )
      ) {
        console.log(
          "DPoP tokens invalid, this is expected with the current OAuth implementation",
        );
        throw new Error(
          "ATProto tokens are invalid. Please re-authenticate with Bluesky.",
        );
      }

      throw error;
    }
  }

  /**
   * Get the current session info
   */
  getSession() {
    return this.agent.session;
  }

  /**
   * Get user profile information
   */
  async getProfile(): Promise<any> {
    try {
      const response = await this.agent.getProfile({
        actor: this.did,
      });

      if (!response.success) {
        throw new Error("Failed to get profile");
      }

      return response.data;
    } catch (error) {
      console.error("Get profile error:", error);
      throw error;
    }
  }

  /**
   * Verify credentials and test connection
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      // Try to get the current session
      const response = await this.agent.api.com.atproto.server.getSession();
      return response.success;
    } catch (error) {
      console.error("Credential verification error:", error);
      return false;
    }
  }
}
