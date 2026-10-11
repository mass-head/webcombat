"""TravelGuard AI -- Flask application entry point (Phase 3).

- Configure Flask + sessions.
- Configure CORS for trusted origins.
- Initialize SQLite via Flask-SQLAlchemy.
- Expose GET /api/health.
- Serve the frontend pages.
- Server-side protection of private pages (dashboard requires login).
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session
from flask_cors import CORS

from models import db, User
from routes.auth_routes import auth_bp
from routes.assistant_routes import assistant_bp
from routes.travel_routes import travel_bp
from routes.emergency_routes import emergency_bp

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()
FRONTEND_DIR = (BASE_DIR / ".." / "frontend").resolve()
INSTANCE_DIR = (BASE_DIR / ".." / "instance").resolve()
INSTANCE_DIR.mkdir(parents=True, exist_ok=True)


def _parse_origins(raw: str) -> list:
    return [o.strip() for o in raw.split(",") if o.strip()]


# Frontend pages that require an authenticated session (server-enforced).
# Dashboard holds private saved trips; assistance and emergency tools are open to all travelers.
PROTECTED_PAGES = {"dashboard.html"}


def _authenticated() -> bool:
    user_id = session.get("user_id")
    if not user_id:
        return False
    return db.session.get(User, user_id) is not None


def create_app() -> Flask:
    app = Flask(__name__)

    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
        "DATABASE_URL", f"sqlite:///{INSTANCE_DIR / 'travelguard.db'}"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
    # Secure session cookie defaults (HTTPS/secure flag documented for production).
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    # Set SESSION_COOKIE_SECURE=true when serving over HTTPS (production).
    app.config["SESSION_COOKIE_SECURE"] = (
        os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    )

    is_production = os.getenv("FLASK_ENV", "development") == "production"
    if is_production and app.config["SECRET_KEY"] == "dev-only-change-me":
        print(
            "WARNING: SECRET_KEY is using the insecure development default. "
            "Set a long random SECRET_KEY in .env before deploying."
        )

    trusted_origins = _parse_origins(
        os.getenv("CORS_ORIGINS", "http://127.0.0.1:5000,http://localhost:5000,http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:5501,http://localhost:5501")
    )
    # Match any port on localhost or 127.0.0.1 for seamless dev experience
    import re
    local_re = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
    if local_re not in trusted_origins:
        trusted_origins.append(local_re)
    CORS(app, resources={r"/api/*": {"origins": trusted_origins}}, supports_credentials=True)

    db.init_app(app)

    # Phase 3: username/password authentication endpoints.
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(assistant_bp, url_prefix="/api/assistant")
    app.register_blueprint(travel_bp, url_prefix="/api/travel")
    app.register_blueprint(emergency_bp, url_prefix="/api/emergency")

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "service": "travelguard-ai",
                "version": "1.0.0-phase8",
            }
        ), 200

    @app.get("/")
    def serve_index():
        return send_from_directory(str(FRONTEND_DIR), "index.html")

    @app.get("/<path:filename>")
    def serve_frontend(filename: str):
        # Only serve known frontend files; everything else is a 404.
        requested = (FRONTEND_DIR / filename).resolve()
        try:
            requested.relative_to(FRONTEND_DIR)
        except ValueError:
            return jsonify({"error": "Not found"}), 404
        if requested.is_file():
            # Server-side protection: private pages require a valid session.
            # Frontend redirects are a convenience only, never the enforcement.
            if filename in PROTECTED_PAGES and not _authenticated():
                return redirect("/login.html", code=302)
            return send_from_directory(str(FRONTEND_DIR), filename)
        return jsonify({"error": "Not found"}), 404

    # --------------------------------------------------------
    # Phase 8: security headers on every response.
    # --------------------------------------------------------
    CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://unpkg.com https://openweathermap.org https://maps.gstatic.com; "
        "font-src 'self'; "
        "connect-src 'self' https://nominatim.openstreetmap.org https://ipapi.co https://ipwho.is http://ip-api.com https://api.bigdatacloud.net https://freeipapi.com http://127.0.0.1:* http://localhost:*; "
        "frame-src 'self' https://www.openstreetmap.org https://maps.google.com https://www.google.com; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )

    @app.after_request
    def apply_security_headers(response):
        response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "geolocation=*, camera=(), microphone=(), payment=()",
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response

    # --------------------------------------------------------
    # Phase 8: JSON error responses for API routes (no HTML,
    # no stack traces leaked to clients).
    # --------------------------------------------------------

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Not found."}), 404
        return error.get_response()

    @app.errorhandler(405)
    def method_not_allowed(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Method not allowed."}), 405
        return error.get_response()

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        if request.path.startswith("/api/"):
            return jsonify({"error": "Internal server error."}), 500
        return error.get_response()

    with app.app_context():
        db.create_all()

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "5000"))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    app.run(host="127.0.0.1", port=port, debug=debug)
