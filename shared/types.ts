// Shared types for ATProto-to-Fediverse bridge

export interface ATProtoOAuthConfig {
  clientId: string; // https URL to client metadata
  redirectUri: string;
  scope: string;
  pdsUrl?: string; // Discovered from handle
}

export interface MastodonOAuthConfig {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

export interface ATProtoPost {
  uri: string; // at:// URI
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    text: string;
    createdAt: string;
    embed?: {
      $type: string;
      images?: Array<{
        alt?: string;
        image: {
          ref: string;
          mimeType: string;
          size: number;
        };
      }>;
      video?: {
        ref: string;
        mimeType: string;
        size: number;
      };
      record?: {
        uri: string;
        cid: string;
      };
    };
    facets?: Array<{
      index: {
        byteStart: number;
        byteEnd: number;
      };
      features: Array<{
        $type: string;
        did?: string; // for mentions
        uri?: string; // for links
        tag?: string; // for hashtags
      }>;
    }>;
    reply?: {
      root: { uri: string; cid: string };
      parent: { uri: string; cid: string };
    };
  };
  indexedAt: string;
}

export interface MastodonPost {
  id: string;
  uri: string;
  url: string;
  content: string;
  created_at: string;
  media_attachments?: Array<{
    id: string;
    type: "image" | "video" | "audio";
    url: string;
    description?: string;
  }>;
}

export interface MediaUpload {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  description?: string;
}

export interface PostTransformation {
  text: string;
  media?: Array<{
    url: string;
    type: "image" | "video";
    description?: string;
  }>;
  mentions: Array<{
    handle: string;
    profileUrl: string;
  }>;
  links: Array<{
    url: string;
    displayText: string;
  }>;
  hashtags: string[];
}

export interface SyncResult {
  success: boolean;
  postsProcessed: number;
  postsSuccessful: number;
  postsFailed: number;
  errors: Array<{
    postUri: string;
    message: string;
    retryable: boolean;
  }>;
  cursor?: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  backoffFactor: number;
}

export interface BridgeConfig {
  atproto: ATProtoOAuthConfig;
  mastodon: MastodonOAuthConfig;
  sync: {
    enabled: boolean;
    intervalMinutes: number;
    batchSize: number;
    skipReplies: boolean;
    includeMedia: boolean;
  };
  retry: RetryConfig;
}

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  error?: string;
}

export interface SetupState {
  currentStep: number;
  steps: SetupStep[];
  userId: string;
  atprotoConnected: boolean;
  mastodonConnected: boolean;
  setupCompleted: boolean;
}

export interface DashboardStats {
  totalPosts: number;
  successfulPosts: number;
  failedPosts: number;
  pendingPosts: number;
  lastSyncAt?: number;
  isConnected: boolean;
  syncEnabled: boolean;
  nextSyncAt?: number;
}

export interface PostStatus {
  atprotoUri: string;
  atprotoCreatedAt: number;
  mastodonId?: string;
  mastodonUrl?: string;
  status: "pending" | "success" | "failed" | "skipped";
  errorMessage?: string;
  retryCount: number;
  syncedAt?: number;
  contentPreview: string;
}
