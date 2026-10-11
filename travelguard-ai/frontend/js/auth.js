// TravelGuard AI authentication script (Phase 3).
// Username + password only. All security decisions are enforced by the
// Flask backend; this script only handles UX (validation hints, loading
// and success states, redirects). Vanilla JS + Fetch API only.
document.addEventListener("DOMContentLoaded", () => {
  const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
  const MIN_PASSWORD = 8;

  let csrfToken = null;
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const res = await fetch("/api/auth/csrf");
    if (!res.ok) throw new Error("Could not start a secure session.");
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  async function postAuth(path, payload) {
    const token = await getCsrfToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON failure */ }
    return { status: res.status, data };
  }

  function showBox(id, message) {
    const box = document.getElementById(id);
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }
  function hideBoxes() {
    ["form-error", "form-success", "auth-error"].forEach((id) => {
      const box = document.getElementById(id);
      if (box) { box.hidden = true; box.textContent = ""; }
    });
  }
  function setLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  // Password visibility toggles.
  document.querySelectorAll(".toggle-visibility").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", show ? "true" : "false");
    });
  });

  // ----- Signup -----
  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideBoxes();
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const confirm = document.getElementById("confirm-password").value;
      const submit = document.getElementById("signup-submit");

      if (!USERNAME_RE.test(username)) {
        showBox("form-error", "Username must be 3-32 characters: letters, numbers, dot, underscore, or hyphen.");
        return;
      }
      if (password.length < MIN_PASSWORD) {
        showBox("form-error", "Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        showBox("form-error", "Passwords do not match.");
        return;
      }

      setLoading(submit, true, "Creating account...");
      try {
        const { status, data } = await postAuth("/api/auth/signup", { username, password, confirmPassword: confirm });
        if (status === 201) {
          showBox("form-success", "Account created. Welcome, " + data.user.username + ". Redirecting to your dashboard...");
          setTimeout(() => { window.location.href = "dashboard.html"; }, 900);
        } else {
          showBox("form-error", data.error || "Signup failed. Please try again.");
          setLoading(submit, false);
        }
      } catch (err) {
        showBox("form-error", "Cannot reach the server. Please try again.");
        setLoading(submit, false);
      }
    });
  }

  // ----- Login -----
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideBoxes();
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const submit = document.getElementById("login-submit");

      if (!username || !password) {
        showBox("form-error", "Username and password are required.");
        return;
      }

      setLoading(submit, true, "Logging in...");
      try {
        const { status, data } = await postAuth("/api/auth/login", { username, password });
        if (status === 200) {
          showBox("form-success", "Welcome back, " + data.user.username + ". Redirecting to your dashboard...");
          setTimeout(() => { window.location.href = "dashboard.html"; }, 900);
        } else if (status === 429) {
          showBox("form-error", data.error || "Too many failed login attempts. Please try again later.");
          setLoading(submit, false);
        } else {
          showBox("form-error", data.error || "Login failed. Please try again.");
          setLoading(submit, false);
        }
      } catch (err) {
        showBox("form-error", "Cannot reach the server. Please try again.");
        setLoading(submit, false);
      }
    });
  }

  // ----- Logout buttons -----
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const token = await getCsrfToken();
        await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": token } });
      } catch (err) { /* proceed to redirect regardless */ }
      window.location.href = "index.html";
    });
  });

  // ----- Page guards (UX convenience; backend enforces access) -----
  async function fetchMe() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      const data = await res.json();
      return data.user || null;
    } catch (err) {
      return null;
    }
  }

  if (document.body.hasAttribute("data-require-auth")) {
    fetchMe().then((user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      document.querySelectorAll("[data-username]").forEach((el) => { el.textContent = user.username; });
    });
  }

  if (document.body.hasAttribute("data-guest-only")) {
    fetchMe().then((user) => {
      if (user) window.location.href = "dashboard.html";
    });
  }
});
