import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [showPw,   setShowPw]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError("Please enter username and password."); return; }
    setLoading(true);
    setError("");
    await new Promise((r) => setTimeout(r, 180));
    const result = await login(username.trim(), password);
    setLoading(false);
    if (!result?.success) setError(result?.error || "Login failed");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--surface-base)", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-[0.06]"
             style={{ background: "radial-gradient(circle,#E8553D,transparent)", filter: "blur(80px)" }} />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full opacity-[0.04]"
             style={{ background: "radial-gradient(circle,#3B6BCC,transparent)", filter: "blur(80px)" }} />
      </div>

      <div className="relative z-10 w-full max-w-[360px] px-4">
        {/* Brand mark */}
        <div className="text-center mb-9">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-xl font-black"
               style={{ background: "linear-gradient(135deg,#E8553D,#CC4A33)", boxShadow: "0 8px 24px rgba(232,85,61,0.36)" }}>
            S
          </div>
          <div className="text-[15px] font-bold tracking-[0.12em]" style={{ color: "var(--text-strong)" }}>SHANTAZ</div>
          <div className="text-[10px] font-semibold tracking-[0.18em] mt-0.5"
               style={{ background: "linear-gradient(90deg,#F18A75,#CC4A33)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            TECHNOFOODS ERP
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-7"
             style={{
               background: "var(--surface-card)",
               border: "1px solid var(--border-rim)",
               boxShadow: "var(--shadow-lg)",
             }}>
          <div className="mb-6">
            <h2 className="text-[15px] font-bold mb-1" style={{ color: "var(--text-strong)" }}>Sign in</h2>
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5"
                     style={{ color: "var(--text-muted)" }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl text-[13px] outline-none transition-all modal-input"
                style={{
                  background: "var(--surface-input)",
                  border: "1px solid var(--border-rim)",
                  color: "var(--text)",
                }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(232,85,61,0.52)"; e.target.style.boxShadow = "0 0 0 3px rgba(232,85,61,0.12)"; }}
                onBlur={(e)  => { e.target.style.borderColor = "var(--border-rim)"; e.target.style.boxShadow = "none"; }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5"
                     style={{ color: "var(--text-muted)" }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="w-full px-3.5 py-2.5 pr-14 rounded-xl text-[13px] outline-none transition-all modal-input"
                  style={{
                    background: "var(--surface-input)",
                    border: "1px solid var(--border-rim)",
                    color: "var(--text)",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(232,85,61,0.52)"; e.target.style.boxShadow = "0 0 0 3px rgba(232,85,61,0.12)"; }}
                  onBlur={(e)  => { e.target.style.borderColor = "var(--border-rim)"; e.target.style.boxShadow = "none"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide transition-colors px-1.5 py-1 rounded-md"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3.5 py-2.5 rounded-xl text-[12px]"
                   style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#F87171" }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all mt-1"
              style={{
                background: loading ? "rgba(204,74,51,0.35)" : "linear-gradient(135deg,#E8553D,#CC4A33)",
                boxShadow: loading ? "none" : "0 4px 16px rgba(232,85,61,0.32)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] mt-5" style={{ color: "var(--text-dim)" }}>
          Shantaz Technofoods — Internal ERP
        </p>
      </div>
    </div>
  );
}
