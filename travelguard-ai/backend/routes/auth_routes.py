"""Username-and-password authentication (Phase 3).

Endpoints:
- GET  /api/auth/csrf    -> issue CSRF token for the session
- POST /api/auth/signup  -> register (username, password, confirmPassword)
- POST /api/auth/login   -> log in (username, password)
- POST /api/auth/logout  -> log out
- GET  /api/auth/me      -> current user (requires authentication)

Security:
- Werkzeug password hashing; plaintext passwords never stored or returned.
- HttpOnly, SameSite=Lax session cookies (configured in app.py).
- CSRF tokens required on all POST endpoints.
- In-memory rate limiting of failed login attempts per client IP.
- All inputs validated on the server.
"""
import re
import secrets
import time
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from models import db, User

auth_bp = Blueprint("auth", __name__)

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128

# Rate limiting for failed login attempts (per client IP).
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60
_failed_logins: dict = {}


def _client_ip() -> str:
    return request.remote_addr or "unknown"


def _prune_attempts(now: float) -> None:
    cutoff = now - LOGIN_WINDOW_SECONDS
    expired = [
        ip for ip, stamps in _failed_logins.items()
        if not [t for t in stamps if t > cutoff]
    ]
    for ip in expired:
        del _failed_logins[ip]
    for ip in list(_failed_logins):
        _failed_logins[ip] = [t for t in _failed_logins[ip] if t > cutoff]


def _login_allowed(ip: str) -> bool:
    _prune_attempts(time.time())
    return len(_failed_logins.get(ip, [])) < LOGIN_MAX_ATTEMPTS


def _record_failed_login(ip: str) -> None:
    _failed_logins.setdefault(ip, []).append(time.time())


def _clear_failed_logins(ip: str) -> None:
    _failed_logins.pop(ip, None)


def validate_username(username: str) -> str | None:
    if not username:
        return "Username is required."
    if not USERNAME_RE.match(username):
        return "Username must be 3-32 characters: letters, numbers, dot, underscore, or hyphen."
    return None


def validate_password(password: str) -> str | None:
    if not password:
        return "Password is required."
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return "Password must be at most 128 characters."
    return None


def _get_csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def csrf_protect(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        expected = session.get("csrf_token", "")
        provided = request.headers.get("X-CSRF-Token", "")
        if not expected or not secrets.compare_digest(str(provided), str(expected)):
            return jsonify({"error": "Invalid or missing CSRF token."}), 403
        return view(*args, **kwargs)
    return wrapper


def login_required(view):
    """Backend authentication guard. Never rely on JavaScript-only checks."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        user_id = session.get("user_id")
        user = db.session.get(User, user_id) if user_id else None
        if user is None:
            return jsonify({"error": "Authentication required."}), 401
        request.current_user = user
        return view(*args, **kwargs)
    return wrapper


@auth_bp.get("/csrf")
def get_csrf():
    return jsonify({"csrfToken": _get_csrf_token()}), 200


@auth_bp.post("/signup")
@csrf_protect
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    confirm = data.get("confirmPassword") or ""

    error = validate_username(username) or validate_password(password)
    if error:
        return jsonify({"error": error}), 400
    if password != confirm:
        return jsonify({"error": "Passwords do not match."}), 400
    if User.query.filter_by(username=username).first() is not None:
        return jsonify({"error": "Username is already taken."}), 409

    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()

    session.clear()
    session["user_id"] = user.id
    session.permanent = True
    _get_csrf_token()
    return jsonify({"user": user.to_public_dict()}), 201


@auth_bp.post("/login")
@csrf_protect
def login():
    ip = _client_ip()
    if not _login_allowed(ip):
        return jsonify(
            {"error": "Too many failed login attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user = User.query.filter_by(username=username).first()
    if user is None or not check_password_hash(user.password_hash, password):
        _record_failed_login(ip)
        return jsonify({"error": "Incorrect username or password."}), 401

    session.clear()
    session["user_id"] = user.id
    session.permanent = True
    _get_csrf_token()
    _clear_failed_logins(ip)
    return jsonify({"user": user.to_public_dict()}), 200


@auth_bp.post("/logout")
@csrf_protect
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully."}), 200


@auth_bp.get("/me")
@login_required
def me():
    return jsonify({"user": request.current_user.to_public_dict()}), 200
