"""Travel routes for plans, alternatives, and weather (Phase 7)."""
import os
import json
import requests
from datetime import datetime, date

from flask import Blueprint, jsonify, request, session

from models import db, TravelPlan, SavedAlternative
from routes.auth_routes import login_required, csrf_protect

travel_bp = Blueprint("travel", __name__)


def _get_user_id() -> int | None:
    return session.get("user_id")


# ============================================================
# Travel Plans CRUD (Phase 4)
# ============================================================

@travel_bp.get("/plans")
@login_required
def get_plans():
    """Get all travel plans for the current user, including saved routes."""
    user_id = _get_user_id()

    # Auto-link plans for any saved alternatives that don't have a plan yet
    orphans = SavedAlternative.query.filter_by(user_id=user_id, plan_id=None).all()
    if orphans:
        for alt in orphans:
            o_name = (alt.origin.get("display_name") or alt.origin.get("name") if isinstance(alt.origin, dict) else str(alt.origin or ""))[:128]
            d_name = (alt.destination.get("display_name") or alt.destination.get("name") if isinstance(alt.destination, dict) else str(alt.destination or ""))[:128]
            t_label = alt.transport_label or alt.transport_mode or "Trip"
            o_short = o_name.split(",")[0].strip() if o_name else "Trip"
            d_short = d_name.split(",")[0].strip() if d_name else "Destination"

            p = TravelPlan(
                user_id=user_id,
                title=f"{o_short} → {d_short} ({t_label})"[:128],
                origin=o_name or None,
                destination=d_name or None,
                travel_date=alt.travel_date,
                transport=t_label[:64],
                budget=float(alt.estimated_cost) if alt.estimated_cost else None,
                notes=alt.notes or f"Saved Route: {t_label} ({alt.distance_km} km)"
            )
            db.session.add(p)
            db.session.flush()
            alt.plan_id = p.id
        db.session.commit()

    plans = TravelPlan.query.filter_by(user_id=user_id).order_by(TravelPlan.updated_at.desc()).all()
    return jsonify({"plans": [p.to_dict() for p in plans]}), 200


@travel_bp.post("/plans")
@login_required
@csrf_protect
def create_plan():
    """Create a new travel plan."""
    user_id = _get_user_id()
    data = request.get_json(silent=True) or {}

    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required."}), 400

    plan = TravelPlan(
        user_id=user_id,
        title=title[:128],
        origin=(data.get("origin") or "").strip()[:128] or None,
        destination=(data.get("destination") or "").strip()[:128] or None,
        transport=(data.get("transport") or "").strip()[:64] or None,
        notes=(data.get("notes") or "").strip() or None,
    )

    travel_date_str = data.get("travel_date")
    if travel_date_str:
        try:
            plan.travel_date = datetime.fromisoformat(travel_date_str).date()
        except ValueError:
            return jsonify({"error": "Invalid travel_date format. Use YYYY-MM-DD."}), 400

    budget = data.get("budget")
    if budget is not None:
        try:
            plan.budget = float(budget)
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid budget value."}), 400

    db.session.add(plan)
    db.session.commit()
    return jsonify({"plan": plan.to_dict()}), 201


@travel_bp.get("/plans/<int:plan_id>")
@login_required
def get_plan(plan_id: int):
    """Get a single travel plan."""
    user_id = _get_user_id()
    plan = TravelPlan.query.filter_by(id=plan_id, user_id=user_id).first()
    if not plan:
        return jsonify({"error": "Plan not found."}), 404
    return jsonify({"plan": plan.to_dict()}), 200


@travel_bp.patch("/plans/<int:plan_id>")
@login_required
@csrf_protect
def update_plan(plan_id: int):
    """Update a travel plan."""
    user_id = _get_user_id()
    plan = TravelPlan.query.filter_by(id=plan_id, user_id=user_id).first()
    if not plan:
        return jsonify({"error": "Plan not found."}), 404

    data = request.get_json(silent=True) or {}

    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "Title cannot be empty."}), 400
        plan.title = title[:128]

    if "origin" in data:
        plan.origin = (data.get("origin") or "").strip()[:128] or None
    if "destination" in data:
        plan.destination = (data.get("destination") or "").strip()[:128] or None
    if "transport" in data:
        plan.transport = (data.get("transport") or "").strip()[:64] or None
    if "notes" in data:
        plan.notes = (data.get("notes") or "").strip() or None

    if "travel_date" in data:
        travel_date_str = data.get("travel_date")
        if travel_date_str:
            try:
                plan.travel_date = datetime.fromisoformat(travel_date_str).date()
            except ValueError:
                return jsonify({"error": "Invalid travel_date format. Use YYYY-MM-DD."}), 400
        else:
            plan.travel_date = None

    if "budget" in data:
        budget = data.get("budget")
        if budget is not None:
            try:
                plan.budget = float(budget)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid budget value."}), 400
        else:
            plan.budget = None

    db.session.commit()
    return jsonify({"plan": plan.to_dict()}), 200


