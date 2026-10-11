// TravelGuard AI Routes Script — Phase 7.
// Alternative routes finder with weather forecast. Vanilla JS + Fetch API only.

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const routeForm = document.getElementById("route-form");
  const originInput = document.getElementById("origin");
  const destinationInput = document.getElementById("destination");
  const travelDateInput = document.getElementById("travel-date");
  const transportSelect = document.getElementById("transport");
  const budgetInput = document.getElementById("budget");
  const findRoutesBtn = document.getElementById("find-routes-btn");
  const clearFormBtn = document.getElementById("clear-form-btn");
  const loadingOverlay = document.getElementById("loading-overlay");
  const routeError = document.getElementById("route-error");
  const resultsSection = document.getElementById("results-section");
  const routeSummary = document.getElementById("route-summary");
  const weatherCard = document.getElementById("weather-card");
  const weatherContent = document.getElementById("weather-content");
  const weatherSource = document.getElementById("weather-source");
  const routesGrid = document.getElementById("routes-grid");
  const noRoutes = document.getElementById("no-routes");
  const alternativesList = document.getElementById("alternatives-list");
  const emptyAlternatives = document.getElementById("empty-alternatives");
  const routeMapCard = document.getElementById("route-map-card");
  const routeMapFrame = document.getElementById("route-map-frame");
  const openRouteGmaps = document.getElementById("open-route-gmaps");
  const tripChips = document.querySelectorAll(".popular-routes-chips .chip-btn");

  // State
  let csrfToken = null;
  let currentRoutes = [];
  let currentOrigin = null;
  let currentDestination = null;

  // Set minimum date to today
  if (travelDateInput) {
    const today = new Date().toISOString().split("T")[0];
    travelDateInput.min = today;
  }

  // CSRF token
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const res = await fetch("/api/auth/csrf");
    if (!res.ok) throw new Error("Could not get CSRF token");
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  // Show/hide loading
  function showLoading() {
    loadingOverlay.classList.remove("hidden");
    loadingOverlay.hidden = false;
    loadingOverlay.style.display = "flex";
    findRoutesBtn.disabled = true;
    findRoutesBtn.innerHTML = `
      <div class="spinner-small"></div>
      <span>Searching...</span>
    `;
  }

  function hideLoading() {
    loadingOverlay.classList.add("hidden");
    loadingOverlay.hidden = true;
    loadingOverlay.style.display = "none";
    findRoutesBtn.disabled = false;
    findRoutesBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <span>Find Routes</span>
    `;
  }

  // Show/hide error
  function showError(message) {
    routeError.textContent = message;
    routeError.hidden = false;
    routeError.classList.remove("hidden");
    routeError.style.display = "block";
    resultsSection.hidden = true;
    resultsSection.classList.add("hidden");
    resultsSection.style.display = "none";
  }

  function hideError() {
    routeError.hidden = true;
    routeError.classList.add("hidden");
    routeError.style.display = "none";
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Format currency
  function formatCurrency(amount, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  }

  // Render weather card
  function renderWeather(weather) {
    if (!weather || !weather.available) {
      weatherCard.hidden = true;
      return;
    }

    weatherCard.hidden = false;
    weatherSource.textContent = `Source: ${weather.source || "OpenWeatherMap"}`;

    const iconUrl = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;

    weatherContent.innerHTML = `
      <div class="weather-main">
        <img src="${iconUrl}" alt="${escapeHtml(weather.description)}" class="weather-icon">
        <div class="weather-temp">
          <span class="temp-value">${weather.temperature}°C</span>
          <span class="temp-feels">Feels like ${weather.feels_like}°C</span>
        </div>
        <div class="weather-desc">${escapeHtml(weather.description)}</div>
      </div>
      <div class="weather-details">
        <div class="weather-detail">
          <span class="detail-label">Humidity</span>
          <span class="detail-value">${weather.humidity}%</span>
        </div>
        <div class="weather-detail">
          <span class="detail-label">Wind</span>
          <span class="detail-value">${weather.wind_speed} m/s</span>
        </div>
        <div class="weather-detail">
          <span class="detail-label">Rain Chance</span>
          <span class="detail-value">${weather.precipitation_probability}%</span>
        </div>
        <div class="weather-detail">
          <span class="detail-label">Date</span>
          <span class="detail-value">${weather.date}</span>
        </div>
      </div>
    `;
  }

  // Render route cards
  function renderRoutes(routes) {
    routesGrid.innerHTML = "";

    if (routes.length === 0) {
      noRoutes.hidden = false;
      return;
    }

    noRoutes.hidden = true;

    routes.forEach((route, index) => {
      const card = document.createElement("article");
      card.className = `route-card ${route.over_budget ? "over-budget" : ""}`;
      card.setAttribute("role", "listitem");

      const costClass = route.over_budget ? "cost-over" : "";

      card.innerHTML = `
        <div class="route-header">
          <div class="route-mode">
            <span class="mode-icon" aria-hidden="true">${getModeIcon(route.transport_icon)}</span>
            <span class="mode-label">${escapeHtml(route.transport_label)}</span>
          </div>
          ${route.over_budget ? `<span class="budget-badge">Over Budget</span>` : ""}
        </div>
        <div class="route-stats">
          <div class="stat">
            <span class="stat-value">${route.distance_km} km</span>
            <span class="stat-label">Distance</span>
          </div>
          <div class="stat">
            <span class="stat-value">${route.duration_text}</span>
            <span class="stat-label">Duration</span>
          </div>
          <div class="stat">
            <span class="stat-value ${costClass}">${formatCurrency(route.estimated_cost, route.cost_currency)}</span>
            <span class="stat-label">Est. Cost</span>
          </div>
        </div>
        <p class="route-note">${escapeHtml(route.note)}</p>
        <div class="route-actions" style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
          <a class="btn btn-ghost btn-sm" href="${route.maps_directions_url || `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(currentOrigin?.display_name || originInput.value)}&destination=${encodeURIComponent(currentDestination?.display_name || destinationInput.value)}&travelmode=${route.transport_mode}`}" target="_blank" rel="noopener" aria-label="Open turn-by-turn directions">
            Directions ↗
          </a>
          <button type="button" class="btn btn-primary btn-sm save-route-btn" data-index="${index}" aria-label="Save this route">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21l-7-7 7-7"/><path d="M3 12h16"/></svg>
            Save Route
          </button>
        </div>
      `;

      routesGrid.appendChild(card);
    });

    // Add save button handlers
    routesGrid.querySelectorAll(".save-route-btn").forEach(btn => {
      btn.addEventListener("click", () => saveRoute(parseInt(btn.dataset.index)));
    });
  }

  function updateRouteMap(origin, dest) {
    if (!routeMapCard || !routeMapFrame) return;
    if (!origin || !dest || !dest.lat || !dest.lng) {
      routeMapCard.hidden = true;
      return;
    }

    const oLat = origin.lat || dest.lat;
    const oLng = origin.lng || dest.lng;
    const dLat = dest.lat;
    const dLng = dest.lng;

    const minLat = Math.min(oLat, dLat) - 0.08;
    const maxLat = Math.max(oLat, dLat) + 0.08;
    const minLng = Math.min(oLng, dLng) - 0.10;
    const maxLng = Math.max(oLng, dLng) + 0.10;

    const bbox = `${minLng.toFixed(4)}%2C${minLat.toFixed(4)}%2C${maxLng.toFixed(4)}%2C${maxLat.toFixed(4)}`;
    const marker = `${dLat.toFixed(4)}%2C${dLng.toFixed(4)}`;

    routeMapFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
    routeMapCard.hidden = false;

    if (openRouteGmaps) {
      openRouteGmaps.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.display_name || origin.name || originInput.value)}&destination=${encodeURIComponent(dest.display_name || dest.name || destinationInput.value)}`;
    }
  }

  function getModeIcon(iconName) {
    const icons = {
      plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.1 16.1a2.12 2.12 0 0 1-1.06 1.63 1.98 1.98 0 0 1-2.12 0 20.88 20.88 0 0 1-7.74-4 20.5 20.5 0 0 1-5.78-7.1 2.12 2.12 0 0 1 .77-2.72 2.14 2.14 0 0 1 2.73.77 17 17 0 0 0 4.68 5.48 16.5 16.5 0 0 0 6.58 4.26 2.1 2.1 0 0 1 1.06.22z"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/></svg>',
      train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18"/><path d="M7 16v4"/><path d="M11 16v4"/><path d="M15 16v4"/></svg>',
      bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
      car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 13.5 10c-.5 0-.9.1-1.3.3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
      ferry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20h20"/><path d="M6 14v6"/><path d="M18 14v6"/><path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M12 2v4"/></svg>'
    };
    return icons[iconName] || icons.plane;
  }

  // Render route summary
  function renderSummary(origin, destination, travelDate, routeCount) {
    let summary = `<strong>${escapeHtml(origin.display_name || origin)}</strong> → <strong>${escapeHtml(destination.display_name || destination)}</strong>`;
    if (travelDate) {
      summary += ` • ${travelDate}`;
    }
    summary += ` • ${routeCount} options found`;
    routeSummary.innerHTML = summary;
  }

  // Save a route
  async function saveRoute(index) {
    const route = currentRoutes[index];
    if (!route) return;

    const btn = routesGrid.querySelector(`.save-route-btn[data-index="${index}"]`);
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner-small"></div> Saving...`;

    try {
      const token = await getCsrfToken();
      const res = await fetch("/api/travel/save-alternative", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({
          route: {
            origin: currentOrigin,
            destination: currentDestination,
            travel_date: travelDateInput.value || null,
            ...route
          }
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save route");
      }

      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
        Saved!
      `;
      btn.classList.add("saved");

      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        btn.classList.remove("saved");
      }, 2000);

      loadAlternatives();

    } catch (err) {
      console.error("Save route error:", err);
      alert("Failed to save route: " + err.message);
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  }

  // Load saved alternatives
  async function loadAlternatives() {
    try {
      const token = await getCsrfToken();
      const res = await fetch("/api/travel/alternatives", {
        headers: { "X-CSRF-Token": token }
      });
      const data = await res.json();

      if (data.alternatives && data.alternatives.length > 0) {
        emptyAlternatives.hidden = true;
        alternativesList.innerHTML = data.alternatives.map(alt => `
          <article class="alternative-card" role="listitem">
            <div class="alt-info">
              <h4>${escapeHtml(alt.transport_label)}</h4>
              <p class="alt-route">${escapeHtml(alt.origin?.display_name || "Unknown")} → ${escapeHtml(alt.destination?.display_name || "Unknown")}</p>
              <div class="alt-meta">
                <span>${alt.distance_km ? alt.distance_km + " km" : ""}</span>
                <span>${alt.duration_minutes ? formatDuration(alt.duration_minutes) : ""}</span>
                <span>${alt.estimated_cost ? formatCurrency(alt.estimated_cost, alt.cost_currency) : ""}</span>
                ${alt.travel_date ? `<span>${alt.travel_date}</span>` : ""}
              </div>
            </div>
            <div class="alt-actions">
              <button class="btn btn-ghost btn-sm btn-danger" type="button" data-delete="${alt.id}" aria-label="Delete saved route">Delete</button>
            </div>
          </article>
        `).join("");

        alternativesList.querySelectorAll("[data-delete]").forEach(btn => {
          btn.addEventListener("click", () => deleteAlternative(btn.dataset.delete));
        });
      } else {
        emptyAlternatives.hidden = false;
        alternativesList.innerHTML = "";
        alternativesList.appendChild(emptyAlternatives);
      }
    } catch (err) {
      console.error("Load alternatives error:", err);
    }
  }

  function formatDuration(minutes) {
    if (!minutes) return "";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }

  // Delete saved alternative
  async function deleteAlternative(id) {
    if (!confirm("Delete this saved route?")) return;

    try {
      const token = await getCsrfToken();
      const res = await fetch(`/api/travel/alternatives/${id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": token }
      });

      if (!res.ok) throw new Error("Failed to delete");

      loadAlternatives();
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  }

  // Form submit
  if (routeForm) {
    routeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError();

      const origin = originInput.value.trim();
      const destination = destinationInput.value.trim();

      if (!origin || !destination) {
        showError("Please enter both origin and destination.");
        return;
      }

      showLoading();

      try {
        const token = await getCsrfToken();
        const res = await fetch("/api/travel/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
          body: JSON.stringify({
            origin,
            destination,
            travel_date: travelDateInput.value || null,
            transport: transportSelect.value || null,
            budget: budgetInput.value ? parseFloat(budgetInput.value) : null
          })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to find routes");
        }

        currentRoutes = data.routes || [];
        currentOrigin = data.origin;
        currentDestination = data.destination;

        renderSummary(data.origin, data.destination, data.travel_date, currentRoutes.length);
        renderWeather(data.weather);
        renderRoutes(currentRoutes);
        updateRouteMap(data.origin, data.destination);

        resultsSection.hidden = false;
        resultsSection.classList.remove("hidden");
        resultsSection.style.display = "block";
        resultsSection.scrollIntoView({ behavior: "smooth" });

      } catch (err) {
        console.error("Find routes error:", err);
        showError(err.message || "Failed to find routes. Please try again.");
      } finally {
        hideLoading();
      }
    });
  }

  // Clear form
  if (clearFormBtn) {
    clearFormBtn.addEventListener("click", () => {
      routeForm.reset();
      hideError();
      resultsSection.hidden = true;
      resultsSection.classList.add("hidden");
      resultsSection.style.display = "none";
      if (routeMapCard) routeMapCard.hidden = true;
      currentRoutes = [];
      currentOrigin = null;
      currentDestination = null;
    });
  }

  // Initialize
  async function init() {
    loadAlternatives();

    // Wire quick trip chips
    tripChips.forEach(chip => {
      chip.addEventListener("click", () => {
        const from = chip.getAttribute("data-from");
        const to = chip.getAttribute("data-to");
        if (from && to) {
          originInput.value = from;
          destinationInput.value = to;
          routeForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      });
    });

    // Check for plan navigation from dashboard
    const viewPlanId = sessionStorage.getItem("viewPlanId") || sessionStorage.getItem("editPlanId");
    if (viewPlanId) {
      sessionStorage.removeItem("viewPlanId");
      sessionStorage.removeItem("editPlanId");
      try {
        const res = await fetch(`/api/travel/plans/${viewPlanId}`);
        if (res.ok) {
          const data = await res.json();
          const p = data.plan;
          if (p) {
            if (p.origin) originInput.value = p.origin;
            if (p.destination) destinationInput.value = p.destination;
            if (p.travel_date) travelDateInput.value = p.travel_date;
            if (p.budget) budgetInput.value = p.budget;
            if (p.origin && p.destination) {
              routeForm.dispatchEvent(new Event("submit", { cancelable: true }));
            }
          }
        }
      } catch (err) {
        console.error("Failed to load plan from dashboard:", err);
      }
    }
  }

  init();
});