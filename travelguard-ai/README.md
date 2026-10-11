# TravelGuard AI — Smart Travel Problem Solver

Phases 1–8 implemented (setup, landing page, authentication, dashboard, AI assistant, emergency, routes, testing/security/deployment). English only.

## Requirements

- Python 3.11+
- pip

## Setup (Windows PowerShell)

```powershell
cd travelguard-ai/backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env and add your API keys:
#   GEMINI_API_KEY (Phase 5) - https://aistudio.google.com/app/apikey
#   GOOGLE_PLACES_API_KEY (Phase 6) - https://console.cloud.google.com/apis/credentials
#   OPENWEATHER_API_KEY (Phase 7) - https://openweathermap.org/api
python app.py
```

Optional dependency sets:

- `pip install -r requirements-dev.txt` — adds pytest (test suite).
- `pip install -r requirements-prod.txt` — adds gunicorn (production server).

The `.env` file is local-only and must never be committed. `.env.example`
contains placeholder values without real credentials.

## Execution

- Backend + landing page: `http://127.0.0.1:5000/`
- Health endpoint: `GET http://127.0.0.1:5000/api/health`
  - Expected response: `{"status":"ok","service":"travelguard-ai","version":"1.0.0-phase8"}`

## Authentication (Phase 3)

Username and password only. No email, phone, OTP, or social login.

Password policy (documented, enforced on frontend and backend):

- Username: required, unique, 3–32 characters
  (letters, numbers, dot, underscore, hyphen).
- Password: required, minimum 8 characters, maximum 128 characters.
- Signup additionally requires Confirm Password to match.

Endpoints:

| Method | Path              | Auth | Description                              |
| ------ | ----------------- | ---- | ---------------------------------------- |
| GET    | `/api/auth/csrf`  | No   | Issue CSRF token for the session         |
| POST   | `/api/auth/signup`| CSRF | Register; body: username, password, confirmPassword |
| POST   | `/api/auth/login` | CSRF | Log in; body: username, password         |
| POST   | `/api/auth/logout`| CSRF | Log out (invalidates session)            |
| GET    | `/api/auth/me`    | Yes  | Current user; 401 when not authenticated |

Security:

- Passwords hashed with Werkzeug (`generate_password_hash`/`check_password_hash`);
  only hashes are stored in SQLite, never plaintext.
- HttpOnly, `SameSite=Lax` session cookies; sessions expire after 12 hours.
- CSRF token (`X-CSRF-Token` header) required on all auth POST endpoints.
- Failed logins rate-limited: 5 attempts per IP per 15 minutes (HTTP 429).
- Protected pages require valid session (server-enforced).

## Dashboard (Phase 4)

Personalized dashboard at `/dashboard.html` with welcome message, feature cards,
problem categories, saved travel plans, and assistance history.

## AI Travel Assistant (Phase 5)

Interactive chatbot at `/assistant.html` with Google Gemini 1.5 Flash integration.

Features:
- Real-time chat with AI
- Conversation history persisted per user
- Suggested question buttons
- Loading states and error handling
- Clear conversation button
- Demo mode when GEMINI_API_KEY not configured

Endpoints:

| Method | Path                    | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
| POST   | `/api/assistant/chat`   | CSRF | Send message, get AI response            |
| GET    | `/api/assistant/history`| Yes  | Get conversation history                 |
| DELETE | `/api/assistant/history`| CSRF | Clear conversation history               |

## Emergency Assistance (Phase 6)

Emergency help page at `/emergency.html` with real-time nearby places search.

Features:
- **Nearby places** via Google Places API (New): hospitals, pharmacies, police, embassies
- **Browser geolocation** with explicit permission (never stored)
- **Emergency numbers** by country (US, UK, AU, CA, IN + universal 112)
- **Directions links** to Google Maps
- **Safety guidance** for medical, documents, safety, insurance
- **Trusted contacts** stored locally in browser
- Demo mode when GOOGLE_PLACES_API_KEY not configured

Endpoints:

| Method | Path                    | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
| GET    | `/api/emergency/resources` | Yes | Static emergency numbers by country     |
| GET    | `/api/emergency/nearby`    | Yes | Nearby places via Google Places (lat/lng) |
| GET    | `/api/emergency/countries` | Yes | Supported countries list                |

## Alternative Routes & Weather (Phase 7)

Route planning page at `/routes.html` with transport alternatives and weather.

Features:
- **Multi-modal transport estimates**: Flight, Train, Bus, Car, Ferry
- **Distance & duration** calculated via Haversine formula (straight-line)
- **Cost estimates** with budget flagging
- **Geocoding** via OpenStreetMap Nominatim (free)
- **Weather forecast** via OpenWeatherMap (5-day forecast)
- **Save preferred alternatives** to personal list
- All estimates clearly labeled — no live schedules/fares invented

Endpoints:

| Method | Path                    | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
| POST   | `/api/travel/routes`    | CSRF | Find alternative routes (origin, destination, date, transport, budget) |
| GET    | `/api/travel/weather`   | Yes  | Weather forecast for lat/lng and date    |
| POST   | `/api/travel/save-alternative` | CSRF | Save a route to personal list        |
| GET    | `/api/travel/alternatives` | Yes | List saved alternatives               |
| DELETE | `/api/travel/alternatives/:id` | CSRF | Delete saved alternative            |