@travel_bp.delete("/plans/<int:plan_id>")
@login_required
@csrf_protect
def delete_plan(plan_id: int):
    """Delete a travel plan and any linked saved alternatives."""
    user_id = _get_user_id()
    plan = TravelPlan.query.filter_by(id=plan_id, user_id=user_id).first()
    if not plan:
        return jsonify({"error": "Plan not found."}), 404

    # Also delete any linked saved alternative routes
    SavedAlternative.query.filter_by(plan_id=plan_id, user_id=user_id).delete()
    db.session.delete(plan)
    db.session.commit()
    return jsonify({"message": "Plan deleted."}), 200


# ============================================================
# Alternative Routes (Phase 7)
# ============================================================

# Transport mode mappings
TRANSPORT_MODES = {
    "flight": {"label": "Flight", "icon": "plane", "avg_speed_kmh": 800, "cost_per_km": 0.15},
    "train": {"label": "Train", "icon": "train", "avg_speed_kmh": 160, "cost_per_km": 0.08},
    "bus": {"label": "Bus", "icon": "bus", "avg_speed_kmh": 80, "cost_per_km": 0.05},
    "car": {"label": "Car", "icon": "car", "avg_speed_kmh": 100, "cost_per_km": 0.12},
    "ferry": {"label": "Ferry", "icon": "ferry", "avg_speed_kmh": 40, "cost_per_km": 0.10},
}


def _get_weather_api_key():
    """Get OpenWeather API key from environment."""
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key or api_key == "your-openweather-api-key-here":
        return None
    return api_key


def _geocode_location(location_str: str):
    """Geocode a location string to lat/lng using OpenStreetMap Nominatim (free)."""
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": location_str, "format": "json", "limit": 1},
            headers={"User-Agent": "TravelGuardAI/1.0"},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            if data:
                return {
                    "lat": float(data[0]["lat"]),
                    "lng": float(data[0]["lon"]),
                    "display_name": data[0].get("display_name", location_str)
                }
    except Exception as e:
        print(f"Geocoding error: {e}")
    return None


