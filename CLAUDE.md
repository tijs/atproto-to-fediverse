# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Development Commands

### Testing

```bash
# Run all tests
deno test --allow-import --allow-env

# Run specific test file
deno test --allow-import --allow-env tests/sync-service.test.ts
deno test --allow-import --allow-env tests/post-transformer.test.ts
deno test --allow-import --allow-env tests/storage.test.ts

# Run single test case
deno test --allow-import --allow-env tests/sync-service.test.ts --filter "should sync posts successfully"
```

### Linting

```bash
# Lint all files
deno lint

# Format code
deno fmt

# Type check
deno check backend/index.ts
deno check cronjob.ts
```

### Val.town Deployment

- Set `backend/index.ts` as HTTP val (serves web interface and API)
- Set `cronjob.ts` as Cron val with schedule `*/15 * * * *` (every 15 minutes)
- You can `vt push` to push changes to valtown so you can test the updated
  online endpoints

### Environment Setup

- Set `VALTOWN_URL` environment variable to your Val.town URL (e.g.,
  `https://your-username--unique-id.web.val.run`)
- Set `ATPROTO_APP_PASSWORD` environment variable to your Bluesky App Password
  for sync service
- Set `ATPROTO_ALLOWED_HANDLE` environment variable to your Bluesky handle
  (e.g., `username.bsky.social`) to restrict OAuth setup to your account only
- The client metadata is automatically generated at `/client` endpoint

#### Creating a Bluesky App Password

1. Go to Bluesky Settings → Privacy and Security → App Passwords
2. Click "Add App Password"
3. Give it a name like "ATProto to Fediverse Sync"
4. Copy the generated password and set it as `ATPROTO_APP_PASSWORD` environment
   variable
5. The sync service will automatically use App Password authentication when
   available

#### Security Setup

This is a **single-user service**. To prevent unauthorized users from hijacking
your bridge:

1. **Set `ATPROTO_ALLOWED_HANDLE`** to your Bluesky handle (e.g., `tijs.org` or
   `username.bsky.social`)
2. **Keep your setup URL private** - anyone with the URL can attempt OAuth, but
   only your handle will be accepted
3. **OAuth verification**: The service will reject OAuth attempts from any
   handle that doesn't match `ATPROTO_ALLOWED_HANDLE`

Example rejection message:

```
"This service is configured for tijs.org only. You are logged in as someone.else.bsky.social."
```

## Workflow Recommendations

- Make it a point to run deno lint, test and fmt after any big change

## Debugging Tips

- You can use curl to check endpoints yourself if you are debugging

## Architecture Overview

This is a **single-user bridge service** that cross-posts from Bluesky to
Mastodon, built specifically for Val.town with dependency injection for
testability.

### Core Architecture Pattern

The codebase follows a **dependency injection pattern** with clear separation
between:

- **Interfaces** (`backend/interfaces/`) - Abstract contracts for storage and
  HTTP clients
- **Implementations** (`backend/storage/`, `backend/services/`) - Concrete
  implementations
- **Tests** (`tests/`) - Use in-memory mocks for fast, isolated testing

### Key Architectural Components

**Storage Layer**: Uses abstract `StorageProvider` interface with SQLite
production implementation and in-memory test implementation. **Single-user
architecture** - all database tables enforce single-row constraints with
`CHECK (id = 1)`.

**HTTP Client Layer**: ATProto and Mastodon interactions are abstracted through
interfaces, allowing mock implementations for testing.

**Service Layer**: `SyncService` (dependency injection version) accepts
dependencies via constructor injection, making it fully testable without
external dependencies. **No userId parameters** - all methods work with the
single user.

**OAuth Flow**: Two separate OAuth implementations (ATProto uses PKCE + DPoP,
Mastodon uses traditional OAuth2) handled in `backend/routes/oauth.ts`.

