// TravelGuard AI Dashboard Script — Phase 4.
// Handles user greeting, problem categories, saved plans, and history.
// Vanilla JS + Fetch API only.

document.addEventListener("DOMContentLoaded", () => {
  // Problem categories data
  const problemCategories = [
    { id: "missed-transport", title: "Missed Flight, Train, or Bus", icon: "plane", action: "assistant" },
    { id: "cancelled-delayed", title: "Cancelled or Delayed Transportation", icon: "clock", action: "assistant" },
    { id: "lost-luggage", title: "Lost Luggage or Documents", icon: "briefcase", action: "assistant" },
    { id: "hotel-issues", title: "Hotel Booking Problems", icon: "building", action: "assistant" },
    { id: "unexpected-expenses", title: "Unexpected Expenses", icon: "credit-card", action: "assistant" },
    { id: "medical-concerns", title: "Medical Concerns", icon: "heart", action: "emergency" },
    { id: "safety-concerns", title: "Safety Concerns", icon: "shield", action: "emergency" },
    { id: "other-problems", title: "Other Travel Problems", icon: "help-circle", action: "assistant" }
  ];

  // Icon SVG paths
  const icons = {
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.1 16.1a2.12 2.12 0 0 1-1.06 1.63 1.98 1.98 0 0 1-2.12 0 20.88 20.88 0 0 1-7.74-4 20.5 20.5 0 0 1-5.78-7.1 2.12 2.12 0 0 1 .77-2.72 2.14 2.14 0 0 1 2.73.77 17 17 0 0 0 4.68 5.48 16.5 16.5 0 0 0 6.58 4.26 2.1 2.1 0 0 1 1.06.22z"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    "credit-card": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    "help-circle": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  // DOM Elements
  const problemGrid = document.getElementById("problem-grid");
  const plansList = document.getElementById("plans-list");
  const emptyPlans = document.getElementById("empty-plans");
  const historyList = document.getElementById("history-list");
  const emptyHistory = document.getElementById("empty-history");
  const quickAssistBtn = document.querySelector("[data-action='quick-assist']");

  // Render problem categories
  function renderProblems() {
    if (!problemGrid) return;
    problemGrid.innerHTML = problemCategories.map(cat => `
      <button class="problem-card" type="button" data-action="${cat.action}" data-category="${cat.id}" aria-label="${cat.title}">
        <div class="problem-icon" aria-hidden="true">${icons[cat.icon]}</div>
        <h3>${cat.title}</h3>
      </button>
    `).join("");

    // Add click handlers
    problemGrid.querySelectorAll(".problem-card").forEach(card => {
      card.addEventListener("click", () => handleProblemClick(card));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleProblemClick(card);
        }
      });
    });
  }

  function handleProblemClick(card) {
    const action = card.dataset.action;
    const category = card.dataset.category;
    const title = card.querySelector("h3").textContent;

    // Store selected category for the assistant/emergency page
    sessionStorage.setItem("selectedProblemCategory", category);
    sessionStorage.setItem("selectedProblemTitle", title);

    if (action === "assistant") {
      window.location.href = "assistant.html";
    } else if (action === "emergency") {
      window.location.href = "emergency.html";
    }
  }

  // Quick assist button
  if (quickAssistBtn) {
    quickAssistBtn.addEventListener("click", () => {
      window.location.href = "assistant.html";
    });
  }

  // Feature card navigation
  document.querySelectorAll(".feature-card").forEach(card => {
    const action = card.dataset.action;
    const btn = card.querySelector(".btn");
    const navigate = () => {
      if (action === "assistant") window.location.href = "assistant.html";
      else if (action === "emergency") window.location.href = "emergency.html";
      else if (action === "routes") window.location.href = "routes.html";
      else if (action === "translator") window.location.href = "translator.html";
    };
    card.addEventListener("click", (e) => {
      if (e.target !== btn && !btn.contains(e.target)) navigate();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate();
      }
    });
    if (btn) btn.addEventListener("click", navigate);
  });

  // New plan buttons
  document.querySelectorAll("[data-action='new-plan']").forEach(btn => {
    btn.addEventListener("click", () => {
      // Navigate to routes page to create a new plan
      window.location.href = "routes.html";
    });
  });

  // Clear history button
  const clearHistoryBtn = document.querySelector("[data-action='clear-history']");
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", async () => {
      if (!confirm("Clear all assistance history? This cannot be undone.")) return;
      clearHistoryBtn.disabled = true;
      clearHistoryBtn.textContent = "Clearing...";
      try {
        const res = await fetch("/api/travel/history", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() }
        });
        if (res.ok) {
          loadHistory();
        } else {
          alert("Failed to clear history. Please try again.");
        }
      } catch (err) {
        alert("Cannot reach the server. Please try again.");
      } finally {
        clearHistoryBtn.disabled = false;
        clearHistoryBtn.innerHTML = 'Clear History';
      }
    });
  }

  // CSRF token helper (shared with auth.js)
  let csrfTokenCache = null;
  async function getCsrfToken() {
    if (csrfTokenCache) return csrfTokenCache;
    const res = await fetch("/api/auth/csrf");
    if (!res.ok) throw new Error("Could not get CSRF token");
    const data = await res.json();
    csrfTokenCache = data.csrfToken;
    return csrfTokenCache;
  }

  // Load saved plans
  async function loadPlans() {
    if (!plansList) return;
    try {
      const res = await fetch("/api/travel/plans");
      if (!res.ok) throw new Error("Failed to load plans");
      const data = await res.json();
      renderPlans(data.plans || []);
    } catch (err) {
      console.error("Load plans error:", err);
      showEmptyPlans();
    }
  }

  function renderPlans(plans) {
    if (!plansList) return;
    if (plans.length === 0) {
      showEmptyPlans();
      return;
    }

    emptyPlans.hidden = true;
    plansList.innerHTML = plans.map(plan => `
      <article class="plan-card" role="listitem" data-plan-id="${plan.id}">
        <div class="plan-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="plan-details">
          <h3 class="plan-title">${escapeHtml(plan.title || "Untitled Trip")}</h3>
          <div class="plan-meta">
            <span>${escapeHtml(plan.origin || "")} → ${escapeHtml(plan.destination || "")}</span>
            ${plan.travel_date ? `<span>${formatDate(plan.travel_date)}</span>` : ""}
            ${plan.transport ? `<span>${escapeHtml(plan.transport)}</span>` : ""}
          </div>
        </div>
        <div class="plan-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="view-plan" data-plan-id="${plan.id}">View</button>
          <button class="btn btn-primary btn-sm" type="button" data-action="edit-plan" data-plan-id="${plan.id}">Edit</button>
          <button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="delete-plan" data-plan-id="${plan.id}">Delete</button>
        </div>
      </article>
    `).join("");

    // Add plan action handlers
    plansList.querySelectorAll("[data-action='view-plan']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const planId = btn.dataset.planId;
        sessionStorage.setItem("viewPlanId", planId);
        window.location.href = "routes.html";
      });
    });
    plansList.querySelectorAll("[data-action='edit-plan']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const planId = btn.dataset.planId;
        sessionStorage.setItem("editPlanId", planId);
        window.location.href = "routes.html";
      });
    });
    plansList.querySelectorAll("[data-action='delete-plan']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const planId = btn.dataset.planId;
        if (!confirm("Are you sure you want to delete this saved plan?")) return;
        try {
          const token = await getCsrfToken();
          const res = await fetch(`/api/travel/plans/${planId}`, {
            method: "DELETE",
            headers: { "X-CSRF-Token": token }
          });
          if (res.ok) {
            loadPlans();
          } else {
            alert("Failed to delete plan.");
          }
        } catch (err) {
          alert("Error deleting plan: " + err.message);
        }
      });
    });
  }

  function showEmptyPlans() {
    if (emptyPlans) emptyPlans.hidden = false;
    if (plansList) {
      const cards = plansList.querySelectorAll(".plan-card");
      cards.forEach(c => c.remove());
    }
  }

  // Load assistance history
  async function loadHistory() {
    if (!historyList) return;
    try {
      const res = await fetch("/api/travel/history");
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      renderHistory(data.history || []);
    } catch (err) {
      console.error("Load history error:", err);
      showEmptyHistory();
    }
  }

  function renderHistory(history) {
    if (!historyList) return;
    if (history.length === 0) {
      showEmptyHistory();
      return;
    }

    emptyHistory.hidden = true;
    historyList.innerHTML = history.map(item => `
      <article class="history-item" role="listitem">
        <div class="history-icon ${item.type || "assistant"}" aria-hidden="true">
          ${getHistoryIcon(item.type)}
        </div>
        <div class="history-content">
          <h3 class="history-title">${escapeHtml(item.title || "Assistance Session")}</h3>
          <p class="history-preview">${escapeHtml(item.preview || item.message || "No preview available")}</p>
          <div class="history-meta">
            <span class="history-type">${escapeHtml(item.type || "assistant")}</span>
            <time datetime="${item.created_at}">${formatDateTime(item.created_at)}</time>
          </div>
        </div>
      </article>
    `).join("");
  }

  function showEmptyHistory() {
    if (emptyHistory) emptyHistory.hidden = false;
    if (historyList) {
      const items = historyList.querySelectorAll(".history-item");
      items.forEach(i => i.remove());
    }
  }

  function getHistoryIcon(type) {
    switch (type) {
      case "emergency":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 12H7"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
      case "routes":
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
      default:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M12 16h.01"/></svg>';
    }
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch { return dateStr; }
  }

  function formatDateTime(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return dateStr; }
  }

  // Initialize dashboard
  async function initDashboard() {
    // Check authentication (handled by auth.js page guard)
    // Load user data
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          document.querySelectorAll("[data-username]").forEach(el => {
            el.textContent = data.user.username;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load user:", err);
    }

    // Render static content
    renderProblems();

    // Load dynamic content
    await Promise.all([loadPlans(), loadHistory()]);
  }

  initDashboard();
});