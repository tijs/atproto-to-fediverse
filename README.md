# ATProto to Fediverse Bridge

A single-user bridge service that automatically cross-posts from your Bluesky
account to your Mastodon account. Built specifically for
[Val.town](https://val.town) with TypeScript and Deno.

## What it does

- **Connects your accounts**: Securely links your Bluesky and Mastodon accounts
  using OAuth
- **Automatic syncing**: Checks for new Bluesky posts every 15 minutes and
  cross-posts them to Mastodon
- **Smart filtering**: Only syncs regular posts, not replies, reposts, or posts
  that start with mentions, so hopefully only content that makes sense in the
  Mastodon context
- **Smart transformations**: Converts Bluesky mentions (@handle.bsky.social) to
  profile links since they don't exist on Mastodon
- **Media support**: Uploads images and videos from Bluesky to your Mastodon
  instance
- **Duplicate prevention**: Tracks synced posts to avoid posting the same
  content twice
- **Error handling**: Retries failed posts and logs errors for troubleshooting

## Features

✅ **OAuth authentication** for both Bluesky and Mastodon\
✅ **Media cross-posting** (images & videos)\
✅ **Mention transformation** (handles → profile links)\
✅ **Duplicate prevention** via content hashing\
✅ **Retry mechanism** with exponential backoff\
✅ **Error logging** and sync tracking\
✅ **Setup wizard** for easy configuration

## Setup on Val.town

### 1. Clone my Val

Just clone my
[https://www.val.town/x/tijs/atproto-to-fediverse](https://www.val.town/x/tijs/atproto-to-fediverse)
val

### 2. Configure Val.town Triggers

**HTTP Trigger** (for the web interface and API):

- Set `backend/index.ts` as an **HTTP val**
- This serves the setup wizard and handles OAuth callbacks

**Cron Trigger** (for automatic syncing):

- Set `cronjob.ts` as a **Cron val**
- Schedule: `*/15 * * * *` (every 15 minutes)
- For paid accounts, you can use shorter intervals like `*/5 * * * *` (every 5
  minutes)

### 3. Environment Variables

Set these environment variables in your Val.town account:

#### Required Variables

```bash
# Your Val.town deployment URL
VALTOWN_URL=https://your-val-url.web.val.run

# Bluesky App Password for sync service (services do not work with oauth yet on bsky)
ATPROTO_APP_PASSWORD=your-bluesky-app-password

# Security: restrict login to specific handle only
ATPROTO_ALLOWED_HANDLE=your.handle.bsky.social
```

#### How to Get Your App Password

1. Go to
   [Bluesky Settings > App Passwords](https://bsky.app/settings/app-passwords)
2. Create a new App Password (name it something like "Bridge Service")
3. Copy the generated password and set it as `ATPROTO_APP_PASSWORD`

#### Security Configuration

The `ATPROTO_ALLOWED_HANDLE` variable restricts OAuth setup to only your Bluesky
handle, preventing others from hijacking your single-user bridge service.

### 4. OAuth Setup

#### For ATProto/Bluesky

The OAuth client metadata is automatically generated based on your `VALTOWN_URL`
environment variable. No manual configuration is needed!

The client metadata will be available at:

- `https://your-val-url.web.val.run/client`

#### For Mastodon

The service automatically registers with your Mastodon instance during setup -
no manual configuration needed.

### 5. Run the Setup Wizard

1. Visit your HTTP val URL (e.g., `https://your-val-url.web.val.run`)
2. **Check the Setup Status**: The landing page shows a checklist of what
   environment variables need to be configured
3. **Configure missing variables**: Set any missing environment variables in
   your Val.town settings
4. Click "Get Started" to begin the setup wizard once all required variables are
   set
5. Connect your Bluesky account by entering your handle
6. Connect your Mastodon account by entering your instance URL
7. Complete the setup - that's all!

## Usage

Once configured, the service runs automatically:

1. **Every 15 minutes** (or your configured interval), the cron job runs
2. It fetches new posts from your Bluesky account
3. Transforms the content (mentions become profile links)
4. Uploads any media to your Mastodon instance
5. Creates the cross-post on Mastodon
6. Logs the result for your review

## What Gets Cross-Posted

**✅ Included:**

- Regular posts with text
- Posts with images/videos
- Posts with links and hashtags
- Posts with mentions (converted to profile links)

**❌ Excluded:**

- Replies to other posts
- Posts that start with mentions (e.g., "@handle.bsky.social blah blah") - these
  are typically conversation starters
- Empty posts
- Posts you've already cross-posted
- Re-posts (posts that embed another post)

## Dashboard Features

- **Connection Status**: See which accounts are connected
- **Sync Controls**: Enable/disable auto-sync and trigger manual syncs
- **Recent Activity**: View recently synced posts and their status
- **Error Logs**: Track sync failures and troubleshoot issues
- **Disconnect Options**: Disconnect individual accounts if needed

## Monitoring

Visit your val's dashboard to see:

- Setup status and account connections
- Recent sync activity and statistics
- Error logs for troubleshooting
- Post sync history

## Limitations

- **Free Val.town accounts**: 15-minute minimum sync interval
- **Bluesky media limits**: 1MB images, 100MB videos
- **Mastodon compatibility**: Works with all Mastodon instances
- **Single user**: Designed for personal use (one Bluesky → one Mastodon)

## Troubleshooting

**Setup issues**: Check the setup status checklist on the landing page for
missing environment variables\
**OAuth failures**: Ensure your `VALTOWN_URL` is publicly accessible (client
metadata is auto-generated at `/client`)\
**"Unauthorized" errors**: Verify `ATPROTO_ALLOWED_HANDLE` matches your exact
Bluesky handle\
**App Password errors**: Generate a new App Password in Bluesky settings and
update `ATPROTO_APP_PASSWORD`\
**Sync not working**: Verify both accounts are connected in the dashboard\
**Missing posts**: Check the sync logs for specific error messages\
**Media upload fails**: Bluesky/Mastodon may have different file size limits

## Privacy & Security

- All tokens are stored securely in SQLite
- No data leaves your Val.town instance
- OAuth follows security best practices (PKCE, DPoP)
- **Single-user security**: `ATPROTO_ALLOWED_HANDLE` restricts access to your
  handle only
- **App Password option**: More reliable than OAuth tokens for automated
  services
- You can disconnect accounts anytime from the dashboard
- Single-user architecture prevents data mixing

## Support

This is an open-source project. For issues or feature requests, check the
repository or Val.town community forums.

---

## Built with ❤️ for the decentralized social web
