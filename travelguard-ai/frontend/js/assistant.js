// TravelGuard AI Assistant Script — Phase 5.
// AI chat with Gemini backend integration. Vanilla JS + Fetch API only.

const API_BASE = (() => {
  if (window.location.protocol === "file:") return "http://127.0.0.1:5000";
  const port = window.location.port;
  if (!port || port === "5000") return "";
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:5000`;
})();

function initAssistant() {
  // Suggested questions (including location-aware travel prompts & missed transit)
  const suggestions = [
    "🚆 I missed my train! What are my alternatives and emergency cost budget?",
    "💰 Emergency Travel Budget Estimator: compare bus, taxi, and hotel costs",
    "🏨 Where can I find safe emergency accommodation near the railway station?",
    "What are the top attractions and famous places near me?",
    "Where is the nearest hospital or 24/7 pharmacy from my current location?",
    "Recommend nearby shopping malls and movie theaters around here.",
    "Where can I rent a car or bike nearby?",
    "I lost my luggage at the station. What steps should I take?"
  ];

  // DOM Elements
  const suggestionsGrid = document.getElementById("suggestions-grid");
  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const loadingMessage = document.getElementById("loading-message");
  const errorMessage = document.getElementById("error-message");
  const errorText = document.getElementById("error-text");
  const retryBtn = document.getElementById("retry-btn");
  const clearChatBtn = document.getElementById("clear-chat-btn");
  const demoBadge = document.getElementById("demo-badge");
  const apiStatusDot = document.getElementById("api-status-dot");
  const apiStatusText = document.getElementById("api-status-text");
  const welcomeMessage = document.getElementById("welcome-message");
  const chatLocationText = document.getElementById("chat-location-text");
  const chatLocationDot = document.getElementById("chat-location-dot");
  const chatRefreshLocationBtn = document.getElementById("chat-refresh-location-btn");

  // State
  let csrfToken = null;
  let isLoading = false;
  let lastUserMessage = null;
  let chatLocation = {
    lat: 28.6139,
    lng: 77.2090,
    name: "Delhi, India",
    city: "Delhi",
    country: "India",
    isGps: false
  };

  // Detect location for chat bot
  function detectChatLocation() {
    if (chatLocationText) {
      chatLocationText.textContent = "Detecting your location...";
    }

    if (!navigator.geolocation) {
      fetchIpLocation();
      return;
    }

    const onGpsSuccess = async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      let placeName = `GPS (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      let city = "Current Area";
      let country = "Current Country";

      try {
        const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
          headers: { "Accept": "application/json" }
        });
        if (rev.ok) {
          const data = await rev.json();
          const addr = data.address || {};
          city = addr.city || addr.town || addr.village || addr.suburb || "Local Area";
          country = addr.country || "Local Country";
          placeName = [city, addr.state, country].filter(Boolean).join(", ");
        }
      } catch (e) {
        console.warn("Reverse geocode warning in chat:", e);
      }

      chatLocation = { lat, lng, name: placeName, city, country, isGps: true };
      if (chatLocationText) chatLocationText.textContent = `${placeName} (Exact GPS)`;
      if (chatLocationDot) chatLocationDot.className = "status-dot online";
    };

    const onGpsFail = () => {
      fetchIpLocation();
    };

    // First try standard accuracy with timeout, then fallback to IP
    navigator.geolocation.getCurrentPosition(
      onGpsSuccess,
      () => {
        navigator.geolocation.getCurrentPosition(
          onGpsSuccess,
          onGpsFail,
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }
    );
  }

  async function fetchIpLocation() {
    // 1. Try backend endpoint
    try {
      const res = await fetch(`${API_BASE}/api/emergency/detect-location`);
      if (res.ok) {
        const data = await res.json();
        if (data.lat && data.lng) {
          const locName = `${data.city || 'City'}, ${data.country_name || 'India'}`;
          chatLocation = {
            lat: data.lat,
            lng: data.lng,
            name: locName,
            city: data.city || "City",
            country: data.country_name || "India",
            isGps: false
          };
          if (chatLocationText) {
            chatLocationText.textContent = `${locName} (IP Location)`;
          }
          if (chatLocationDot) chatLocationDot.className = "status-dot online";
          return;
        }
      }
    } catch (e) {
      console.warn("Backend IP detection warning:", e);
    }

    // 2. Direct public IP geolocation fallback
    const endpoints = ["https://ipapi.co/json/", "https://ipwho.is/"];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const data = await res.json();
          const lat = parseFloat(data.latitude || data.lat);
          const lng = parseFloat(data.longitude || data.lon);
          const city = data.city || data.region || "Local Area";
          const country = data.country_name || data.country || "Local Country";
          if (!isNaN(lat) && !isNaN(lng)) {
            const locName = `${city}, ${country}`;
            chatLocation = { lat, lng, name: locName, city, country, isGps: false };
            if (chatLocationText) chatLocationText.textContent = `${locName} (IP Location)`;
            if (chatLocationDot) chatLocationDot.className = "status-dot online";
            return;
          }
        }
      } catch (err) {
        console.warn("Public IP lookup warning:", err);
      }
    }

    if (chatLocationText) chatLocationText.textContent = "Delhi, India (Default Area)";
    if (chatLocationDot) chatLocationDot.className = "status-dot online";
  }

  if (chatRefreshLocationBtn) {
    chatRefreshLocationBtn.addEventListener("click", () => {
      detectChatLocation();
    });
  }

  // Trigger location detection on load
  detectChatLocation();

  // Render suggestions
  function renderSuggestions() {
    if (!suggestionsGrid) return;
    suggestionsGrid.innerHTML = suggestions.map((q, i) => `
      <button class="suggestion-btn" type="button" role="listitem" data-suggestion="${i}" tabindex="0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>${escapeHtml(q)}</span>
      </button>
    `).join("");

    suggestionsGrid.querySelectorAll(".suggestion-btn").forEach(btn => {
      btn.addEventListener("click", () => useSuggestion(btn.dataset.suggestion));
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          useSuggestion(btn.dataset.suggestion);
        }
      });
    });
  }

  function useSuggestion(index) {
    const text = suggestions[index];
    if (chatInput) {
      chatInput.value = text;
      chatInput.focus();
      autoResize(chatInput);
    }
  }

  // CSRF token
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch(`${API_BASE}/api/auth/csrf`);
      if (res.ok) {
        const data = await res.json();
        csrfToken = data.csrfToken;
      }
    } catch (e) {
      console.warn("Could not retrieve CSRF token:", e);
    }
    return csrfToken;
  }

  // API status check
  async function checkApiStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/assistant/status`);
      if (res.status === 401) {
        // Not logged in - will be redirected by auth.js
        return;
      }
      const data = await res.json();
      apiStatusDot.className = "status-dot";
      if (data.demo) {
        apiStatusDot.classList.add("demo");
        apiStatusText.textContent = "Demo Mode — Configure GEMINI_API_KEY for real AI";
        demoBadge.hidden = false;
      } else {
        apiStatusDot.classList.add("online");
        apiStatusText.textContent = `AI Service Online (${data.model || "Gemini AI"})`;
        demoBadge.hidden = true;
      }
    } catch (err) {
      apiStatusDot.className = "status-dot offline";
      apiStatusText.textContent = "AI Service Unavailable";
    }
  }

  // Auto-resize textarea
  function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Enhanced markdown formatting for AI responses (tables, headers, lists, bold)
  function formatMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Markdown Table parser (| col1 | col2 |)
    html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
      const lines = match.trim().split(/\r?\n/).filter(l => l.trim().startsWith("|"));
      if (lines.length < 2) return match;

      let tableHtml = '<div style="overflow-x:auto; margin: 0.75rem 0;"><table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; border: 1.5px solid var(--c-gold); border-radius: 6px; overflow: hidden; background: #ffffff;">';
      let isHeader = true;

      lines.forEach((line, idx) => {
        // Skip separator row (|---|---|)
        if (line.replace(/[\s|:-]/g, "") === "") {
          isHeader = false;
          return;
        }
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (isHeader && idx === 0) {
          tableHtml += '<thead style="background: var(--c-cream); border-bottom: 2px solid var(--c-gold); color: var(--color-primary); font-weight: 700;"><tr>';
          cells.forEach(c => {
            tableHtml += `<th style="padding: 0.5rem 0.65rem; text-align: left; border: 1px solid rgba(233, 196, 106, 0.4);">${c}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
        } else {
          const bg = idx % 2 === 0 ? '#ffffff' : 'rgba(247, 244, 234, 0.45)';
          tableHtml += `<tr style="background: ${bg}; border-bottom: 1px solid #f0f0f0;">`;
          cells.forEach(c => {
            tableHtml += `<td style="padding: 0.45rem 0.65rem; border: 1px solid #e5e7eb; color: var(--color-text);">${c}</td>`;
          });
          tableHtml += '</tr>';
        }
      });
      tableHtml += '</tbody></table></div>';
      return tableHtml;
    });

    // Headers
    html = html.replace(/^#### (.*)$/gm, "<h5 style='font-size: 0.95rem; font-weight: 750; margin: 0.6rem 0 0.25rem; color: var(--color-primary);'>$1</h5>");
    html = html.replace(/^### (.*)$/gm, "<h4 style='font-size: 1.05rem; font-weight: 750; margin: 0.75rem 0 0.35rem; color: var(--color-primary);'>$1</h4>");
    html = html.replace(/^## (.*)$/gm, "<h3 style='font-size: 1.15rem; font-weight: 800; margin: 0.9rem 0 0.45rem; color: var(--color-primary);'>$1</h3>");

    // Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic: *text*
    html = html.replace(/(^|[^*])\*(.*?)\*([^*]|$)/g, "$1<em>$2</em>$3");
    // List items: * or - or • at start of line
    html = html.replace(/^[*\-•]\s+(.*)$/gm, "<li>$1</li>");
    // Numbered list items: 1. text
    html = html.replace(/^\d+\.\s+(.*)$/gm, "<li>$1</li>");
    // Group adjacent <li> into <ul>
    html = html.replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/g, "<ul style='margin: 0.5rem 0; padding-left: 1.25rem;'>$1</ul>");
    // Double newlines to paragraph breaks
    html = html.replace(/\n\n/g, "</p><p style='margin-top: 0.5rem;'>");
    // Single newlines to breaks
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  // Format time
  function formatTime(date) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // Add message to chat
  function addMessage(role, content, timestamp = new Date(), isDemo = false) {
    const isWelcome = role === "assistant" && content.includes("Hello! I'm your AI Travel Assistant");
    const formattedContent = role === "assistant" ? formatMarkdown(content) : escapeHtml(content);
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${role} ${isWelcome ? "welcome-message" : ""}`;
    messageDiv.innerHTML = `
      <div class="message-avatar" aria-hidden="true">
        ${role === "user"
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
        }
      </div>
      <div class="message-content">
        <div class="message-bubble">${formattedContent}</div>
        <div class="message-time">${formatTime(timestamp)}${isDemo ? ' · Demo' : ''}</div>
      </div>
    `;
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
  }

  // Show loading
  function showLoading() {
    loadingMessage.classList.remove("hidden");
    sendBtn.disabled = true;
    sendBtn.querySelector(".btn-text").textContent = "Sending...";
    scrollToBottom();
  }

  // Hide loading
  function hideLoading() {
    loadingMessage.classList.add("hidden");
    sendBtn.disabled = false;
    sendBtn.querySelector(".btn-text").textContent = "Send";
  }

  // Show error
  function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.remove("hidden");
    scrollToBottom();
  }

  // Hide error
  function hideError() {
    errorMessage.classList.add("hidden");
  }

  // Scroll to bottom
  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function getLocalAssistantResponse(message, loc) {
    const messageLower = (message || "").toLowerCase();
    const locStr = loc && loc.name ? loc.name : "your current area";

    if (messageLower.includes("train") || messageLower.includes("railway") || messageLower.includes("station")) {
      return `### 🚆 Emergency Guidance: Missed Train Alternatives & Cost Breakdown\n\n` +
        `Don't worry! Here is your step-by-step recovery plan for ${locStr}:\n\n` +
        `#### 1. Immediate Station & Ticket Actions\n` +
        `• **File TDR / Cancellation:** If you have an e-ticket (e.g. IRCTC), file an online **TDR (Ticket Deposit Receipt)** within 3–4 hours of scheduled train departure to claim permissible refund.\n` +
        `• **Visit Reservation Counter (PRS):** Ask for next departure on your corridor and check "Current Booking" or "Tatkal" availability.\n` +
        `• **Station Cloakroom & Rest:** Safely store luggage in the 24/7 railway cloakroom, or rest at the Executive Lounge / Retiring Room.\n\n` +
        `#### 2. Transit Alternatives & Cost Comparison\n\n` +
        `| Alternative Option | Estimated Cost Range | Travel Time | Best For |\n` +
        `| :--- | :--- | :--- | :--- |\n` +
        `| **Next Train (Current / Tatkal)** | ₹150 – ₹1,200 ($5 – $25) | Same as train | Most economical, direct route |\n` +
        `| **Express Bus (State / Volvo)** | ₹350 – ₹1,600 ($10 – $30) | +1 to 2 hrs | Quickest hourly departures |\n` +
        `| **Outstation Taxi (Uber / Ola)** | ₹2,500 – ₹6,500 ($35 – $85) | Fastest highway | Groups (2–4) or urgent arrival |\n` +
        `| **Station Room + Morning Train** | ₹800 – ₹2,200 ($12 – $30) | Overnight stay | Late-night safety, rested travel |\n\n` +
        `#### 3. Emergency Cost Budget Range\n` +
        `• **Ultra-Budget:** ~₹500 – ₹1,800\n` +
        `• **Fast-Track Express (Cab):** ~₹3,000 – ₹7,000\n` +
        `• **Comfort & Rest (Hotel/Room):** ~₹1,500 – ₹3,000\n\n` +
        `📞 **Emergency Helpline:** Railway **139** | National Emergency **112**.`;
    }

    if (messageLower.includes("flight") || messageLower.includes("airport") || messageLower.includes("plane")) {
      return `### ✈️ Emergency Guidance: Missed / Delayed Flight\n\n` +
        `1. **Go to Airline Customer Service Desk** immediately inside the airport terminal.\n` +
        `2. **Ask about the Flat Tire / Standby Rule:** Many airlines allow same-day standby on the next flight for a minimal fee or free if you arrive within 2 hours of departure.\n` +
        `3. **Check Nearby Train / Bus Alternatives** if your destination is under 500 km.\n` +
        `4. **Document Everything** (boarding passes, delay proof) for travel insurance claims.`;
    }

    if (messageLower.includes("hospital") || messageLower.includes("medical") || messageLower.includes("doctor") || messageLower.includes("emergency") || messageLower.includes("police")) {
      return `### 🚨 Urgent Emergency Guidance\n\n` +
        `1. **Dial National Emergency: 112** (or **911** in US, **999** in UK, **108** for Ambulance in India).\n` +
        `2. Open the **Emergency tab** in the navigation bar above to view nearby hospitals, 24/7 pharmacies, and police stations with live maps.\n` +
        `3. Keep calm and stay in a well-lit, public location while emergency services arrive.`;
    }

    if (messageLower.includes("luggage") || messageLower.includes("bag") || messageLower.includes("lost")) {
      return `### 🧳 Action Plan: Lost Luggage or Items\n\n` +
        `1. **File a Property Irregularity Report (PIR)** or Police Report at the station/airport Lost & Found counter immediately.\n` +
        `2. **Get a Reference Number** and direct contact phone number for tracking.\n` +
        `3. **List items and approximate value** for travel insurance compensation.\n` +
        `4. **Retain receipts** for emergency purchases (clothes, toiletries).`;
    }

    return `### 💡 Travel Assistance Guidance\n\n` +
      `Here are your recommended immediate steps for ${locStr}:\n\n` +
      `1. **Assess the situation calmly:** Identify whether you need rebooking, emergency accommodation, or alternate transit.\n` +
      `2. **Inquire at official desks:** Ask station/airport customer service for current departure schedules or refund rules.\n` +
      `3. **Check nearby facilities:** Visit the Emergency or Routes pages above for instant alternative transport and safety resources.\n` +
      `4. Tell me more details about your starting point and destination so I can calculate exact alternative routes and budget estimates!`;
  }

  // Send message
  async function sendMessage(message) {
    if (isLoading || !message.trim()) return;

    hideError();
    lastUserMessage = message;
    isLoading = true;

    // Add user message
    addMessage("user", message);

    // Clear input
    chatInput.value = "";
    chatInput.style.height = "auto";

    showLoading();

    try {
      const token = await getCsrfToken();
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["X-CSRF-Token"] = token;
      }

      const res = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          location: chatLocation
        })
      });

      let data = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.warn("Non-JSON chat response:", jsonErr);
      }

      if (!res.ok || !data || !data.response) {
        const fallbackResp = getLocalAssistantResponse(message, chatLocation);
        addMessage("assistant", fallbackResp, new Date(), true);
        if (data && data.error) {
          showError(data.error);
        }
        return;
      }

      // Add assistant response
      addMessage("assistant", data.response, new Date(), data.demo);

      // Update demo badge if needed
      if (data.demo) {
        demoBadge.hidden = false;
        apiStatusDot.className = "status-dot demo";
        apiStatusText.textContent = "Demo Mode — Configure GEMINI_API_KEY for real AI";
      } else {
        demoBadge.hidden = true;
        apiStatusDot.className = "status-dot online";
        apiStatusText.textContent = `AI Service Online (${data.model || "Gemini AI"})`;
      }

    } catch (err) {
      console.error("Chat error:", err);
      const fallbackResp = getLocalAssistantResponse(message, chatLocation);
      addMessage("assistant", fallbackResp, new Date(), true);
      showError("Connection issue — displayed emergency guide. Tap retry when online.");
    } finally {
      isLoading = false;
      hideLoading();
    }
  }

  // Retry last message
  function retry() {
    if (lastUserMessage) {
      hideError();
      sendMessage(lastUserMessage);
    }
  }

  // Clear conversation
  async function clearConversation() {
    if (!confirm("Clear entire conversation? This cannot be undone.")) return;

    clearChatBtn.disabled = true;
    clearChatBtn.textContent = "Clearing...";

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_BASE}/api/assistant/history`, {
        method: "DELETE",
        headers: token ? { "X-CSRF-Token": token } : {}
      });

      if (!res.ok) throw new Error("Failed to clear history");

      // Reset UI
      chatMessages.innerHTML = "";
      addMessage("assistant", "Hello! I'm your AI Travel Assistant. How can I help you today?", new Date(), false);
      lastUserMessage = null;

    } catch (err) {
      alert("Failed to clear conversation: " + err.message);
    } finally {
      clearChatBtn.disabled = false;
      clearChatBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Clear Conversation
      `;
    }
  }

  // Load history from backend
  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/assistant/history`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.history && data.history.length > 0) {
        // Remove welcome message
        if (welcomeMessage) welcomeMessage.remove();

        // Add history messages
        data.history.forEach(entry => {
          if (entry.user_message) {
            addMessage("user", escapeHtml(entry.user_message), new Date(entry.timestamp));
          }
          if (entry.assistant_response) {
            addMessage("assistant", entry.assistant_response, new Date(entry.timestamp), false);
          }
        });
      }
    } catch (err) {
      console.error("Load history error:", err);
    }
  }

  // Event Listeners for Chat Sending
  function handleFormSubmit(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const message = (chatInput ? chatInput.value : "").trim();
    if (message) {
      sendMessage(message);
    }
    return false;
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", handleFormSubmit);
  }

  if (chatForm) {
    chatForm.addEventListener("submit", handleFormSubmit);
  }

  if (chatInput) {
    chatInput.addEventListener("input", () => autoResize(chatInput));
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleFormSubmit(e);
      }
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", retry);
  }

  // Transit disruption data presets & alternatives
  const TRANSIT_ESTIMATES = {
    "Missed Train": {
      icon: "🚆",
      badge: "Railway Recovery Plan",
      rows: [
        {
          mode: "🚆 Next Train (Current Booking / Tatkal)",
          cost: "₹180 – ₹1,200",
          duration: "Same as train route",
          action: "Check PRS counter immediately & file online TDR within 3–4 hrs for missed ticket refund."
        },
        {
          mode: "🚌 Express Bus (State Transport / AC Sleeper)",
          cost: "₹350 – ₹1,500",
          duration: "+1 to 2 hrs over train",
          action: "Go to nearest Interstate Bus Terminal (ISBT) or book via state transport counter."
        },
        {
          mode: "🚕 Outstation Cab (Uber Intercity / Ola / Taxi)",
          cost: "₹2,500 – ₹6,000",
          duration: "Fastest direct highway departure",
          action: "Immediate departure; ideal for small groups (2–4 travelers) or urgent commitments."
        },
        {
          mode: "🏨 Station Retiring Room + Next Day Train",
          cost: "₹800 – ₹2,200",
          duration: "Overnight rest + next morning",
          action: "Book Station Retiring Room or 24/7 IRCTC Executive Lounge; secure luggage in cloakroom."
        }
      ],
      summary: "💡 <strong>Emergency Budget Range:</strong> Ultra-Budget: <strong>₹500 – ₹1,500</strong> | Express Cab: <strong>₹3,000 – ₹6,500</strong> | Overnight Stay: <strong>₹1,200 – ₹2,800</strong>."
    },
    "Cancelled Train": {
      icon: "🛑",
      badge: "Cancelled Train Protocol",
      rows: [
        {
          mode: "💳 100% Full PRS Refund (IRCTC / PRS Counter)",
          cost: "₹0 (100% Full Refund)",
          duration: "Instant / 3-5 bank days",
          action: "Automatic refund for e-tickets. Surrender counter paper ticket at PRS within 72 hours."
        },
        {
          mode: "🚆 Special / Diverted / Alternate Train",
          cost: "Free or standard fare",
          duration: "+1 to 3 hrs",
          action: "Inquire at Station Master / Enquiry Counter (Dial 139) for relief trains running on corridor."
        },
        {
          mode: "🚌 Intercity Express Bus (State Roadways / Sleeper)",
          cost: "₹400 – ₹1,800",
          duration: "Direct highway schedule",
          action: "Buses frequently deploy extra capacity when trains are cancelled. Check nearest major depot."
        },
        {
          mode: "🚕 Shared Outstation Taxi Pool",
          cost: "₹1,800 – ₹5,000",
          duration: "Express road transit",
          action: "Pool rideshare with other passengers stranded at the station heading to the same destination."
        }
      ],
      summary: "💡 <strong>Emergency Budget Range:</strong> Full ticket refund offsets cost! Alternate transit budget: <strong>₹400 – ₹2,500</strong>."
    },
    "Missed Flight": {
      icon: "✈️",
      badge: "Aviation Disruption Protocol",
      rows: [
        {
          mode: "✈️ Airline Standby / Same-Day Change Rule",
          cost: "₹0 – ₹3,500 ($0 – $45 fee)",
          duration: "Next available scheduled flight",
          action: "Go straight to Airline Airport Customer Service Desk before departure or within 2 hours."
        },
        {
          mode: "✈️ Next Available Flight (Spot Counter Booking)",
          cost: "₹4,500 – ₹14,000",
          duration: "Fastest air arrival",
          action: "Compare aggregator spot fares (Skyscanner / MakeMyTrip) against the airline ticketing desk."
        },
        {
          mode: "🚆 Premium Express Train (Vande Bharat / Shatabdi)",
          cost: "₹900 – ₹2,800",
          duration: "4 to 8 hrs",
          action: "If destination is within 500 km, express train often beats waiting for next day flight."
        },
        {
          mode: "🏨 Airport Transit Hotel / Sleeping Pod",
          cost: "₹1,800 – ₹4,500",
          duration: "Overnight transit",
          action: "Book airport terminal sleeping pods or nearby transit hotel with airport shuttle."
        }
      ],
      summary: "💡 <strong>Emergency Budget Range:</strong> Standby Rebook: <strong>₹0 – ₹3,500</strong> | Spot Flight: <strong>₹5,000 – ₹15,000</strong> | Express Train: <strong>₹900 – ₹3,000</strong>."
    },
    "Missed Bus": {
      icon: "🚌",
      badge: "Intercity Bus Recovery",
      rows: [
        {
          mode: "🚌 Next State Transport / Private Sleeper Bus",
          cost: "₹250 – ₹1,200",
          duration: "Departs within 30–60 mins",
          action: "Ask bus station enquiry master; interstate routes usually have frequent hourly departures."
        },
        {
          mode: "🚆 Regional Passenger / Intercity Express Train",
          cost: "₹120 – ₹650",
          duration: "Faster than highway traffic",
          action: "Check nearest railway station for unreserved or chair car general quota tickets."
        },
        {
          mode: "🚕 Shared Taxi / Rideshare Cab",
          cost: "₹1,200 – ₹3,800",
          duration: "Immediate departure",
          action: "Shared taxi stands are located outside major bus terminals; negotiate fare in advance."
        },
        {
          mode: "🏨 Safe Budget Hotel / Rest Stop",
          cost: "₹600 – ₹1,800",
          duration: "Rest until morning",
          action: "Choose verified hotels near the bus terminus with 24-hour reception and CCTV."
        }
      ],
      summary: "💡 <strong>Emergency Budget Range:</strong> Bus / Train: <strong>₹250 – ₹1,200</strong> | Shared Cab: <strong>₹1,200 – ₹4,000</strong>."
    }
  };

  // Budget Estimator Widget Elements & Logic
  const toggleEstimatorBtn = document.getElementById("toggle-estimator-btn");
  const estimatorBody = document.getElementById("estimator-body");
  const calcEstimateBtn = document.getElementById("calc-estimate-btn");
  const askAiPlanBtn = document.getElementById("ask-ai-plan-btn");
  const transitTypeSelect = document.getElementById("transit-type");
  const transitOriginInput = document.getElementById("transit-origin");
  const transitDestinationInput = document.getElementById("transit-destination");
  const transitPrioritySelect = document.getElementById("transit-priority");
  const estimatorOutput = document.getElementById("estimator-output");

  if (toggleEstimatorBtn && estimatorBody) {
    toggleEstimatorBtn.addEventListener("click", () => {
      const isHidden = estimatorBody.style.display === "none";
      estimatorBody.style.display = isHidden ? "block" : "none";
      toggleEstimatorBtn.textContent = isHidden ? "Hide Tool ▾" : "Show Tool ▸";
    });
  }

  function runCalculation() {
    if (!estimatorOutput) return;
    const type = transitTypeSelect ? transitTypeSelect.value : "Missed Train";
    const origin = (transitOriginInput && transitOriginInput.value.trim()) || "Current Station";
    const dest = (transitDestinationInput && transitDestinationInput.value.trim()) || "Destination";
    const priority = transitPrioritySelect ? transitPrioritySelect.value : "Urgent / Fastest Arrival";

    const preset = TRANSIT_ESTIMATES[type] || TRANSIT_ESTIMATES["Missed Train"];

    // Render instant estimate table & recommendations
    estimatorOutput.classList.remove("hidden");
    estimatorOutput.removeAttribute("hidden");
    estimatorOutput.style.display = "block";

    const tableRows = preset.rows.map((row, idx) => `
      <tr style="border-bottom: 1px solid #f0f0f0; ${idx % 2 === 1 ? 'background: rgba(247, 244, 234, 0.45);' : 'background: #ffffff;'}">
        <td style="padding: 0.55rem 0.65rem; font-weight: 650; color: var(--color-text);">${row.mode}</td>
        <td style="padding: 0.55rem 0.65rem; color: #285943; font-weight: 750;">${row.cost}</td>
        <td style="padding: 0.55rem 0.65rem; color: var(--color-secondary);">${row.duration}</td>
        <td style="padding: 0.55rem 0.65rem; font-size: 0.82rem; color: var(--color-text);">${row.action}</td>
      </tr>
    `).join("");

    estimatorOutput.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
        <h3 style="font-size: 1.05rem; font-weight: 750; color: var(--color-primary); margin: 0; display: flex; align-items: center; gap: 0.4rem;">
          <span>${preset.icon}</span> Estimated Alternatives: ${escapeHtml(origin)} ➔ ${escapeHtml(dest)}
        </h3>
        <span style="font-size: 0.78rem; background: var(--c-gold); color: #12372A; padding: 0.2rem 0.65rem; border-radius: 999px; font-weight: 750;">
          ${escapeHtml(priority)}
        </span>
      </div>
      <div style="overflow-x: auto; margin-bottom: 0.85rem; border: 1.5px solid var(--c-gold); border-radius: 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.86rem; background: #fff;">
          <thead style="background: var(--c-cream); color: var(--color-primary); font-weight: 750; border-bottom: 2px solid var(--c-gold);">
            <tr>
              <th style="padding: 0.55rem 0.65rem; text-align: left;">Alternative Option</th>
              <th style="padding: 0.55rem 0.65rem; text-align: left;">Estimated Cost Range</th>
              <th style="padding: 0.55rem 0.65rem; text-align: left;">Travel Duration</th>
              <th style="padding: 0.55rem 0.65rem; text-align: left;">Action / Booking Tip</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
      <div style="background: rgba(40, 89, 67, 0.08); border-left: 4px solid var(--color-secondary); padding: 0.65rem 0.85rem; border-radius: 4px; margin-bottom: 0.85rem; font-size: 0.86rem; color: var(--color-text); line-height: 1.5;">
        ${preset.summary}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
        <button type="button" class="btn btn-primary btn-sm" id="send-plan-to-chat-btn" style="padding: 0.45rem 1rem; font-size: 0.84rem; font-weight: 650;">
          💬 Ask AI Chatbot for Step-by-Step Action Plan
        </button>
      </div>
    `;

    // Connect nested action button to chatbot
    const nestedSendBtn = document.getElementById("send-plan-to-chat-btn");
    if (nestedSendBtn) {
      nestedSendBtn.addEventListener("click", () => {
        triggerAiEmergencyQuery(type, origin, dest, priority);
      });
    }

    // Scroll gently into view
    estimatorOutput.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function triggerAiEmergencyQuery(type, origin, dest, priority) {
    const promptMsg = `I have an emergency travel disruption: ${type} from ${origin} to ${dest}. Priority: ${priority}. What are my immediate station/airport refund actions, next transit alternatives, and detailed emergency cost budget breakdown?`;
    if (chatInput) {
      chatInput.value = promptMsg;
      autoResize(chatInput);
      chatInput.focus();
    }
    sendMessage(promptMsg);
    // Scroll chat into view
    chatMessages.scrollIntoView({ behavior: "smooth" });
  }

  if (calcEstimateBtn) {
    calcEstimateBtn.addEventListener("click", runCalculation);
  }

  if (askAiPlanBtn) {
    askAiPlanBtn.addEventListener("click", () => {
      const type = transitTypeSelect ? transitTypeSelect.value : "Missed Train";
      const origin = (transitOriginInput && transitOriginInput.value.trim()) || "Current Station";
      const dest = (transitDestinationInput && transitDestinationInput.value.trim()) || "Destination";
      const priority = transitPrioritySelect ? transitPrioritySelect.value : "Urgent / Fastest Arrival";
      triggerAiEmergencyQuery(type, origin, dest, priority);
    });
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", clearConversation);
  }

  // Initialize
  renderSuggestions();
  checkApiStatus();
  loadHistory();

  // Handle preselected problem category from dashboard
  const preselectedTitle = sessionStorage.getItem("selectedProblemTitle");
  const preselectedCategory = sessionStorage.getItem("selectedProblemCategory");
  if (preselectedTitle) {
    sessionStorage.removeItem("selectedProblemTitle");
    sessionStorage.removeItem("selectedProblemCategory");
    if (chatInput) {
      if (preselectedCategory === "missed-transport") {
        chatInput.value = "I missed my train! What are my immediate alternatives, station refund/TDR actions, and emergency cost budget breakdown?";
      } else {
        chatInput.value = `I need emergency help with: ${preselectedTitle}. What should I do?`;
      }
      autoResize(chatInput);
      chatInput.focus();
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAssistant);
} else {
  initAssistant();
}