**Session Management**: SQLite-backed sessions for Val.town persistence
(serverless environment doesn't persist in-memory data).

### Data Flow

1. **Setup**: User runs setup wizard → OAuth tokens stored in SQLite (single
   user account)
2. **Sync**: Cron job (`cronjob.ts`) → `SyncService.syncUser()` → fetches posts
   from ATProto → transforms content → posts to Mastodon
3. **Transformation**: `PostTransformer` converts Bluesky mentions to profile
   links since Mastodon handles don't exist cross-platform
4. **Tracking**: Every post sync is tracked in database with status
   (pending/success/failed) and retry logic

### File Structure Logic

- `backend/index.ts` - Main HTTP server (Hono app) serving setup wizard and
  OAuth callbacks
- `cronjob.ts` - Scheduled sync job (runs every 15 minutes)
- `backend/services/sync-service-di.ts` - **Main sync logic** with dependency
  injection (single-user)
- `backend/services/sync-service.ts` - Alternative sync service (simplified,
  single-user)
- `backend/interfaces/` - Abstract contracts for testability (single-user
  interfaces)
- `backend/storage/` - SQLite (production) and in-memory (testing)
  implementations
- `backend/database/` - Database schema and queries (single-user constraints)
- `backend/lib/` - Session management and debug logging
- `frontend/` - Multiple HTML pages and React components (landing, setup,
  dashboard)
- `shared/types.ts` - TypeScript interfaces shared between frontend and backend

### Testing Strategy

Tests use **in-memory storage** and **mock HTTP clients** for fast, isolated
testing:

- `InMemoryStorageProvider` - Full single-user storage implementation in memory
- `MockATProtoClient` / `MockMastodonClient` - Controllable mock API clients
- Tests verify business logic without external dependencies
- All tests updated for single-user architecture (no userId parameters)

### Val.town Specifics

Built for Val.town's serverless environment:

- Uses Val.town's SQLite hosting (`https://esm.town/v/stevekrouse/sqlite`)
- Uses Val.town utility functions (`https://esm.town/v/std/utils`)
- Follows Val.town's file serving patterns for static assets
- Environment variables for OAuth configuration
- SQLite-backed sessions for persistence across serverless requests
- Single-user architecture perfect for personal Val.town deployments

### OAuth Implementation Details

**ATProto OAuth**: Uses PKCE flow with DPoP (Demonstration of Proof of
Possession) for enhanced security. Client metadata is automatically served at
`/client` endpoint.

**Mastodon OAuth**: Automatically registers app with user's Mastodon instance
during setup flow.

**Session Management**: Cookie-based sessions stored in SQLite for persistence
in serverless environment.

### Content Transformation Logic

The `PostTransformer` handles the key business logic:

- Converts `@handle.bsky.social` mentions to
  `https://bsky.app/profile/handle.bsky.social` links
- Extracts and processes media (images/videos)
- Generates content hashes for duplicate prevention
- Handles ATProto facets (mentions, hashtags, links)

### Error Handling & Retry Logic

Implements exponential backoff retry mechanism:

- 3 retry attempts by default
- Base delay: 1 second, max delay: 30 seconds
- Distinguishes between retryable (network, 5xx) and non-retryable errors
- All errors logged to database for debugging
- Debug logging system accessible via browser (`/api/debug/logs`) since Val.town
  doesn't provide server logs

### Database Schema (Single-User)

**Key principle**: All tables enforce single-row constraints with
`CHECK (id = 1)`:

- `bridge_user_accounts_v1` - Single user account (no user_id field)
- `bridge_settings_v1` - Single user settings
- `bridge_post_tracking_v1` - Post sync tracking (no user_id field)
- `bridge_sync_logs_v1` - Sync operation logs (no user_id field)
- `sessions` - Cookie-based sessions

### Storage Interface Changes

**Single-user methods** (no userId parameters):

- `getUserAccount()` / `getSingle()` - Get the single user
- `updateUserAccount(updates)` / `updateSingle(updates)` - Update single user
- `getSettings()` / `getSingle()` - Get single user settings
- `postTracking.getByUri(uri)` - Get post by URI (no userId)
- `postTracking.updateByUri(uri, updates)` - Update post by URI
