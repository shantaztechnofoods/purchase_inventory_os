import React, { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

// Login (rewritten 2026-10-31 — login field bug).
//
// Root cause of "typing / clearing does not work, password pre-fills, Show
// reveals nothing": the fields were React-controlled while Chrome's password
// manager autofilled the password on page load. Chrome paints an autofilled
// value but withholds it from the page until the user interacts, so React's
// copy ("") and the visible field (●●●●) disagreed — Sign In said the
// password was empty, Backspace edited a value React did not have, Show had
// nothing to show.
//
// Fix:
//   1. The inputs are uncontrolled. On submit we read exactly what is in the
//      fields, so what you see is what is sent.
//   2. The password is read-only until the user focuses it. Browsers do not
//      autofill a read-only field on load, so nothing appears by itself; the
//      saved-password picker still works once the field is focused.
//   3. 16px text on phones (no iOS zoom-on-focus jump), no autocorrect or
//      capitalisation on the username.
//
// `notice` / `onRetry`: a session that could not be restored, a missing
// profile or a disabled account is shown here, on the one login screen,
// instead of on a separate "Sign in again" page (the "duplicate login
// screen").
export default function LoginPage({ notice = "", onRetry = null }) {
  const { login } = useAuth();
  const formRef  = useRef(null);
  const userRef  = useRef(null);
  const passRef  = useRef(null);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw,  setShowPw]  = useState(false);
  const [pwLocked, setPwLocked] = useState(true); // read-only until focused (autofill guard)

  const unlockPw = () => { if (pwLocked) setPwLocked(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const username = String(userRef.current?.value || "").trim();
    const password = String(passRef.current?.value || "");
    if (!username || !password) { setError("Please enter username and password."); return; }
    setLoading(true);
    setError("");
    let result;
    try { result = await login(username, password); }
    catch (err) { result = { success: false, error: err?.message || "Login failed" }; }
    setLoading(false);
    if (!result?.success) {
      setError(result?.error || "Login failed");
      // Keep the username; clear only the password so a retry starts clean.
      if (passRef.current) passRef.current.value = "";
      passRef.current?.focus();
    }
  };

  const fieldStyle = { background: "#f8fafc", border: "1.5px solid #e2e8f0", color: "#0f172a" };
  const focusOn  = (e) => { e.target.style.borderColor = "#f0353d"; e.target.style.boxShadow = "0 0 0 3px rgba(240,53,61,0.12)"; e.target.style.background = "#fff"; };
  const focusOff = (e) => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none"; e.target.style.background = "#f8fafc"; };

  return (
    <div
      data-login-screen
      className="min-h-screen flex items-center justify-center relative overflow-hidden py-8"
      style={{ background: "radial-gradient(1200px 600px at 50% -10%, #142037 0%, #0b1120 55%)", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[680px] h-[460px] rounded-full"
             style={{ background: "radial-gradient(circle,rgba(240,53,61,0.22),transparent 70%)", filter: "blur(90px)" }} />
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "44px 44px" }} />
      </div>

      <div className="relative z-10 w-full max-w-[400px] px-4">
        <div className="text-center mb-7">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-black"
               style={{ background: "#c4151d", boxShadow: "0 10px 30px rgba(240,53,61,0.35)" }}>
            S
          </div>
          <div className="text-[16px] font-extrabold tracking-[0.14em]" style={{ color: "#f8fafc" }}>SHANTAZ</div>
          <div className="text-[10px] font-semibold tracking-[0.2em] mt-1" style={{ color: "#94a3b8" }}>TECHNOFOODS&nbsp;ERP</div>
        </div>

        <div className="rounded-2xl p-6 sm:p-8"
             style={{ background: "rgba(255,255,255,0.98)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px -20px rgba(0,0,0,0.6)" }}>
          <div className="mb-6">
            <h2 className="text-[18px] font-extrabold tracking-[-0.02em] mb-1" style={{ color: "#0f172a" }}>Welcome back</h2>
            <p className="text-[12px]" style={{ color: "#64748b" }}>Sign in to your Shantaz ERP account</p>
          </div>

          {notice && (
            <div role="status" className="mb-4 px-3.5 py-2.5 rounded-xl text-[12px] leading-snug"
                 style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.25)", color: "#92400e" }}>
              {notice}
              {onRetry && (
                <button type="button" onClick={onRetry} className="ml-2 font-bold underline" style={{ color: "#92400e" }}>Retry</button>
              )}
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className="block text-[11px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#475569" }}>
                Username
              </label>
              <input
                id="login-username"
                ref={userRef}
                name="username"
                type="text"
                defaultValue=""
                placeholder="Enter username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                onInput={() => error && setError("")}
                className="w-full px-3.5 py-3 rounded-xl text-[16px] sm:text-[13px] outline-none transition-all"
                style={fieldStyle}
                onFocus={focusOn}
                onBlur={focusOff}
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-[11px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#475569" }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  ref={passRef}
                  name="password"
                  type={showPw ? "text" : "password"}
                  defaultValue=""
                  placeholder="Enter password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={pwLocked}
                  onPointerDown={unlockPw}
                  onInput={() => error && setError("")}
                  className="w-full px-3.5 py-3 pr-16 rounded-xl text-[16px] sm:text-[13px] outline-none transition-all"
                  style={fieldStyle}
                  onFocus={(e) => { unlockPw(); focusOn(e); }}
                  onBlur={focusOff}
                />
                <button
                  type="button"
                  onClick={() => { setShowPw((v) => !v); passRef.current?.focus(); }}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  aria-controls="login-password"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold uppercase tracking-wide px-2.5 rounded-lg"
                  style={{ color: "#475569", minHeight: 36, minWidth: 52 }}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="px-3.5 py-2.5 rounded-xl text-[12px] font-medium"
                   style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)", color: "#b91c1c" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full py-3 rounded-xl text-[14px] font-bold text-white transition-all mt-1"
              style={{ background: loading ? "rgba(192,21,29,0.5)" : "#d01820", boxShadow: loading ? "none" : "0 6px 18px -4px rgba(240,53,61,0.45)", cursor: loading ? "not-allowed" : "pointer", minHeight: 46 }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] mt-6" style={{ color: "#64748b" }}>
          Shantaz Technofoods — Internal ERP · Secure Login
        </p>
      </div>
    </div>
  );
}
