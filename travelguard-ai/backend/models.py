"""Shared database models for TravelGuard AI."""
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    """Application user (Phase 3: username + password only)."""

    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False, index=True)
    # Werkzeug password hash. Plaintext passwords are never stored.
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(
        db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    def to_public_dict(self) -> dict:
        """Public representation. Never includes the password hash."""
        return {
            "id": self.id,
            "username": self.username,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TravelPlan(db.Model):
    """User's saved travel plan (Phase 4)."""

    __tablename__ = "travel_plans"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(128), nullable=False)
    origin = db.Column(db.String(128), nullable=True)
    destination = db.Column(db.String(128), nullable=True)
    travel_date = db.Column(db.Date, nullable=True)
    transport = db.Column(db.String(64), nullable=True)
    budget = db.Column(db.Numeric(10, 2), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at = db.Column(
        db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    user = db.relationship("User", backref=db.backref("travel_plans", lazy=True, cascade="all, delete-orphan"))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "origin": self.origin,
            "destination": self.destination,
            "travel_date": self.travel_date.isoformat() if self.travel_date else None,
            "transport": self.transport,
            "budget": float(self.budget) if self.budget else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AssistanceHistory(db.Model):
    """User's assistance history (Phase 4)."""

    __tablename__ = "assistance_history"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = db.Column(db.String(32), nullable=False)  # assistant, emergency, routes
    title = db.Column(db.String(256), nullable=False)
    message = db.Column(db.Text, nullable=True)  # User's query or summary
    preview = db.Column(db.Text, nullable=True)  # Short preview for dashboard
    meta = db.Column(db.JSON, nullable=True)  # Additional context (category, etc.)
    created_at = db.Column(
        db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    user = db.relationship("User", backref=db.backref("assistance_history", lazy=True, cascade="all, delete-orphan"))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "preview": self.preview,
            "meta": self.meta,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class SavedAlternative(db.Model):
    """User's saved alternative route (Phase 7)."""

    __tablename__ = "saved_alternatives"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True, index=True)

    # Origin/destination as JSON
    origin = db.Column(db.JSON, nullable=True)
    destination = db.Column(db.JSON, nullable=True)

    transport_mode = db.Column(db.String(32), nullable=False)
    transport_label = db.Column(db.String(64), nullable=True)
    distance_km = db.Column(db.Numeric(10, 2), nullable=True)
    duration_minutes = db.Column(db.Integer, nullable=True)
    estimated_cost = db.Column(db.Numeric(10, 2), nullable=True)
    cost_currency = db.Column(db.String(3), nullable=True, default="USD")
    travel_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)

    created_at = db.Column(
        db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    user = db.relationship("User", backref=db.backref("saved_alternatives", lazy=True, cascade="all, delete-orphan"))
    plan = db.relationship("TravelPlan", backref=db.backref("saved_alternatives", lazy=True))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "plan_id": self.plan_id,
            "origin": self.origin,
            "destination": self.destination,
            "transport_mode": self.transport_mode,
            "transport_label": self.transport_label,
            "distance_km": float(self.distance_km) if self.distance_km else None,
            "duration_minutes": self.duration_minutes,
            "estimated_cost": float(self.estimated_cost) if self.estimated_cost else None,
            "cost_currency": self.cost_currency,
            "travel_date": self.travel_date.isoformat() if self.travel_date else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }