/**
 * DID resolver service for ATProto identities
 * Resolves DIDs to their PDS URLs using the identity resolution system
 */

interface MiniDoc {
  did: string;
  handle?: string;
  pds?: string;
}

interface ResolveHandleResponse {
  did: string;
}

export class DIDResolver {
  private static readonly SLINGSHOT_ENDPOINT =
    "https://slingshot.microcosm.blue/xrpc";
  private static readonly PLC_DIRECTORY = "https://plc.directory";

  /**
   * Resolve a DID or handle to its PDS URL
   */
  static async resolvePDSUrl(
    identifier: string,
    fetchFn?: typeof fetch,
  ): Promise<string> {
    // If it's a handle, resolve to DID first
    let did: string;
    if (!identifier.startsWith("did:")) {
      did = await this.resolveHandleToDID(identifier, fetchFn);
    } else {
      did = identifier;
    }

    // Get the mini doc with PDS information
    const miniDoc = await this.resolveMiniDoc(did, fetchFn);

    if (!miniDoc.pds) {
      throw new Error(`No PDS URL found for DID: ${did}`);
    }

    return miniDoc.pds;
  }

  /**
   * Resolve a handle to a DID using the slingshot service
   */
  private static async resolveHandleToDID(
    handle: string,
    fetchFn?: typeof fetch,
  ): Promise<string> {
    const url =
      `${this.SLINGSHOT_ENDPOINT}/com.atproto.identity.resolveHandle?handle=${
        encodeURIComponent(handle)
      }`;

    const doFetch = fetchFn ?? fetch;
    const response = await doFetch(url);

    if (!response.ok) {
      // Consume the response body to prevent resource leak
      await response.text().catch(() => {});
      throw new Error(
        `Failed to resolve handle ${handle}: ${response.statusText}`,
      );
    }

    const data: ResolveHandleResponse = await response.json();
    return data.did;
  }

  /**
   * Resolve a DID to a mini doc containing PDS information
   * Uses the slingshot-specific query for efficient resolution
   */
  private static async resolveMiniDoc(
    did: string,
    fetchFn?: typeof fetch,
  ): Promise<MiniDoc> {
    const url =
      `${this.SLINGSHOT_ENDPOINT}/com.bad-example.identity.resolveMiniDoc?identifier=${
        encodeURIComponent(did)
      }`;

    const doFetch = fetchFn ?? fetch;
    const response = await doFetch(url);

    if (!response.ok) {
      // Consume the response body to prevent resource leak
      await response.text().catch(() => {});
      // Fallback to PLC directory if slingshot fails
      return await this.resolveMiniDocFromPLC(did, fetchFn);
    }

    const miniDoc: MiniDoc = await response.json();
    return miniDoc;
  }

  /**
   * Fallback: Resolve mini doc from PLC directory
   */
  private static async resolveMiniDocFromPLC(
    did: string,
    fetchFn?: typeof fetch,
  ): Promise<MiniDoc> {
    if (!did.startsWith("did:plc:")) {
      throw new Error(`Cannot resolve non-PLC DID from PLC directory: ${did}`);
    }

    const plcId = did.replace("did:plc:", "");
    const url = `${this.PLC_DIRECTORY}/${plcId}`;

    const doFetch = fetchFn ?? fetch;
    const response = await doFetch(url);

    if (!response.ok) {
      // Consume the response body to prevent resource leak
      await response.text().catch(() => {});
      throw new Error(
        `Failed to resolve DID from PLC directory: ${response.statusText}`,
      );
    }

    const plcDoc: any = await response.json();

    // Extract PDS URL from service endpoints
    const pdsService = plcDoc.service?.find((s: any) =>
      s.type === "AtprotoPersonalDataServer"
    );

    if (!pdsService?.serviceEndpoint) {
      throw new Error(
        `No PDS service endpoint found in PLC document for ${did}`,
      );
    }

    return {
      did: did,
      handle: plcDoc.alsoKnownAs?.[0]?.replace("at://", ""),
      pds: pdsService.serviceEndpoint,
    };
  }

  /**
   * Validate that a PDS URL is accessible
   */
  static async validatePDSUrl(
    pdsUrl: string,
    fetchFn?: typeof fetch,
  ): Promise<boolean> {
    try {
      const doFetch = fetchFn ?? fetch;
      const response = await doFetch(`${pdsUrl}/xrpc/_health`, {
        method: "GET",
      });
      return response.ok;
    } catch (_error) {
      return false;
    }
  }
}
