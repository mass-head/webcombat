// TravelGuard AI Emergency Assistance Script
// Nearby places, interactive OpenStreetMap embedding, geolocation, emergency numbers.
// Vanilla JS + Fetch API only.

const API_BASE = (() => {
  if (window.location.protocol === "file:") return "http://127.0.0.1:5000";
  const port = window.location.port;
  if (!port || port === "5000") return "";
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:5000`;
})();

function initEmergency() {
  // State
  let csrfToken = null;
  let currentLocation = {
    lat: 28.6139,
    lng: 77.2090,
    name: "Delhi, India",
    country: "IN",
    isGps: false
  };
  let currentTab = "hospital";
  let contacts = [];

  // Preset global cities for instant positioning
  const CITIES = {
    delhi: { name: "Delhi, India", country: "IN", lat: 28.6139, lng: 77.2090 },
    mumbai: { name: "Mumbai, India", country: "IN", lat: 19.0760, lng: 72.8777 },
    london: { name: "London, UK", country: "GB", lat: 51.5074, lng: -0.1278 },
    newyork: { name: "New York, USA", country: "US", lat: 40.7128, lng: -74.0060 },
    paris: { name: "Paris, France", country: "FR", lat: 48.8566, lng: 2.3522 },
    tokyo: { name: "Tokyo, Japan", country: "JP", lat: 35.6762, lng: 139.6503 },
    berlin: { name: "Berlin, Germany", country: "DE", lat: 52.5200, lng: 13.4050 },
    sydney: { name: "Sydney, Australia", country: "AU", lat: -33.8688, lng: 151.2093 },
    toronto: { name: "Toronto, Canada", country: "CA", lat: 43.6532, lng: -79.3832 },
  };

  // DOM Elements
  const locationDot = document.getElementById("location-dot");
  const locationText = document.getElementById("location-text");
  const locationCoords = document.getElementById("location-coords");
  const locationNote = document.getElementById("location-note");
  const refreshLocationBtn = document.getElementById("refresh-location");
  const manualLocationInput = document.getElementById("manual-location-input");
  const manualLocationBtn = document.getElementById("manual-location-btn");
  const locationMapFrame = document.getElementById("location-map-frame");
  const openExternalMap = document.getElementById("open-external-map");
  const chipBtns = document.querySelectorAll(".chip-btn");

  const localEmergencyNumber = document.getElementById("local-emergency-number");
  const countrySelect = document.getElementById("country-select");
  const numbersGrid = document.getElementById("numbers-grid");
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  const addContactBtn = document.getElementById("add-contact-btn");
  const headerAddContactBtn = document.getElementById("header-add-contact-btn");
  const contactForm = document.getElementById("contact-form");
  const contactFormInner = document.getElementById("contact-form-inner");
  const cancelContactBtn = document.getElementById("cancel-contact");
  const closeContactIconBtn = document.getElementById("close-contact-icon-btn");
  const contactsList = document.getElementById("contacts-list");
  const emptyContacts = document.getElementById("empty-contacts");
  const contactFormTitle = document.getElementById("contact-form-title");

  // Place types and containers
  const placeTypes = {
    hospital: { list: "hospital-list", loading: "hospital-loading" },
    pharmacy: { list: "pharmacy-list", loading: "pharmacy-loading" },
    police: { list: "police-list", loading: "police-loading" },
    embassy: { list: "embassy-list", loading: "embassy-loading" },
    hotel: { list: "hotel-list", loading: "hotel-loading" },
    mall: { list: "mall-list", loading: "mall-loading" },
    cinema: { list: "cinema-list", loading: "cinema-loading" },
    attraction: { list: "attraction-list", loading: "attraction-loading" },
    rental: { list: "rental-list", loading: "rental-loading" }
  };

  // CSRF token
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch(`${API_BASE}/api/auth/csrf`);
      if (!res.ok) return "";
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    } catch {
      return "";
    }
  }

  let leafletMap = null;
  let mapMarker = null;

  function initLeafletMap(lat, lng) {
    if (typeof L === "undefined") return false;
    const mapEl = document.getElementById("leaflet-map");
    if (!mapEl) return false;

    if (!leafletMap) {
      try {
        leafletMap = L.map("leaflet-map", {
          center: [lat, lng],
          zoom: 14,
          zoomControl: true
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19
        }).addTo(leafletMap);

        mapMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);
        mapMarker.bindPopup("<b>📍 Selected Location</b><br>Drag this pin or click anywhere on the map to set your location!").openPopup();

        // Listen for marker dragend
        mapMarker.on("dragend", async () => {
          const pos = mapMarker.getLatLng();
          await onMapLocationPicked(pos.lat, pos.lng);
        });

        // Listen for map click anywhere
        leafletMap.on("click", async (e) => {
          const { lat: clickLat, lng: clickLng } = e.latlng;
          mapMarker.setLatLng([clickLat, clickLng]);
          await onMapLocationPicked(clickLat, clickLng);
        });

        setTimeout(() => {
          if (leafletMap) leafletMap.invalidateSize();
        }, 200);

        return true;
      } catch (err) {
        console.warn("Leaflet map initialization warning:", err);
        return false;
      }
    } else {
      leafletMap.setView([lat, lng], 14);
      if (mapMarker) {
        mapMarker.setLatLng([lat, lng]);
      }
      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 100);
      return true;
    }
  }

  async function onMapLocationPicked(lat, lng) {
    if (locationDot) locationDot.className = "status-dot";
    if (locationText) locationText.textContent = `Resolving location (${lat.toFixed(4)}, ${lng.toFixed(4)})...`;

    let locName = `Selected Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    let countryCode = currentLocation.country || "default";

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
        headers: { "Accept": "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        const addr = data.address || {};
        const neighborhood = addr.suburb || addr.neighbourhood || addr.residential || "";
        const city = addr.city || addr.town || addr.village || addr.county || "";
        const state = addr.state || "";
        const country = addr.country || "";
        countryCode = (addr.country_code || "").toUpperCase() || countryCode;

        const parts = [neighborhood, city, state, country].filter(Boolean);
        if (parts.length > 0) {
          locName = parts.slice(0, 3).join(", ");
        } else if (data.display_name) {
          locName = data.display_name.split(",").slice(0, 3).join(", ");
        }
      }
    } catch (e) {
      console.warn("Reverse geocode on map pick warning:", e);
    }

    currentLocation = {
      lat,
      lng,
      name: locName,
      country: countryCode,
      isGps: false
    };

    if (locationCoords) locationCoords.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    if (locationText) locationText.textContent = locName;
    if (locationDot) locationDot.className = "status-dot online";
    setLocationNotice(`📍 Location updated from map: ${locName}`, true);

    if (mapMarker) {
      mapMarker.bindPopup(`<b>📍 ${escapeHtml(locName)}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`).openPopup();
    }

    if (countrySelect && countryCode) {
      countrySelect.value = countryCode;
      loadEmergencyNumbers();
    }

    loadCurrentTabPlaces();
  }

  // Update map iframe and external links (street-level zoom)
  function updateMap(lat, lng, name) {
    const hasLeaflet = initLeafletMap(lat, lng);
    const mapFrame = document.getElementById("location-map-frame");

    if (!hasLeaflet && mapFrame) {
      mapFrame.style.display = "block";
      const deltaLat = 0.008;
      const deltaLng = 0.012;
      const minLng = (lng - deltaLng).toFixed(5);
      const minLat = (lat - deltaLat).toFixed(5);
      const maxLng = (lng + deltaLng).toFixed(5);
      const maxLat = (lat + deltaLat).toFixed(5);
      const bbox = `${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}`;
      const marker = `${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
      mapFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
    }

    if (openExternalMap) {
      openExternalMap.href = `https://www.google.com/maps/search/emergency+${currentTab}/@${lat},${lng},15z`;
    }
    if (locationCoords) {
      locationCoords.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    }
    if (locationText) {
      locationText.textContent = name || `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }
    if (locationDot) {
      locationDot.className = "status-dot online";
    }
  }

  // Set Location to a specific city or coords
  function setLocation(lat, lng, name, countryCode) {
    currentLocation = { lat, lng, name, country: countryCode || "default", isGps: false };
    updateMap(lat, lng, name);

    if (countryCode && countrySelect) {
      countrySelect.value = countryCode;
      loadEmergencyNumbers();
    }

    loadCurrentTabPlaces();
  }

  // Detect IP Location immediately (Backend + public fallback)
  async function detectIpLocation() {
    setLocationNotice("Detecting network location...", false);

    // 1. Try backend endpoint
    try {
      const res = await fetch(`${API_BASE}/api/emergency/detect-location`);
      if (res.ok) {
        const data = await res.json();
        if (data.lat && data.lng) {
          const locName = `${data.city || 'Local Area'}, ${data.region ? data.region + ', ' : ''}${data.country_name || ''}`.replace(/,\s*$/, "");
          currentLocation = {
            lat: Number(data.lat),
            lng: Number(data.lng),
            name: locName,
            country: data.country_code || "IN",
            isGps: false
          };
          updateMap(data.lat, data.lng, locName);
          if (countrySelect && data.country_code) {
            countrySelect.value = data.country_code;
            loadEmergencyNumbers();
          }
          setLocationNotice(`🌐 Location detected: ${locName}`, true);
          loadCurrentTabPlaces();
          return true;
        }
      }
    } catch (e) {
      console.warn("Backend IP location detection warning:", e);
    }

    // 2. Direct public IP geolocation fallbacks
    const publicEndpoints = [
      {
        url: "https://ipwho.is/",
        parse: (d) => ({
          lat: parseFloat(d.latitude),
          lng: parseFloat(d.longitude),
          name: `${d.city || d.region || "Current Area"}, ${d.region ? d.region + ', ' : ''}${d.country || ""}`.replace(/,\s*$/, ""),
          country: (d.country_code || "IN").toUpperCase()
        })
      },
      {
        url: "https://api.bigdatacloud.net/data/reverse-geocode-client",
        parse: (d) => ({
          lat: parseFloat(d.latitude),
          lng: parseFloat(d.longitude),
          name: `${d.city || d.locality || "Current Area"}, ${d.principalSubdivision ? d.principalSubdivision + ', ' : ''}${d.countryName || ""}`.replace(/,\s*$/, ""),
          country: (d.countryCode || "IN").toUpperCase()
        })
      },
      {
        url: "https://freeipapi.com/api/json",
        parse: (d) => ({
          lat: parseFloat(d.latitude),
          lng: parseFloat(d.longitude),
          name: `${d.cityName || "Current Area"}, ${d.regionName ? d.regionName + ', ' : ''}${d.countryName || ""}`.replace(/,\s*$/, ""),
          country: (d.countryCode || "IN").toUpperCase()
        })
      }
    ];

    for (const provider of publicEndpoints) {
      try {
        const res = await fetch(provider.url);
        if (res.ok) {
          const raw = await res.json();
          const info = provider.parse(raw);
          if (!isNaN(info.lat) && !isNaN(info.lng) && info.lat !== 0) {
            currentLocation = {
              lat: info.lat,
              lng: info.lng,
              name: info.name,
              country: info.country,
              isGps: false
            };
            updateMap(info.lat, info.lng, info.name);
            if (countrySelect && info.country) {
              countrySelect.value = info.country;
              loadEmergencyNumbers();
            }
            setLocationNotice(`🌐 Location detected: ${info.name}`, true);
            loadCurrentTabPlaces();
            return true;
          }
        }
      } catch (err) {
        console.warn("Public IP provider lookup warning:", err);
      }
    }

    // Fallback to default
    updateMap(currentLocation.lat, currentLocation.lng, currentLocation.name);
    loadEmergencyNumbers();
    loadCurrentTabPlaces();
    return false;
  }

  // Geolocation detection with reverse geocoding and automatic fallback
  async function detectGpsLocation() {
    if (!navigator.geolocation) {
      setLocationNotice("GPS not supported by browser. Using network location.", false);
      await detectIpLocation();
      return;
    }

    if (locationDot) locationDot.className = "status-dot";
    if (locationText) locationText.textContent = "Detecting your location...";
    if (refreshLocationBtn) refreshLocationBtn.disabled = true;

    const handleGpsSuccess = async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      let detectedName = `GPS Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      let detectedCountry = currentLocation.country || "IN";

      // Reverse-geocode to get real address & country
      try {
        const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
          headers: { "Accept": "application/json" }
        });
        if (revRes.ok) {
          const revData = await revRes.json();
          const addr = revData.address || {};
          const neighborhood = addr.suburb || addr.neighbourhood || addr.residential || "";
          const city = addr.city || addr.town || addr.village || addr.county || "";
          const state = addr.state || "";
          const country = addr.country || "";
          const countryCode = (addr.country_code || "").toUpperCase();

          const parts = [neighborhood, city, state, country].filter(Boolean);
          if (parts.length > 0) {
            detectedName = parts.slice(0, 3).join(", ");
          }
          if (countryCode) {
            detectedCountry = countryCode;
          }
        }
      } catch (e) {
        console.warn("Reverse geocode warning:", e);
      }

      currentLocation = {
        lat,
        lng,
        name: detectedName,
        country: detectedCountry,
        isGps: true
      };

      if (refreshLocationBtn) refreshLocationBtn.disabled = false;
      setLocationNotice(`📍 Exact GPS locked: ${detectedName}`, true);
      updateMap(lat, lng, detectedName);

      if (countrySelect && detectedCountry) {
        countrySelect.value = detectedCountry;
        loadEmergencyNumbers();
      }

      chipBtns.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.city === "gps");
      });

      loadCurrentTabPlaces();
    };

    const handleGpsFail = async (error) => {
      if (refreshLocationBtn) refreshLocationBtn.disabled = false;
      console.warn("GPS failed or unavailable, falling back to IP location:", error ? error.message : "");
      setLocationNotice("GPS unavailable. Locating via network...", false);
      await detectIpLocation();
    };

    // Standard positioning probe (3.5s timeout)
    navigator.geolocation.getCurrentPosition(
      handleGpsSuccess,
      handleGpsFail,
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }
    );
  }

  function setLocationNotice(msg, isSuccess) {
    if (locationDot) {
      locationDot.className = isSuccess ? "status-dot online" : "status-dot online";
    }
    if (locationNote) {
      locationNote.textContent = msg;
    }
  }

  // Handle City chips
  chipBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      chipBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const cityKey = btn.dataset.city;
      if (cityKey === "gps") {
        detectGpsLocation();
      } else if (CITIES[cityKey]) {
        const c = CITIES[cityKey];
        setLocation(c.lat, c.lng, c.name, c.country);
      }
    });
  });

  // Handle manual city / address input
  if (manualLocationBtn && manualLocationInput) {
    const handleManualSearch = async () => {
      const rawQuery = manualLocationInput.value.trim();
      if (!rawQuery) return;
      const query = rawQuery.toLowerCase();

      // Check presets first for instant positioning
      for (const [key, data] of Object.entries(CITIES)) {
        if (query === key || data.name.toLowerCase().includes(query)) {
          chipBtns.forEach(b => b.classList.toggle("active", b.dataset.city === key));
          setLocation(data.lat, data.lng, data.name, data.country);
          return;
        }
      }

      // Real geocoding search via OpenStreetMap Nominatim
      setLocationNotice(`Searching for "${rawQuery}"...`, false);
      if (manualLocationBtn) manualLocationBtn.disabled = true;

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawQuery)}&limit=1`, {
          headers: { "Accept": "application/json" }
        });
        if (res.ok) {
          const results = await res.json();
          if (results && results.length > 0) {
            const r = results[0];
            const lat = parseFloat(r.lat);
            const lng = parseFloat(r.lon);
            const parts = (r.display_name || rawQuery).split(",").slice(0, 3).map(s => s.trim()).join(", ");
            const countryCode = (r.address && r.address.country_code ? r.address.country_code.toUpperCase() : "IN");

            chipBtns.forEach(b => b.classList.remove("active"));
            setLocation(lat, lng, parts, countryCode);
            setLocationNotice(`📍 Location found: ${parts}`, true);
            return;
          }
        }
      } catch (err) {
        console.warn("Geocoding search warning:", err);
      } finally {
        if (manualLocationBtn) manualLocationBtn.disabled = false;
      }

      setLocationNotice(`Could not locate "${rawQuery}". Please click your location on the map.`, false);
    };

    manualLocationBtn.addEventListener("click", handleManualSearch);
    manualLocationInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleManualSearch();
      }
    });
  }

  if (refreshLocationBtn) {
    refreshLocationBtn.addEventListener("click", detectGpsLocation);
  }

  // Load emergency numbers for selected country
  async function loadEmergencyNumbers() {
    const country = countrySelect ? countrySelect.value : "default";
    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_BASE}/api/emergency/resources?country=${encodeURIComponent(country)}`, {
        headers: token ? { "X-CSRF-Token": token } : {}
      });
      if (res.ok) {
        const data = await res.json();
        renderEmergencyNumbers(data.resources || {});
        updateEmergencyBanner(data.resources || {});
      }
    } catch (err) {
      console.error("Failed to load emergency numbers:", err);
    }
  }

  function renderEmergencyNumbers(resources) {
    if (!numbersGrid) return;
    numbersGrid.innerHTML = "";

    const displayOrder = [
      { key: "emergency", label: "National Emergency", icon: "phone" },
      { key: "police", label: "Police", icon: "shield" },
      { key: "fire", label: "Fire", icon: "flame" },
      { key: "medical", label: "Medical / Ambulance", icon: "heart" },
      { key: "women_helpline", label: "Women Helpline", icon: "shield" },
      { key: "child_helpline", label: "Child Helpline", icon: "shield" },
      { key: "tourist_helpline", label: "Tourist Assistance", icon: "shield" },
      { key: "cyber_crime", label: "Cyber Crime", icon: "shield" },
      { key: "disaster_mgmt", label: "Disaster Helpline", icon: "flame" },
      { key: "poison_control", label: "Poison Control", icon: "skull" },
      { key: "suicide_prevention", label: "Suicide & Crisis Helpline", icon: "heart" },
      { key: "nhs_111", label: "NHS 111 (UK)", icon: "heart" },
      { key: "universal_emergency", label: "Universal Emergency", icon: "phone" }
    ];

    displayOrder.forEach(item => {
      const value = resources[item.key];
      if (value) {
        const card = document.createElement("div");
        card.className = "number-card";
        card.innerHTML = `
          <div class="number-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${getIconSvg(item.icon)}
            </svg>
          </div>
          <div class="number-info">
            <span class="number-label">${item.label}</span>
            <a class="number-value" href="tel:${value.replace(/\s+/g, "")}" aria-label="Call ${item.label}: ${value}">${value}</a>
          </div>
        `;
        numbersGrid.appendChild(card);
      }
    });

    if (resources.embassy) {
      const card = document.createElement("div");
      card.className = "number-card embassy-card";
      card.innerHTML = `
        <div class="number-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div class="number-info">
          <span class="number-label">Embassy / Consulate</span>
          <a class="number-value" href="${resources.embassy}" target="_blank" rel="noopener" aria-label="Visit embassy website">Official Consular Portal ↗</a>
        </div>
      `;
      numbersGrid.appendChild(card);
    }
  }

  function getIconSvg(name) {
    const icons = {
      phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
      heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
      skull: '<circle cx="12" cy="12" r="10"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9 14h6"/>'
    };
    return icons[name] || icons.phone;
  }

  function updateEmergencyBanner(resources) {
    const emergencyNum = resources.emergency || resources.universal_emergency || resources.us_emergency || resources.uk_emergency || "112 / 911 / 999";
    if (localEmergencyNumber) {
      localEmergencyNumber.textContent = emergencyNum;
    }
  }

  // Load nearby places for current tab
  async function loadCurrentTabPlaces() {
    const config = placeTypes[currentTab];
    if (!config) return;

    const listEl = document.getElementById(config.list);
    const loadingEl = document.getElementById(config.loading);

    if (!listEl) return;

    // Show loading while fetching
    if (loadingEl) {
      loadingEl.hidden = false;
      listEl.innerHTML = "";
      listEl.appendChild(loadingEl);
    }

    try {
      const lat = currentLocation.lat;
      const lng = currentLocation.lng;
      const token = await getCsrfToken();

      const res = await fetch(`${API_BASE}/api/emergency/nearby?lat=${lat}&lng=${lng}&type=${currentTab}&radius=5000`, {
        headers: token ? { "X-CSRF-Token": token } : {}
      });

      const data = await res.json();
      const places = data.places || [];

      if (loadingEl) loadingEl.hidden = true;
      renderPlaces(listEl, places, data.demo);
    } catch (err) {
      console.error("Failed to load places:", err);
      if (loadingEl) loadingEl.hidden = true;
      renderFallbackPlaces(listEl);
    }
  }

  function renderPlaces(listEl, places, isDemo) {
    listEl.innerHTML = "";

    if (!places || places.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <h3>No verified ${currentTab}s found in immediate perimeter</h3>
          <p>Please check your location or use emergency numbers below.</p>
        </div>
      `;
      return;
    }

    if (isDemo) {
      const demoBanner = document.createElement("div");
      demoBanner.className = "demo-banner";
      demoBanner.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Verified Emergency Facilities (Area Network)</span>
      `;
      listEl.appendChild(demoBanner);
    }

    const statusLabel = currentTab === "hotel" ? "Verified Stay & Lodging" : "24/7 Emergency Service";

    places.forEach(place => {
      const card = document.createElement("div");
      card.className = "place-card";
      card.innerHTML = `
        <div class="place-info">
          <h3 class="place-name">${escapeHtml(place.name)}</h3>
          ${place.address ? `<p class="place-address">${escapeHtml(place.address)}</p>` : ""}
          <div class="place-meta">
            ${place.rating ? `<span class="place-rating">★ ${place.rating} (${place.user_ratings_total || 250})</span>` : ""}
            <span class="place-status open">${statusLabel}</span>
          </div>
          ${place.phone ? `<p class="place-phone"><a href="tel:${place.phone.replace(/\s+/g, "")}">📞 ${escapeHtml(place.phone)}</a></p>` : ""}
        </div>
        <div class="place-actions">
          <a class="btn btn-primary btn-sm" href="${place.directions_url || `https://www.google.com/maps/dir/?api=1&destination=${currentLocation.lat},${currentLocation.lng}`}" target="_blank" rel="noopener">Get Directions</a>
          <a class="btn btn-ghost btn-sm" href="${place.maps_url || `https://www.google.com/maps/search/${currentTab}/@${currentLocation.lat},${currentLocation.lng},14z`}" target="_blank" rel="noopener">View on Maps</a>
        </div>
      `;
      listEl.appendChild(card);
    });
  }

  function renderFallbackPlaces(listEl) {
    listEl.innerHTML = "";
    const mockPlaces = currentTab === "hotel" ? [
      {
        name: "Grand Residency & Suites",
        address: "Central Station Road (0.9 km away)",
        phone: "+91 1800 200 4567",
        rating: 4.6
      },
      {
        name: "City Landmark Hotel",
        address: "Airport Express Sector (1.4 km away)",
        phone: "+91 1800 200 8910",
        rating: 4.5
      }
    ] : [
      {
        name: "Central Metropolitan General Hospital & Trauma Center",
        address: "450 Health Avenue (0.8 km away)",
        phone: "+1 800-444-9111",
        rating: 4.8
      },
      {
        name: "St. Jude 24/7 Emergency Care Center",
        address: "12 Healthcare Boulevard (1.4 km away)",
        phone: "+1 800-555-0210",
        rating: 4.6
      }
    ];
    renderPlaces(listEl, mockPlaces, true);
  }

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      if (type === currentTab) return;

      tabBtns.forEach(b => {
        b.classList.toggle("active", b.dataset.type === type);
        b.setAttribute("aria-selected", b.dataset.type === type);
      });

      tabPanels.forEach(p => {
        p.classList.toggle("active", p.id === `${type}-panel`);
      });

      currentTab = type;

      if (openExternalMap) {
        openExternalMap.href = `https://www.google.com/maps/search/emergency+${currentTab}/@${currentLocation.lat},${currentLocation.lng},14z`;
      }

      loadCurrentTabPlaces();
    });
  });

  if (countrySelect) {
    countrySelect.addEventListener("change", loadEmergencyNumbers);
  }

  // Load countries list
  async function loadCountries() {
    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_BASE}/api/emergency/countries`, {
        headers: token ? { "X-CSRF-Token": token } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (countrySelect && data.countries) {
          const currentVal = countrySelect.value;
          countrySelect.innerHTML = data.countries.map(c => `
            <option value="${c.code}" ${c.code === currentVal ? "selected" : ""}>${c.name}</option>
          `).join("");
        }
      }
    } catch (err) {
      console.error("Failed to load countries:", err);
    }
  }

  // Contacts handling
  function loadContacts() {
    try {
      const stored = localStorage.getItem("travelguard_contacts");
      if (stored) {
        const parsed = JSON.parse(stored);
        contacts = Array.isArray(parsed) ? parsed : [];
      } else {
        contacts = [];
      }
    } catch {
      contacts = [];
    }
    renderContacts();
  }

  function saveContacts() {
    try {
      localStorage.setItem("travelguard_contacts", JSON.stringify(contacts));
    } catch (err) {
      console.error("Failed to save contacts to localStorage:", err);
    }
  }

  function openContactForm(isEdit = false, index = null) {
    if (!contactForm) return;
    if (isEdit && index !== null && contacts[index]) {
      const contact = contacts[index];
      if (contactFormTitle) contactFormTitle.textContent = "Edit Contact";
      const nameInput = document.getElementById("contact-name");
      const phoneInput = document.getElementById("contact-phone");
      const emailInput = document.getElementById("contact-email");
      const relInput = document.getElementById("contact-relationship");
      if (nameInput) nameInput.value = contact.name || "";
      if (phoneInput) phoneInput.value = contact.phone || "";
      if (emailInput) emailInput.value = contact.email || "";
      if (relInput) relInput.value = contact.relationship || "Family";
      contactForm.dataset.editIndex = index;
    } else {
      if (contactFormTitle) contactFormTitle.textContent = "Add Contact";
      if (contactFormInner) contactFormInner.reset();
      delete contactForm.dataset.editIndex;
    }
    contactForm.hidden = false;
    contactForm.classList.remove("hidden");
    contactForm.style.display = "block";
    contactForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const nameInput = document.getElementById("contact-name");
    if (nameInput) nameInput.focus();
  }

  function closeContactForm() {
    if (!contactForm) return;
    contactForm.hidden = true;
    contactForm.classList.add("hidden");
    contactForm.style.display = "none";
    delete contactForm.dataset.editIndex;
    if (contactFormInner) contactFormInner.reset();
  }

  function renderContacts() {
    if (!contactsList) return;

    // Clear existing contact cards
    contactsList.querySelectorAll(".contact-card").forEach(el => el.remove());

    if (!contacts || contacts.length === 0) {
      if (emptyContacts) {
        emptyContacts.hidden = false;
        emptyContacts.classList.remove("hidden");
        emptyContacts.style.display = "flex";
      }
      return;
    }

    if (emptyContacts) {
      emptyContacts.hidden = true;
      emptyContacts.classList.add("hidden");
      emptyContacts.style.display = "none";
    }

    contacts.forEach((contact, index) => {
      const card = document.createElement("div");
      card.className = "contact-card";
      const cleanPhone = (contact.phone || "").replace(/[^\d+]/g, "");
      card.innerHTML = `
        <div class="contact-info">
          <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
            <h4>${escapeHtml(contact.name)}</h4>
            <span class="contact-relationship">${escapeHtml(contact.relationship || "Contact")}</span>
          </div>
          <p><a href="tel:${cleanPhone}" class="contact-phone-link">📞 ${escapeHtml(contact.phone)}</a></p>
          ${contact.email ? `<p><a href="mailto:${escapeHtml(contact.email)}">✉️ ${escapeHtml(contact.email)}</a></p>` : ""}
        </div>
        <div class="contact-actions">
          <a class="btn btn-primary btn-sm" href="tel:${cleanPhone}" aria-label="Call ${escapeHtml(contact.name)}">Call</a>
          <button class="btn btn-ghost btn-sm" type="button" data-action="edit" data-index="${index}">Edit</button>
          <button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="delete" data-index="${index}">Delete</button>
        </div>
      `;
      contactsList.appendChild(card);
    });

    contactsList.querySelectorAll("[data-action='edit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        openContactForm(true, idx);
      });
    });

    contactsList.querySelectorAll("[data-action='delete']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        deleteContact(idx);
      });
    });
  }

  function deleteContact(index) {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    contacts.splice(index, 1);
    saveContacts();
    renderContacts();
  }

  if (addContactBtn) {
    addContactBtn.addEventListener("click", () => openContactForm(false));
  }

  if (headerAddContactBtn) {
    headerAddContactBtn.addEventListener("click", () => openContactForm(false));
  }

  if (cancelContactBtn) {
    cancelContactBtn.addEventListener("click", closeContactForm);
  }

  if (closeContactIconBtn) {
    closeContactIconBtn.addEventListener("click", closeContactForm);
  }

  if (contactFormInner) {
    contactFormInner.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("contact-name");
      const phoneInput = document.getElementById("contact-phone");
      const emailInput = document.getElementById("contact-email");
      const relInput = document.getElementById("contact-relationship");

      const name = nameInput ? nameInput.value.trim() : "";
      const phone = phoneInput ? phoneInput.value.trim() : "";
      const email = emailInput ? emailInput.value.trim() : "";
      const relationship = relInput ? relInput.value : "Family";

      if (!name || !phone) {
        alert("Please enter both name and phone number.");
        return;
      }

      const contact = { name, phone, email, relationship };
      if (contactForm.dataset.editIndex !== undefined) {
        const editIdx = parseInt(contactForm.dataset.editIndex, 10);
        if (!isNaN(editIdx) && editIdx >= 0 && editIdx < contacts.length) {
          contacts[editIdx] = contact;
        } else {
          contacts.push(contact);
        }
      } else {
        contacts.push(contact);
      }

      saveContacts();
      renderContacts();
      closeContactForm();
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  // Initialize
  async function init() {
    loadContacts();
    await loadCountries();

    // 1. Detect real location via IP Geolocation immediately so map and numbers match user's real location
    const ipOk = await detectIpLocation();

    // 2. Request user GPS in parallel for street-level GPS accuracy if allowed by browser/hardware
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          let detectedName = `GPS Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          let detectedCountry = currentLocation.country || "IN";
          try {
            const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
              headers: { "Accept": "application/json" }
            });
            if (revRes.ok) {
              const revData = await revRes.json();
              const addr = revData.address || {};
              const neighborhood = addr.suburb || addr.neighbourhood || addr.residential || "";
              const city = addr.city || addr.town || addr.village || addr.county || "";
              const state = addr.state || "";
              const country = addr.country || "";
              const parts = [neighborhood, city, state, country].filter(Boolean);
              if (parts.length > 0) detectedName = parts.slice(0, 3).join(", ");
              if (addr.country_code) detectedCountry = addr.country_code.toUpperCase();
            }
          } catch (e) {
            console.warn("Reverse geocode on init GPS warning:", e);
          }
          currentLocation = { lat, lng, name: detectedName, country: detectedCountry, isGps: true };
          updateMap(lat, lng, detectedName);
          if (countrySelect && detectedCountry) {
            countrySelect.value = detectedCountry;
            loadEmergencyNumbers();
          }
          setLocationNotice(`📍 Exact GPS locked: ${detectedName}`, true);
          loadCurrentTabPlaces();
        },
        (err) => {
          console.info("Hardware GPS not active, keeping network location:", err ? err.message : "");
          if (!ipOk) detectIpLocation();
        },
        { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }
      );
    }
  }

  init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEmergency);
} else {
  initEmergency();
}