// HTTP client interfaces for external API calls (testable)

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  json(): Promise<any>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

export interface HttpClient {
  get(url: string, options?: {
    headers?: Record<string, string>;
    timeout?: number;
  }): Promise<HttpResponse>;

  post(url: string, options?: {
    headers?: Record<string, string>;
    body?: string | FormData;
    timeout?: number;
  }): Promise<HttpResponse>;

  put(url: string, options?: {
    headers?: Record<string, string>;
    body?: string | FormData;
    timeout?: number;
  }): Promise<HttpResponse>;

  head(url: string, options?: {
    headers?: Record<string, string>;
    timeout?: number;
  }): Promise<HttpResponse>;
}

// ATProto-specific client interface
export interface ATProtoHttpClient {
  fetchPosts(params: {
    actor: string;
    limit: number;
    cursor?: string;
  }): Promise<any>;

  getPost(uri: string): Promise<any>;

  getProfile(actor: string): Promise<any>;

  resolveHandle(handle: string): Promise<any>;

  getBlob(did: string, cid: string): Promise<string>;

  resolveBlobUrl(blobRef: string): string;

  refreshToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

// Mastodon-specific client interface
export interface MastodonHttpClient {
  verifyCredentials(): Promise<any>;

  getAccount(): Promise<any>;

  getInstance(): Promise<any>;

  uploadMedia(file: Blob, description?: string): Promise<{
    id: string;
    type: string;
    url: string;
    description?: string;
  }>;

  getMediaStatus(mediaId: string): Promise<any>;

  createPost(params: {
    status: string;
    media_ids?: string[];
    visibility?: string;
    sensitive?: boolean;
    spoiler_text?: string;
  }): Promise<any>;

  registerApp(params: {
    client_name: string;
    redirect_uris: string;
    scopes: string;
    website?: string;
  }): Promise<{
    client_id: string;
    client_secret: string;
  }>;

  exchangeCodeForToken(params: {
    code: string;
    redirect_uri: string;
    client_id: string;
    client_secret: string;
  }): Promise<{
    access_token: string;
    token_type: string;
    scope: string;
  }>;
}

// OAuth client interface
export interface OAuthClient {
  getAuthorizationUrl(params: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    state: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }): string;

  exchangeCodeForToken(params: {
    code: string;
    redirect_uri: string;
    client_id: string;
    client_secret?: string;
    code_verifier?: string;
  }): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
    scope: string;
  }>;
}
