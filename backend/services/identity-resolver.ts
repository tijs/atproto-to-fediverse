// ATProto identity resolution service
import {
  DidResolver,
  HandleResolver,
} from "https://esm.sh/@atproto/identity@0.4.7";
export class IdentityResolver {
  private didResolver: DidResolver;
  private handleResolver: HandleResolver;

  constructor() {
    this.didResolver = new DidResolver({});
    this.handleResolver = new HandleResolver({});
  }

  /**
   * Resolve a handle to a DID
   */
  async resolveHandleToDid(handle: string): Promise<string | null> {
    try {
      const cleanHandle = handle.replace("@", "");
      const did = await this.handleResolver.resolve(cleanHandle);

      if (!did) {
        return null;
      }

      return did;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Resolve a DID to get its ATProto data including handle
   */
  async resolveDidToHandle(did: string): Promise<string | null> {
    try {
      // Get ATProto-specific data from the DID document
      const atprotoData = await this.didResolver.resolveAtprotoData(did);

      if (!atprotoData?.handle) {
        return null;
      }

      return atprotoData.handle;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Get the DID document for a given DID
   */
  async getDidDocument(did: string, forceRefresh = false) {
    try {
      const document = await this.didResolver.resolve(did, forceRefresh);

      return document;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Resolve a handle to its PDS URL using proper ATProto identity resolution
   */
  async resolveHandleToPds(handle: string): Promise<string | null> {
    try {
      const cleanHandle = handle.replace("@", "");

      // First resolve handle to DID
      const did = await this.handleResolver.resolve(cleanHandle);
      if (!did) {
        return null;
      }

      // Then get ATProto data which includes PDS endpoint
      const atprotoData = await this.didResolver.resolveAtprotoData(did);
      if (!atprotoData?.pds) {
        return null;
      }

      return atprotoData.pds;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Get ATProto-specific data from a DID
   */
  async getAtprotoData(did: string) {
    try {
      const atprotoData = await this.didResolver.resolveAtprotoData(did);

      return atprotoData;
    } catch (_error) {
      return null;
    }
  }
}

// Export a singleton instance
export const identityResolver = new IdentityResolver();
