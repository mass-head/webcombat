"""WSGI entry point for production servers (Phase 8).

Usage:
    gunicorn --bind 0.0.0.0:5000 --workers 2 wsgi:app
"""
from app import app

if __name__ == "__main__":
    app.run()
