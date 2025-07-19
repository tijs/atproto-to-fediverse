/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0";
import ReactDOM from "https://esm.sh/react-dom@18.2.0/client";

interface SetupState {
  step: "start" | "connecting-bluesky" | "connecting-mastodon" | "complete";
  userId: string | null;
  error: string | null;
  loading: boolean;
}

function SetupApp() {
  const [state, setState] = useState<SetupState>({
    step: "start",
    userId: null,
    error: null,
    loading: false,
  });

  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [mastodonInstance, setMastodonInstance] = useState("");

  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`/api${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "API call failed");
    }

    return response.json();
  };

  const startSetup = async () => {
    setState({ ...state, loading: true, error: null });
    try {
      const result = await apiCall("/setup/start", { method: "POST" });

      // Store user ID in localStorage for future visits
      localStorage.setItem("bridge_user_id", result.userId);

      setState({
        ...state,
        userId: result.userId,
        step: "connecting-bluesky",
        loading: false,
      });
    } catch (error) {
      setState({
        ...state,
        error: error.message,
        loading: false,
      });
    }
  };

  const connectBluesky = async () => {
    if (!blueskyHandle) {
      setState({ ...state, error: "Please enter your Bluesky handle" });
      return;
    }

    setState({ ...state, loading: true, error: null });
    try {
      const result = await apiCall(
        `/oauth/atproto/start?handle=${
          encodeURIComponent(blueskyHandle)
        }&user_id=${state.userId}`,
      );
      globalThis.location.href = result.authUrl;
    } catch (error) {
      setState({
        ...state,
        error: error.message,
        loading: false,
      });
    }
  };

  const connectMastodon = async () => {
    if (!mastodonInstance) {
      setState({ ...state, error: "Please enter your Mastodon instance" });
      return;
    }

    setState({ ...state, loading: true, error: null });
    try {
      const result = await apiCall(
        `/oauth/mastodon/start?instance_url=${
          encodeURIComponent(mastodonInstance)
        }&user_id=${state.userId}`,
      );
      globalThis.location.href = result.authUrl;
    } catch (error) {
      setState({
        ...state,
        error: error.message,
        loading: false,
      });
    }
  };

  const completeSetup = async () => {
    setState({ ...state, loading: true, error: null });
    try {
      await apiCall(`/setup/complete/${state.userId}`, { method: "POST" });
      globalThis.location.href = `/dashboard?user_id=${state.userId}`;
    } catch (error) {
      setState({
        ...state,
        error: error.message,
        loading: false,
      });
    }
  };

  // Check URL params for OAuth callbacks and localStorage for user ID
  React.useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const step = params.get("step");
    const urlUserId = params.get("user_id");

    // Check localStorage for stored user ID
    const storedUserId = localStorage.getItem("bridge_user_id");

    // Use URL user ID if available, otherwise use stored user ID
    const userId = urlUserId || storedUserId;

    if (userId) {
      setState((prev) => ({ ...prev, userId }));
      // Update localStorage with the current user ID
      localStorage.setItem("bridge_user_id", userId);
    }

    if (step === "mastodon") {
      setState((prev) => ({ ...prev, step: "connecting-mastodon" }));
    } else if (step === "complete") {
      setState((prev) => ({ ...prev, step: "complete" }));
    }
  }, []);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Setup Your Bridge
          </h1>
          <p className="text-xl text-gray-600">
            Connect your Bluesky account to Mastodon for automatic cross-posting
          </p>
        </div>

        {state.error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{state.error}</p>
          </div>
        )}

        {state.step === "start" && (
          <div className="text-center">
            <button
              type="button"
              onClick={startSetup}
              disabled={state.loading}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {state.loading ? "Starting..." : "Get Started"}
            </button>
          </div>
        )}

        {state.step === "connecting-bluesky" && (
          <div className="bg-white rounded-lg shadow-sm p-8">
            <h2 className="text-2xl font-bold mb-4">Step 1: Connect Bluesky</h2>
            <p className="text-gray-600 mb-6">
              Enter your Bluesky handle to connect your account
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Bluesky Handle
                </label>
                <input
                  type="text"
                  value={blueskyHandle}
                  onChange={(e) => setBlueskyHandle(e.target.value)}
                  placeholder="your-handle.bsky.social"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={connectBluesky}
                disabled={state.loading}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {state.loading ? "Connecting..." : "Connect Bluesky Account"}
              </button>
            </div>
          </div>
        )}

        {state.step === "connecting-mastodon" && (
          <div className="bg-white rounded-lg shadow-sm p-8">
            <h2 className="text-2xl font-bold mb-4">
              Step 2: Connect Mastodon
            </h2>
            <p className="text-gray-600 mb-6">
              Enter your Mastodon instance to connect your account
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Mastodon Instance
                </label>
                <input
                  type="text"
                  value={mastodonInstance}
                  onChange={(e) => setMastodonInstance(e.target.value)}
                  placeholder="mastodon.social"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={connectMastodon}
                disabled={state.loading}
                className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {state.loading ? "Connecting..." : "Connect Mastodon Account"}
              </button>
            </div>
          </div>
        )}

        {state.step === "complete" && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Setup Complete!</h2>
            <p className="text-green-600 mb-4">
              ✓ Both accounts connected successfully
            </p>
            <p className="text-gray-600 mb-6">
              Your bridge is ready to start syncing posts from Bluesky to
              Mastodon.
            </p>
            <button
              type="button"
              onClick={completeSetup}
              disabled={state.loading}
              className="bg-green-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
            >
              {state.loading ? "Completing..." : "Go to Dashboard"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Initialize React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<SetupApp />);