To enable real weather:
1. Get API key from https://openweathermap.org/api
2. Add `OPENWEATHER_API_KEY=your-key` to `.env`
3. Restart server

## Automated Tests (Phase 8)

Pytest suite under `backend/tests/`. Tests use an isolated temporary database
and never call external APIs (Gemini/Places/Weather keys are forced off in the
test environment; geocoding is mocked).

```powershell
cd travelguard-ai/backend
pip install -r requirements-dev.txt
python -m pytest -v
```

Coverage:

| File                    | What it verifies                                              |
| ----------------------- | ------------------------------------------------------------- |
| `test_health.py`        | Health endpoint, landing page, 404/405 JSON errors            |
| `test_auth.py`          | Signup/login/logout validation, CSRF enforcement, login rate limiting, protected-page redirects |
| `test_travel.py`        | Plans CRUD + per-user ownership, routes search (mocked geocode), saved alternatives, history |
| `test_assistant.py`     | Chat auth/CSRF, demo-mode responses, conversation history     |
| `test_emergency.py`     | Resources/countries/nearby validation and demo mode           |
| `test_security.py`      | Security headers (CSP etc.), cookie flags, path-traversal, `.env` ignored |

## Security (Phase 8)

Application-wide:

- **Content-Security-Policy** on every response: `default-src 'self'`,
  `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`
  (no inline scripts/ styles anywhere in the frontend).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, restricted
  `Permissions-Policy` (geolocation allowed for self only).
- API errors return JSON only — no HTML stack traces leak to clients;
  500 handler rolls back the DB session.
- Session cookie: `HttpOnly`, `SameSite=Lax`, optional `Secure`
  (`SESSION_COOKIE_SECURE=true` for HTTPS) + HSTS when enabled.
- Startup warning when running production with the default `SECRET_KEY`.
- Secrets stay in `.env` (git-ignored) and are injected as environment
  variables in deployment — never baked into images.

Authentication layer (Phase 3): password hashing (Werkzeug), CSRF token on
all POSTs, failed-login rate limiting (5 / 15 min / IP), server-enforced
page protection.

## Deployment (Phase 8)

**Local production run (gunicorn):**

```powershell
cd travelguard-ai/backend
$env:FLASK_ENV="production"
$env:SECRET_KEY="<long-random-value>"
python -m gunicorn --bind 127.0.0.1:5000 --workers 2 wsgi:app
```

**Docker:**

```powershell
docker build -t travelguard-ai .
docker run -p 5000:5000 `
  -e SECRET_KEY="<long-random-value>" `
  -e GEMINI_API_KEY="<key>" `
  -e GOOGLE_PLACES_API_KEY="<key>" `
  -e OPENWEATHER_API_KEY="<key>" `
  travelguard-ai
```

`.dockerignore` excludes `.env`, databases, and caches. For HTTPS, terminate
TLS at a reverse proxy (nginx/Caddy) and set `SESSION_COOKIE_SECURE=true`.

## Manual verification

1. Open `http://127.0.0.1:5000/` — landing page loads.
2. Sign up at `/signup.html` → redirected to `/dashboard.html`.
3. Dashboard shows username, feature cards, problem categories.
4. Click "AI Travel Assistant" → chat at `/assistant.html`.
5. Click "Emergency" → `/emergency.html` with location detection.
6. Allow location → nearby hospitals/pharmacies/police load.
7. Click "Routes" → `/routes.html` with route finder form.
8. Enter origin/destination → see transport options with estimates.
9. Check weather card for destination forecast.
10. Click "Save Route" → appears in Saved Alternatives.
11. Log out → protected pages redirect to login.
12. Health check: `curl http://127.0.0.1:5000/api/health`
13. Run the test suite: `python -m pytest -v` (all tests green).

## Project structure

```
travelguard-ai/
├── backend/
│   ├── app.py, wsgi.py, models.py
│   ├── routes/          # auth, assistant, emergency, travel blueprints
│   ├── tests/           # pytest suite (Phase 8)
│   ├── requirements.txt / -dev.txt / -prod.txt
│   └── .env.example
├── frontend/            # static HTML/CSS/JS (no frameworks)
├── instance/            # SQLite DB (auto-created, git-ignored)
├── Dockerfile, .dockerignore
└── README.md, .gitignore
```

SQLite database at `instance/travelguard.db` (auto-created, git-ignored).

## Troubleshooting

- `PermissionError: [WinError 5]` on Windows: run with reloader off:
  `$env:FLASK_ENV="production"; python app.py`
- Port in use: change `FLASK_PORT` in `.env`
- Database reset: delete `instance/travelguard.db`
- Gemini API errors: check `.env` has valid `GEMINI_API_KEY`
- Google Places errors: check `.env` has valid `GOOGLE_PLACES_API_KEY`; enable Places API (New) in Google Cloud Console
- Weather errors: check `.env` has valid `OPENWEATHER_API_KEY`

## Notes

- Phases 1–8 implemented (full feature set per spec, including tests,
  security hardening, and deployment config).
- Demo modes clearly labeled when API keys not configured.
- All user-facing text in English only.
- No fabricated live data — estimates clearly labeled.