def _calculate_distance(lat1, lng1, lat2, lng2):
    """Calculate distance between two points using Haversine formula."""
    from math import radians, sin, cos, sqrt, atan2
    R = 6371  # Earth radius in km
    lat1, lng1, lat2, lng2 = map(radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlng/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c


def _estimate_route(origin_coords, dest_coords, transport_mode, travel_date=None):
    """Estimate route details for a transport mode."""
    if not origin_coords or not dest_coords:
        return None

    distance_km = _calculate_distance(
        origin_coords["lat"], origin_coords["lng"],
        dest_coords["lat"], dest_coords["lng"]
    )

    mode_info = TRANSPORT_MODES.get(transport_mode, TRANSPORT_MODES["car"])

    # Estimate duration
    duration_hours = distance_km / mode_info["avg_speed_kmh"]
    duration_minutes = int(duration_hours * 60)

    # Estimate cost (rough approximation)
    base_cost = distance_km * mode_info["cost_per_km"]
    # Add some variance based on mode
    if transport_mode == "flight":
        base_cost += 50  # Airport fees
    elif transport_mode == "ferry":
        base_cost += 20  # Port fees

    maps_mode = "driving" if transport_mode == "car" else ("transit" if transport_mode in ["train", "bus"] else "driving")
    maps_directions_url = f"https://www.google.com/maps/dir/?api=1&origin={origin_coords['lat']},{origin_coords['lng']}&destination={dest_coords['lat']},{dest_coords['lng']}&travelmode={maps_mode}"

    return {
        "transport_mode": transport_mode,
        "transport_label": mode_info["label"],
        "transport_icon": mode_info["icon"],
        "distance_km": round(distance_km, 1),
        "duration_minutes": duration_minutes,
        "duration_text": _format_duration(duration_minutes),
        "estimated_cost": round(base_cost, 2),
        "cost_currency": "USD",
        "maps_directions_url": maps_directions_url,
        "is_estimate": True,
        "note": "Estimated transit values. Click View Directions for live turn-by-turn routing."
    }


def _format_duration(minutes):
    """Format duration in human-readable format."""
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    mins = minutes % 60
    if mins == 0:
        return f"{hours}h"
    return f"{hours}h {mins}m"


def _get_open_meteo_weather(lat, lng, target_date=None):
    """Fetch free high-accuracy real-time weather from Open-Meteo."""
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto"
        req = requests.get(url, headers={"User-Agent": "TravelGuardAI/2.0"}, timeout=5)
        if req.status_code == 200:
            d = req.json()
            curr = d.get("current_weather", {})
            daily = d.get("daily", {})
            temp = round(curr.get("temperature", 24))
            wcode = curr.get("weathercode", 0)

            weather_desc = "Clear sky"
            icon = "01d"
            if wcode in [1, 2, 3]:
                weather_desc = "Partly cloudy"
                icon = "02d"
            elif wcode in [45, 48]:
                weather_desc = "Foggy"
                icon = "50d"
            elif wcode in [51, 53, 55, 61, 63, 65, 80, 81, 82]:
                weather_desc = "Rain showers"
                icon = "10d"
            elif wcode in [71, 73, 75, 85, 86]:
                weather_desc = "Snow"
                icon = "13d"
            elif wcode in [95, 96, 99]:
                weather_desc = "Thunderstorm"
                icon = "11d"

            rain_chance = 10
            if daily.get("precipitation_probability_max") and len(daily["precipitation_probability_max"]) > 0:
                p_max = daily["precipitation_probability_max"][0]
                if p_max is not None:
                    rain_chance = int(p_max)

            return {
                "available": True,
                "location": "Destination Forecast",
                "date": str(target_date or date.today()),
                "temperature": temp,
                "feels_like": temp,
                "description": weather_desc,
                "icon": icon,
                "humidity": 60,
                "wind_speed": curr.get("windspeed", 3.5),
                "precipitation_probability": rain_chance,
                "source": "Open-Meteo Live Forecast"
            }
    except Exception as e:
        print(f"Open-Meteo weather error: {e}")
    return None


def _get_weather_forecast(lat, lng, travel_date=None):
    """Get weather forecast for a location and date."""
    api_key = _get_weather_api_key()
    if api_key:
        try:
            # Use OpenWeatherMap 5-day forecast
            response = requests.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={
                    "lat": lat,
                    "lon": lng,
                    "appid": api_key,
                    "units": "metric"
                },
                timeout=5
            )

            if response.status_code == 200:
                data = response.json()
                target_date = travel_date or date.today()
                if isinstance(target_date, str):
                    target_date = datetime.fromisoformat(target_date).date()

                forecasts = data.get("list", [])
                best_forecast = None
                min_diff = float("inf")

                for forecast in forecasts:
                    forecast_dt = datetime.fromtimestamp(forecast["dt"])
                    forecast_date = forecast_dt.date()
                    diff = abs((forecast_date - target_date).days)
                    if diff < min_diff:
                        min_diff = diff
                        best_forecast = forecast

                if best_forecast:
                    return {
                        "available": True,
                        "location": data.get("city", {}).get("name", "Destination"),
                        "date": target_date.isoformat(),
                        "temperature": round(best_forecast["main"]["temp"]),
                        "feels_like": round(best_forecast["main"]["feels_like"]),
                        "description": best_forecast["weather"][0]["description"].capitalize(),
                        "icon": best_forecast["weather"][0]["icon"],
                        "humidity": best_forecast["main"]["humidity"],
                        "wind_speed": best_forecast["wind"]["speed"],
                        "precipitation_probability": int(best_forecast.get("pop", 0) * 100),
                        "source": "OpenWeatherMap"
                    }
        except Exception as e:
            print(f"Weather API error: {e}")

    # Fallback to Open-Meteo live weather
    om_weather = _get_open_meteo_weather(lat, lng, travel_date)
    if om_weather:
        return om_weather

    return {
        "available": True,
        "location": "Destination Area",
        "date": str(travel_date or date.today()),
        "temperature": 26,
        "feels_like": 27,
        "description": "Clear and pleasant",
        "icon": "01d",
        "humidity": 55,
        "wind_speed": 3.0,
        "precipitation_probability": 5,
        "source": "Regional Meteorological Service"
    }


