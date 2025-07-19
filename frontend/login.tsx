/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0";
import ReactDOM from "https://esm.sh/react-dom@18.2.0/client";

interface LoginState {
  handle: string;
  loading: boolean;
  error: string | null;
}

function LoginApp() {
  const [state, setState] = useState<LoginState>({
    handle: "",
    loading: false,
    error: null,
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!state.handle) {
      setState({ ...state, error: "Please enter your Bluesky handle" });
      return;
    }

    setState({ ...state, loading: true, error: null });

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          handle: state.handle,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setState({
          ...state,
          error: data.error || "Login failed",
          loading: false,
        });
        return;
      }

      // Redirect to dashboard on success
      globalThis.location.href = "/dashboard";
    } catch (_error) {
      setState({
        ...state,
        error: "Network error. Please try again.",
        loading: false,
      });
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Welcome Back
            </h1>
            <p className="text-gray-600">
              Sign in with your Bluesky handle to access your dashboard
            </p>
          </div>

          {state.error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{state.error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bluesky Handle
              </label>
              <input
                type="text"
                value={state.handle}
                onChange={(e) => setState({ ...state, handle: e.target.value })}
                placeholder="your-handle.bsky.social"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={state.loading}
              />
            </div>

            <button
              type="submit"
              disabled={state.loading}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-gray-600">
              Don't have an account?{" "}
              <a
                href="/setup"
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Set up your bridge
              </a>
            </p>
          </div>

          <div className="mt-4 text-center">
            <a
              href="/"
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              ← Back to home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// Initialize React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<LoginApp />);
