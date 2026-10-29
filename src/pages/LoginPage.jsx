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
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "radial-gradient(1200px 600px at 50% -10%, #142037 0%, #0b1120 55%)", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[680px] h-[460px] rounded-full"
             style={{ background: "radial-gradient(circle,rgba(240,53,61,0.22),transparent 70%)", filter: "blur(90px)" }} />
        <div className="absolute bottom-[-100px] right-[12%] w-[420px] h-[320px] rounded-full"
             style={{ background: "radial-gradient(circle,rgba(37,99,235,0.18),transparent 70%)", filter: "blur(90px)" }} />
        {/* subtle grid */}
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "44px 44px" }} />
      </div>

      <div className="relative z-10 w-full max-w-[380px] px-4">
        {/* Brand mark */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-black"
               style={{ background: "linear-gradient(135deg,#f0353d,#c4151d)", boxShadow: "0 10px 30px rgba(240,53,61,0.45)" }}>
            S
          </div>
          <div className="text-[16px] font-extrabold tracking-[0.14em]" style={{ color: "#f8fafc" }}>SHANTAZ</div>
          <div className="text-[10px] font-semibold tracking-[0.2em] mt-1" style={{ color: "#64748b" }}>
            TECHNOFOODS&nbsp;ERP
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8"
             style={{
               background: "rgba(255,255,255,0.98)",
               border: "1px solid rgba(255,255,255,0.1)",
               boxShadow: "0 32px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
               backdropFilter: "blur(12px)",
             }}>
          <div className="mb-6">
            <h2 className="text-[18px] font-extrabold tracking-[-0.02em] mb-1" style={{ color: "#0f172a" }}>Welcome back</h2>
            <p className="text-[12px]" style={{ color: "#64748b" }}>Sign in to your Shantaz ERP account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#64748b" }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                autoFocus
                className="w-full px-3.5 py-3 rounded-xl text-[13px] outline-none transition-all"
                style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", color: "#0f172a" }}
                onFocus={(e) => { e.target.style.borderColor = "#f0353d"; e.target.style.boxShadow = "0 0 0 3px rgba(240,53,61,0.12)"; e.target.style.background = "#fff"; }}
                onBlur={(e)  => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none"; e.target.style.background = "#f8fafc"; }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#64748b" }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="w-full px-3.5 py-3 pr-14 rounded-xl text-[13px] outline-none transition-all"
                  style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", color: "#0f172a" }}
                  onFocus={(e) => { e.target.style.borderColor = "#f0353d"; e.target.style.boxShadow = "0 0 0 3px rgba(240,53,61,0.12)"; e.target.style.background = "#fff"; }}
                  onBlur={(e)  => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none"; e.target.style.background = "#f8fafc"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wide transition-colors px-1.5 py-1 rounded-md"
                  style={{ color: "#94a3b8" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#0f172a"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; }}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3.5 py-2.5 rounded-xl text-[12px] font-medium anim-slide-down"
                   style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)", color: "#b91c1c" }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-[13px] font-bold text-white transition-all mt-1"
              style={{
                background: loading ? "rgba(192,21,29,0.4)" : "linear-gradient(180deg,#f0353d,#d01820)",
                boxShadow: loading ? "none" : "0 6px 18px -4px rgba(240,53,61,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] mt-6" style={{ color: "#475569" }}>
          Shantaz Technofoods — Internal ERP · Secure Login
        </p>
      </div>
    </div>
  );
}