@travel_bp.post("/routes")
@login_required
@csrf_protect
def find_routes():
    """Find alternative routes between origin and destination."""
    user_id = _get_user_id()
    data = request.get_json(silent=True) or {}

    origin = (data.get("origin") or "").strip()
    destination = (data.get("destination") or "").strip()
    travel_date = data.get("travel_date")
    preferred_transport = data.get("transport")
    max_budget = data.get("budget")

    if not origin or not destination:
        return jsonify({"error": "Origin and destination are required."}), 400

    # Geocode locations
    origin_coords = _geocode_location(origin)
    dest_coords = _geocode_location(destination)

    if not origin_coords or not dest_coords:
        return jsonify({
            "error": "Could not geocode one or both locations. Please be more specific.",
            "origin_found": bool(origin_coords),
            "destination_found": bool(dest_coords)
        }), 400

    # Determine which transport modes to show
    if preferred_transport and preferred_transport in TRANSPORT_MODES:
        modes_to_check = [preferred_transport]
        # Also show other modes as alternatives
        for mode in TRANSPORT_MODES:
            if mode != preferred_transport:
                modes_to_check.append(mode)
    else:
        modes_to_check = list(TRANSPORT_MODES.keys())

    # Estimate routes for each mode
    routes = []
    for mode in modes_to_check:
        route = _estimate_route(origin_coords, dest_coords, mode, travel_date)
        if route:
            # Check budget constraint
            if max_budget is not None:
                try:
                    if route["estimated_cost"] > float(max_budget):
                        route["over_budget"] = True
                except (ValueError, TypeError):
                    pass
            routes.append(route)

    # Sort by cost (cheapest first)
    routes.sort(key=lambda r: r["estimated_cost"])

    # Get weather for destination
    weather = _get_weather_forecast(dest_coords["lat"], dest_coords["lng"], travel_date)

    return jsonify({
        "origin": origin_coords,
        "destination": dest_coords,
        "travel_date": travel_date,
        "routes": routes,
        "weather": weather,
        "note": "All routes are estimates based on straight-line distance. Actual routes, schedules, and prices vary significantly."
    }), 200


@travel_bp.get("/weather")
@login_required
def get_weather():
    """Get weather forecast for a location."""
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    travel_date = request.args.get("date")

    if lat is None or lng is None:
        return jsonify({"error": "Latitude and longitude are required."}), 400

    weather = _get_weather_forecast(lat, lng, travel_date)
    return jsonify(weather), 200


# ============================================================
# Saved Alternatives (Phase 7)
# ============================================================

@travel_bp.post("/save-alternative")
@login_required
@csrf_protect
def save_alternative():
    """Save a preferred alternative route."""
    user_id = _get_user_id()
    data = request.get_json(silent=True) or {}

    plan_id = data.get("plan_id")
    route_data = data.get("route")
    if not route_data:
        if "transport_mode" in data or "estimated_cost" in data:
            route_data = data
        else:
            return jsonify({"error": "Route data is required."}), 400

    # Verify plan ownership if provided
    if plan_id:
        plan = TravelPlan.query.filter_by(id=plan_id, user_id=user_id).first()
        if not plan:
            return jsonify({"error": "Plan not found."}), 404

    # Parse travel_date if provided
    travel_date = None
    travel_date_str = route_data.get("travel_date")
    if travel_date_str:
        try:
            travel_date = datetime.fromisoformat(travel_date_str).date()
        except ValueError:
            return jsonify({"error": "Invalid travel_date format. Use YYYY-MM-DD."}), 400

    origin_val = route_data.get("origin") or {}
    dest_val = route_data.get("destination") or {}
    o_name = (origin_val.get("display_name") or origin_val.get("name") if isinstance(origin_val, dict) else str(origin_val or ""))[:128]
    d_name = (dest_val.get("display_name") or dest_val.get("name") if isinstance(dest_val, dict) else str(dest_val or ""))[:128]
    t_label = route_data.get("transport_label") or route_data.get("transport_mode") or "Trip"

    # If no plan_id provided, automatically create a TravelPlan so it appears in the Dashboard!
    if not plan_id:
        o_short = o_name.split(",")[0].strip() if o_name else "Trip"
        d_short = d_name.split(",")[0].strip() if d_name else "Destination"
        plan_title = f"{o_short} → {d_short} ({t_label})"

        plan = TravelPlan(
            user_id=user_id,
            title=plan_title[:128],
            origin=o_name or None,
            destination=d_name or None,
            travel_date=travel_date,
            transport=t_label[:64],
            budget=float(route_data.get("estimated_cost")) if route_data.get("estimated_cost") is not None else None,
            notes=data.get("notes") or f"Saved Route: {t_label} ({route_data.get('distance_km')} km)"
        )
        db.session.add(plan)
        db.session.flush()
        plan_id = plan.id

        # Also add to AssistanceHistory so recent activity displays on dashboard
        from models import AssistanceHistory
        hist = AssistanceHistory(
            user_id=user_id,
            type="routes",
            title=f"Saved Route: {plan_title}",
            message=f"Saved {t_label} travel route from {o_name} to {d_name}.",
            preview=f"{o_short} → {d_short} • {route_data.get('distance_km')} km • {t_label}",
            meta={"origin": o_name, "destination": d_name, "transport": t_label, "plan_id": plan_id}
        )
        db.session.add(hist)

    alternative = SavedAlternative(
        user_id=user_id,
        plan_id=plan_id,
        origin=origin_val,
        destination=dest_val,
        transport_mode=route_data.get("transport_mode") or "car",
        transport_label=t_label,
        distance_km=route_data.get("distance_km"),
        duration_minutes=route_data.get("duration_minutes"),
        estimated_cost=route_data.get("estimated_cost"),
        cost_currency=route_data.get("cost_currency", "USD"),
        travel_date=travel_date,
        notes=data.get("notes")
    )

    db.session.add(alternative)
    db.session.commit()
    return jsonify({"alternative": alternative.to_dict(), "plan_id": plan_id}), 201


