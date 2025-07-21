/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useEffect, useState } from "https://esm.sh/react@18.2.0";
import ReactDOM from "https://esm.sh/react-dom@18.2.0/client";

interface DashboardData {
  user: {
    id: string;
    atproto_handle?: string;
    mastodon_username?: string;
    setup_completed: boolean;
  };
  settings: {
    sync_enabled: boolean;
    sync_interval_minutes: number;
  };
  stats: {
    posts_synced: number;
    posts_failed: number;
    posts_pending: number;
    last_sync: string | null;
    last_sync_duration_ms: number | null;
    last_sync_posts_fetched: number;
    last_sync_posts_synced: number;
    last_sync_posts_failed: number;
  };
  recent_posts: Array<{
    id: number;
    atproto_uri: string;
    atproto_rkey: string;
    mastodon_url?: string;
    sync_status: "success" | "failed" | "pending";
    atproto_created_at: string | null;
    synced_at: string | null;
    error_message?: string;
    retry_count: number;
  }>;
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/dashboard", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated, redirect to login
          globalThis.location.href = "/login";
          return;
        }
        throw new Error(`Dashboard data fetch failed: ${response.status}`);
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (error) {
      console.error("Dashboard fetch error:", error);
      setError(error.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const toggleSync = async () => {
    if (!data) return;

    try {
      const response = await fetch("/api/dashboard/settings", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sync_enabled: !data.settings.sync_enabled,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          globalThis.location.href = "/login";
          return;
        }
        throw new Error("Failed to update sync settings");
      }

      // Refresh dashboard data
      await fetchDashboardData();
    } catch (error) {
      console.error("Toggle sync error:", error);
      setError(error.message || "Failed to toggle sync");
    }
  };

  const triggerManualSync = async () => {
    try {
      const response = await fetch("/api/dashboard/sync", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          globalThis.location.href = "/login";
          return;
        }
        throw new Error("Manual sync failed");
      }

      // Refresh dashboard data after sync
      setTimeout(() => {
        fetchDashboardData();
      }, 2000);
    } catch (error) {
      console.error("Manual sync error:", error);
      setError(error.message || "Failed to trigger sync");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      globalThis.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      // Redirect anyway
      globalThis.location.href = "/";
    }
  };

  const handleDisconnectBluesky = async () => {
    if (
      !confirm(
        "Are you sure you want to disconnect your Bluesky account? This will stop syncing your posts.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch("/api/auth/disconnect/bluesky", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        // Refresh dashboard data
        await fetchDashboardData();
      } else {
        alert("Failed to disconnect Bluesky account");
      }
    } catch (error) {
      console.error("Bluesky disconnect error:", error);
      alert("Failed to disconnect Bluesky account");
    }
  };

  const handleDisconnectMastodon = async () => {
    if (
      !confirm(
        "Are you sure you want to disconnect your Mastodon account? This will stop syncing your posts.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch("/api/auth/disconnect/mastodon", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        // Refresh dashboard data
        await fetchDashboardData();
      } else {
        alert("Failed to disconnect Mastodon account");
      }
    } catch (error) {
      console.error("Mastodon disconnect error:", error);
      alert("Failed to disconnect Mastodon account");
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-gray-700">
            Loading Dashboard...
          </div>
          <div className="mt-2 text-gray-500">
            Please wait while we load your data
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="text-2xl font-semibold text-red-600 mb-4">Error</div>
          <div className="text-gray-700 mb-4">{error}</div>
          <button
            type="button"
            onClick={() => globalThis.location.href = "/setup"}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Setup
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-gray-700">
            No Data Available
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Bridge Dashboard
          </h1>
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={() => globalThis.location.href = "/setup"}
              className="text-blue-600 hover:text-blue-800"
            >
              Setup
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Connection Status */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Account Connections</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Bluesky</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-sm ${
                      data.user.atproto_handle
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {data.user.atproto_handle
                      ? `@${data.user.atproto_handle}`
                      : "Not Connected"}
                  </span>
                  {data.user.atproto_handle
                    ? (
                      <button
                        type="button"
                        onClick={handleDisconnectBluesky}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Disconnect
                      </button>
                    )
                    : (
                      <button
                        type="button"
                        onClick={() =>
                          globalThis.location.href = "/setup?step=bluesky"}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Connect
                      </button>
                    )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Mastodon</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-sm ${
                      data.user.mastodon_username
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {data.user.mastodon_username
                      ? `@${data.user.mastodon_username}`
                      : "Not Connected"}
                  </span>
                  {data.user.mastodon_username
                    ? (
                      <button
                        type="button"
                        onClick={handleDisconnectMastodon}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Disconnect
                      </button>
                    )
                    : (
                      <button
                        type="button"
                        onClick={() =>
                          globalThis.location.href = "/setup?step=mastodon"}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Connect
                      </button>
                    )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Sync Settings</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Auto Sync</span>
                <button
                  type="button"
                  onClick={toggleSync}
                  className={`px-3 py-1 rounded text-sm font-medium ${
                    data.settings.sync_enabled
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-gray-600 text-white hover:bg-gray-700"
                  }`}
                >
                  {data.settings.sync_enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Sync Interval</span>
                <span className="text-gray-900">
                  {data.settings.sync_interval_minutes} minutes
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm text-center">
            <div className="text-2xl font-bold text-blue-600">
              {data.stats.posts_synced}
            </div>
            <div className="text-gray-600">Posts Synced</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm text-center">
            <div className="text-2xl font-bold text-green-600">
              {data.stats.last_sync
                ? new Date(data.stats.last_sync).toLocaleString(
                  navigator.language,
                  {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )
                : "Never"}
            </div>
            <div className="text-gray-600">Last Sync</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm text-center">
            <div className="text-2xl font-bold text-red-600">
              {data.stats.posts_failed}
            </div>
            <div className="text-gray-600">Failed Posts</div>
          </div>
        </div>

        {/* Manual Sync */}
        <div className="bg-white p-6 rounded-lg shadow-sm mb-8">
          <h3 className="text-lg font-semibold mb-4">Manual Sync</h3>
          <p className="text-gray-600 mb-4">
            Trigger a manual sync to check for new posts from Bluesky
          </p>
          <button
            type="button"
            onClick={triggerManualSync}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Sync Now
          </button>
        </div>

        {/* Recent Posts */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h3 className="text-lg font-semibold">Last 25 synced posts</h3>
          </div>
          <div className="p-6">
            {data.recent_posts.length === 0
              ? (
                <p className="text-gray-500 text-center py-8">
                  No posts synced yet. Make a post on Bluesky to see it appear
                  here!
                </p>
              )
              : (
                <div className="space-y-4">
                  {data.recent_posts.map((post) => (
                    <div key={post.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-500">
                          Synced: {post.synced_at
                            ? new Date(post.synced_at).toLocaleString(
                              navigator.language,
                              {
                                timeZone:
                                  Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone,
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )
                            : "Unknown date"}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            post.sync_status === "success"
                              ? "bg-green-100 text-green-800"
                              : post.sync_status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {post.sync_status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 mb-2">
                        <strong>Bluesky:</strong>
                        <a
                          href={post.atproto_uri.replace(
                            "at://",
                            "https://bsky.app/profile/",
                          ).replace("/app.bsky.feed.post/", "/post/")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 ml-1"
                        >
                          {post.atproto_uri.replace(
                            "at://",
                            "https://bsky.app/profile/",
                          ).replace("/app.bsky.feed.post/", "/post/")}
                        </a>
                      </div>
                      {post.mastodon_url && (
                        <div className="text-sm text-gray-700 mb-2">
                          <strong>Mastodon:</strong>
                          <a
                            href={post.mastodon_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 ml-1"
                          >
                            {post.mastodon_url}
                          </a>
                        </div>
                      )}
                      {post.error_message && (
                        <div className="text-sm text-red-600">
                          <strong>Error:</strong> {post.error_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Initialize React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<Dashboard />);