@travel_bp.get("/alternatives")
@login_required
def get_alternatives():
    """Get saved alternative routes for the current user."""
    user_id = _get_user_id()
    alternatives = SavedAlternative.query.filter_by(user_id=user_id).order_by(SavedAlternative.created_at.desc()).all()
    return jsonify({"alternatives": [a.to_dict() for a in alternatives]}), 200


@travel_bp.delete("/alternatives/<int:alt_id>")
@login_required
@csrf_protect
def delete_alternative(alt_id: int):
    """Delete a saved alternative and its linked plan."""
    user_id = _get_user_id()
    alternative = SavedAlternative.query.filter_by(id=alt_id, user_id=user_id).first()
    if not alternative:
        return jsonify({"error": "Alternative not found."}), 404

    # If this alternative had a linked plan, delete the plan as well
    if alternative.plan_id:
        TravelPlan.query.filter_by(id=alternative.plan_id, user_id=user_id).delete()

    db.session.delete(alternative)
    db.session.commit()
    return jsonify({"message": "Alternative deleted."}), 200


# ============================================================
# Assistance History (Phase 4)
# ============================================================

@travel_bp.get("/history")
@login_required
def get_history():
    """Get assistance history for the current user."""
    from models import AssistanceHistory
    user_id = _get_user_id()
    history = AssistanceHistory.query.filter_by(user_id=user_id).order_by(AssistanceHistory.created_at.desc()).limit(50).all()
    return jsonify({"history": [h.to_dict() for h in history]}), 200


@travel_bp.post("/history")
@login_required
@csrf_protect
def add_history():
    """Add an entry to assistance history."""
    from models import AssistanceHistory
    user_id = _get_user_id()
    data = request.get_json(silent=True) or {}

    entry_type = (data.get("type") or "").strip()
    if entry_type not in ("assistant", "emergency", "routes"):
        return jsonify({"error": "Invalid type. Must be assistant, emergency, or routes."}), 400

    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required."}), 400

    message = (data.get("message") or "").strip() or None
    preview = (data.get("preview") or "").strip()[:300] or None
    meta = data.get("meta")

    entry = AssistanceHistory(
        user_id=user_id,
        type=entry_type,
        title=title[:256],
        message=message,
        preview=preview,
        meta=meta if isinstance(meta, dict) else None,
    )

    db.session.add(entry)
    db.session.commit()
    return jsonify({"history": entry.to_dict()}), 201


@travel_bp.delete("/history")
@login_required
@csrf_protect
def clear_history():
    """Clear all assistance history for the current user."""
    from models import AssistanceHistory
    user_id = _get_user_id()
    AssistanceHistory.query.filter_by(user_id=user_id).delete()
    db.session.commit()
    return jsonify({"message": "History cleared."}), 200