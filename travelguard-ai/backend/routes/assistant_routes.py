"""AI Travel Assistant routes (Phase 5).

Endpoints:
- POST /api/assistant/chat     -> Send message, get AI response
- GET  /api/assistant/history  -> Get conversation history
- DELETE /api/assistant/history -> Clear conversation history
"""
import os
import json
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session

from models import db, AssistanceHistory
from routes.auth_routes import login_required, csrf_protect

assistant_bp = Blueprint("assistant", __name__)

# Candidate models in priority order (verified active with real quota)
CANDIDATE_MODELS = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
]

# Track active model dynamically
_active_model_name = "gemini-3.5-flash"


def _generate_response_with_fallback(system_prompt: str, ai_prompt: str, gemini_history: list = None) -> tuple[str | None, str | None]:
    """
    Generate an AI response using candidate Gemini models with automatic failover.
    Returns (response_text, working_model_name). If all models fail, returns (None, None).
    """
    global _active_model_name
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None, None
    api_key = api_key.strip()
    if not api_key or api_key == "your-gemini-api-key-here":
        return None, None

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
    except Exception as e:
        print(f"[Gemini] Configure error: {e}")
        return None, None

    for model_name in CANDIDATE_MODELS:
        try:
            try:
                model = genai.GenerativeModel(model_name, system_instruction=system_prompt)
            except Exception:
                model = genai.GenerativeModel(model_name)

            if gemini_history:
                try:
                    chat_session = model.start_chat(history=gemini_history)
                    res = chat_session.send_message(
                        ai_prompt,
                        generation_config={"temperature": 0.7, "max_output_tokens": 1500}
                    )
                    text = (res.text or "").strip()
                    if text:
                        _active_model_name = model_name
                        print(f"[Gemini] Chat generated successfully with model: {model_name}")
                        return text, model_name
                except Exception as chat_err:
                    print(f"[Gemini] Chat session failed on {model_name}: {chat_err}. Trying direct content...")

            full_prompt = f"{system_prompt}\n\nUser Question:\n{ai_prompt}" if system_prompt else ai_prompt
            res = model.generate_content(
                full_prompt,
                generation_config={"temperature": 0.7, "max_output_tokens": 1500}
            )
            text = (res.text or "").strip()
            if text:
                _active_model_name = model_name
                print(f"[Gemini] Direct content generated with model: {model_name}")
                return text, model_name

        except Exception as ex:
            print(f"[Gemini] Model {model_name} failed: {ex}. Failing over to next candidate...")
            continue

    return None, None


@assistant_bp.get("/status")
def assistant_status():
    """Check AI assistant service availability."""
    api_key = os.getenv("GEMINI_API_KEY")
    has_key = bool(api_key and api_key.strip() and api_key.strip() != "your-gemini-api-key-here")
    return jsonify({
        "available": True,
        "demo": not has_key,
        "model": _active_model_name if has_key else "demo"
    }), 200


def _get_user_id() -> int | None:
    return session.get("user_id")


def _build_system_prompt() -> str:
    """Build the specialized system prompt for the travel assistant."""
    return (
        "You are TravelGuard AI, an expert emergency travel assistant and crisis problem solver.\n"
        "Your mission is to provide calm, reassuring, practical, and step-by-step guidance for travelers "
        "facing disruptions such as missed trains, cancelled flights, delayed transit, lost luggage, "
        "hotel cancellations, and unexpected travel expenses.\n\n"
        "### SPECIAL DIRECTIVE: MISSED TRAINS & TRANSIT EMERGENCIES\n"
        "Whenever a traveler asks about missing a train, bus, or connection:\n"
        "1. **Immediate Station Action Plan**:\n"
        "   - Advise them to head immediately to the Station Master / Reservation Counter (PRS) / Enquiry Desk.\n"
        "   - Give clear rules on ticket refunds & TDR: e.g., for IRCTC or online e-tickets, file a TDR (Ticket Deposit Receipt) "
        "within 3–4 hours of scheduled departure to recover permissible refund. For counter tickets, surrender at the refund counter before chart expiry.\n"
        "   - Recommend station facilities: Railway Cloakroom (to safely store luggage), 24/7 Executive Lounges, and Railway Retiring Rooms / Pods.\n"
        "2. **Real Transit Alternatives**:\n"
        "   - Next available train on the same route (Current Booking counters, Tatkal quota, or unreserved general coach).\n"
        "   - Intercity Buses (State transport corporations and private Volvo/sleeper buses).\n"
        "   - Outstation Taxis & Rideshare (Ola, Uber Intercity, local taxi stands, shared cabs).\n"
        "   - Car / Bike rentals or flights if the journey is long distance.\n"
        "3. **Emergency Cost & Budget Estimator (Structured Table)**:\n"
        "   ALWAYS include a clear markdown comparison table estimating the costs for each alternative:\n"
        "   | Alternative Option | Estimated Cost Range | Travel Time | Urgency Level | How to Book / Best For |\n"
        "   Provide total estimated budget options:\n"
        "   - **Ultra-Budget Option** (e.g. Next train unreserved / state bus + basic meal)\n"
        "   - **Comfort & Overnight Stay Option** (e.g. Railway retiring room or budget hotel + morning train)\n"
        "   - **Fast-Track Express Option** (e.g. Private outstation cab / emergency flight)\n"
        "4. **Emergency Helplines & Grounded Assistance**:\n"
        "   - State relevant emergency numbers (e.g. Railway Helpline 139 / Rail Madad in India, National Emergency 112 / 911).\n"
        "   - Ground answers in the user's verified location/city whenever provided in the prompt.\n\n"
        "Always format your answer with clear markdown headings, bullet points, and tables. Keep advice structured and immediately actionable."
    )


def _format_history_for_gemini(history: list) -> list:
    """Convert history to Gemini chat format, ensuring valid alternation."""
    messages = []
    for entry in history:
        u_msg = (entry.get("user_message") or "").strip()
        a_resp = (entry.get("assistant_response") or "").strip()
        if u_msg and a_resp:
            messages.append({"role": "user", "parts": [u_msg]})
            messages.append({"role": "model", "parts": [a_resp]})
    return messages


@assistant_bp.post("/chat")
def chat():
    """Send a message to the AI assistant and get a response."""
    user_id = _get_user_id()
    data = request.get_json(silent=True) or {}

    user_message = (data.get("message") or "").strip()
    if not user_message:
        return jsonify({"error": "Message is required."}), 400

    # Extract user's live location (GPS or IP)
    location = data.get("location")
    location_context = ""
    if location and isinstance(location, dict):
        loc_name = location.get("name") or location.get("city") or "Current Location"
        lat = location.get("lat")
        lng = location.get("lng")
        country = location.get("country") or "Local Area"
        loc_type = "Exact GPS" if location.get("isGps") else "IP Geolocation"
        location_context = (
            f"[User's Verified Location: {loc_name} ({loc_type}, Lat: {lat}, Lng: {lng}, Country: {country})]\n"
            f"Note for Assistant: Use this location context to provide accurate, locally relevant answers "
            f"(nearby hospitals, police, pharmacies, railway stations, bus stands, taxi terminals, hotels, "
            f"emergency numbers, local language, and cultural guidance) when answering the user's question.\n\n"
        )

    ai_prompt = f"{location_context}{user_message}" if location_context else user_message

    # Get conversation history from database if logged in
    gemini_history = []
    if user_id:
        history_entries = AssistanceHistory.query.filter_by(
            user_id=user_id, type="assistant"
        ).order_by(AssistanceHistory.created_at.asc()).limit(20).all()

        gemini_history = _format_history_for_gemini([
            {
                "user_message": h.meta.get("user_message", "") if h.meta else "",
                "assistant_response": h.message
            }
            for h in history_entries
        ])

    system_prompt = _build_system_prompt()
    assistant_response, used_model = _generate_response_with_fallback(
        system_prompt=system_prompt,
        ai_prompt=ai_prompt,
        gemini_history=gemini_history
    )

    if assistant_response:
        is_demo = False
    else:
        assistant_response = _get_demo_response(user_message)
        is_demo = True

    # Save to history if logged in
    timestamp_iso = datetime.now(timezone.utc).isoformat()
    if user_id:
        meta = {"user_message": user_message, "location": location if location else None, "model": used_model}
        entry = AssistanceHistory(
            user_id=user_id,
            type="assistant",
            title=user_message[:100],
            message=assistant_response,
            preview=user_message[:200],
            meta=meta,
        )
        db.session.add(entry)
        db.session.commit()
        if entry.created_at:
            timestamp_iso = entry.created_at.isoformat()

    return jsonify({
        "response": assistant_response,
        "timestamp": timestamp_iso,
        "demo": is_demo,
        "model": used_model or "demo"
    }), 200


def _get_demo_response(message: str) -> str:
    """Generate demo responses when Gemini API key is not configured."""
    message_lower = message.lower()

    if any(kw in message_lower for kw in ["train", "railway", "missed train", "miss train"]):
        return (
            "### 🚆 Emergency Guidance: Missed Train Alternatives & Cost Budget Estimator\n\n"
            "Don't worry! Here is your immediate emergency action plan, transit alternatives, and budget estimator.\n\n"
            "#### 1. Immediate Station & Ticket Actions\n"
            "• **File TDR / Cancellation:** If you had an online e-ticket (e.g., IRCTC), file an online **TDR (Ticket Deposit Receipt)** within 3–4 hours of scheduled train departure to claim a partial refund.\n"
            "• **Visit Reservation Counter (PRS):** Ask the counter supervisor for the next scheduled train on this route and whether 'Current Booking' or 'Tatkal' seats are open.\n"
            "• **Station Cloakroom & Lounge:** Deposit heavy luggage at the verified station cloakroom, and rest safely at the 24/7 Executive Lounge or Station Retiring Rooms.\n\n"
            "#### 2. Transit Alternatives & Cost Comparison\n\n"
            "| Alternative Option | Estimated Cost Range | Travel Time | Best For |\n"
            "| :--- | :--- | :--- | :--- |\n"
            "| **Next Train (General / Tatkal / Current)** | ₹150 – ₹1,200 ($5 – $25) | Same as original train | Most economical, direct route |\n"
            "| **Intercity Express Bus (State / Volvo Sleeper)** | ₹350 – ₹1,600 ($10 – $30) | +1 to 2 hours | Quickest scheduled departure |\n"
            "| **Outstation Taxi / Rideshare (Uber / Ola)** | ₹2,500 – ₹6,500 ($35 – $85) | Fastest road route | Small groups (2–4 travelers) or urgent arrival |\n"
            "| **Station Retiring Room + Next Day Train** | ₹800 – ₹2,200 ($12 – $30) | Overnight stay | Late-night safety, rested travel |\n\n"
            "#### 3. Emergency Cost & Budget Estimator\n"
            "• **Ultra-Budget Option (Bus/Unreserved + Snacks):** ~₹500 – ₹1,800 ($10 – $25)\n"
            "• **Fast-Track Express (Cab / Outstation Rideshare):** ~₹3,000 – ₹7,000 ($40 – $90)\n"
            "• **Comfort & Rest (Station Room / Hotel + Morning Train):** ~₹1,500 – ₹3,000 ($20 – $40)\n\n"
            "📞 **Emergency Contacts:** Railway Helpline **139** (Rail Madad) | National Emergency **112**."
        )

    if any(kw in message_lower for kw in ["missed", "miss", "late", "flight", "bus"]):
        return (
            "**Emergency Transit Response** — For a missed connection:\n\n"
            "1. **Stay calm** and go to the airline or transport counter immediately.\n"
            "2. **Ask for rebooking** on the next available service.\n"
            "3. **Request meal/hotel vouchers** if delay exceeds standard rules.\n"
            "4. **Check travel insurance** for unexpected emergency transit coverage.\n"
            "5. **Document everything** — photos of status boards, receipts, and staff names.\n\n"
            "📞 Dial **112** (or local emergency) if stranded in an unsafe area."
        )

    if any(kw in message_lower for kw in ["lost", "luggage", "bag", "baggage"]):
        return (
            "**Emergency Response** — For lost luggage:\n\n"
            "1. **File a Property Irregularity Report (PIR)** at the baggage office before leaving the airport/station.\n"
            "2. **Get a reference number** and contact info for follow-up.\n"
            "3. **List contents and value** for compensation claims.\n"
            "4. **Keep receipts** for essential purchases (toiletries, clothes).\n"
            "5. **Follow up daily** — most bags arrive within 48 hours."
        )

    if any(kw in message_lower for kw in ["hotel", "booking", "cancel", "overbook"]):
        return (
            "**Demo Response** — For hotel issues:\n\n"
            "1. **Speak to the front desk manager** calmly but firmly.\n"
            "2. **If overbooked**, they must provide comparable alternative + transport.\n"
            "3. **If cancelled**, demand refund + rebooking assistance.\n"
            "4. **Document** — photos, emails, names, times.\n"
            "5. **Contact booking platform** (Booking.com, Expedia) for support.\n"
            "6. **Check travel insurance** for accommodation coverage.\n\n"
            "*Note: This is a demo response. Configure GEMINI_API_KEY for real AI assistance.*"
        )

    if any(kw in message_lower for kw in ["emergency", "hospital", "police", "medical", "hurt", "sick"]):
        return (
            "**Demo Response** — For emergencies:\n\n"
            "1. **Call local emergency number** (112 in EU, 911 in US, 999 in UK).\n"
            "2. **Use the Emergency page** in this app for nearby hospitals/police.\n"
            "3. **Contact your embassy/consulate** if serious.\n"
            "4. **Notify travel insurance** immediately.\n"
            "5. **Keep all medical receipts** and reports.\n\n"
            "*Note: This is a demo response. Configure GEMINI_API_KEY for real AI assistance.*"
        )

    # Generic travel help
    return (
        "**Demo Response** — I can help with travel problems like:\n\n"
        "• Missed flights, trains, or buses\n"
        "• Cancelled or delayed transportation\n"
        "• Lost luggage or documents\n"
        "• Hotel booking problems\n"
        "• Unexpected expenses\n"
        "• Medical/safety concerns\n"
        "• Finding alternative routes\n\n"
        "Describe your situation for specific guidance.\n\n"
        "*Note: This is a demo response. Configure GEMINI_API_KEY in .env for real AI assistance.*"
    )


@assistant_bp.get("/history")
def get_history():
    """Get conversation history for the current user."""
    user_id = _get_user_id()
    if not user_id:
        return jsonify({"history": []}), 200

    history = AssistanceHistory.query.filter_by(
        user_id=user_id, type="assistant"
    ).order_by(AssistanceHistory.created_at.desc()).limit(50).all()

    return jsonify({
        "history": [
            {
                "id": h.id,
                "user_message": h.meta.get("user_message", "") if h.meta else "",
                "assistant_response": h.message,
                "timestamp": h.created_at.isoformat() if h.created_at else None,
            }
            for h in reversed(history)  # Chronological order
        ]
    }), 200


@assistant_bp.delete("/history")
def clear_history():
    """Clear all conversation history for the current user."""
    user_id = _get_user_id()
    if user_id:
        AssistanceHistory.query.filter_by(user_id=user_id, type="assistant").delete()
        db.session.commit()
    return jsonify({"message": "Conversation history cleared."}), 200


LANG_NAME_MAP = {
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "hi": "Hindi",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "ar": "Arabic",
    "nl": "Dutch",
    "tr": "Turkish",
    "th": "Thai",
    "vi": "Vietnamese",
    "en": "English",
}


def _translate_via_mymemory(text: str, source_lang: str, target_lang: str) -> str | None:
    """Free MyMemory translation fallback (50,000 chars/day, zero setup)."""
    try:
        import requests
        src_code = source_lang.strip() if source_lang and source_lang != "auto" else "en"
        tgt_code = target_lang.strip() if target_lang else "es"
        url = "https://api.mymemory.translated.net/get"
        params = {"q": text[:500], "langpair": f"{src_code}|{tgt_code}"}
        res = requests.get(url, params=params, timeout=5)
        if res.status_code == 200:
            data = res.json()
            out = data.get("responseData", {}).get("translatedText")
            if out and out.strip() and not out.startswith("MYMEMORY WARNING"):
                return out.strip()
    except Exception as e:
        print(f"[MyMemory] Fallback warning: {e}")
    return None


@assistant_bp.post("/translate")
def translate_text():
    """Translate travel phrase with multi-engine fallback (Gemini AI -> Direct Prompt -> MyMemory -> Dictionary)."""
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    source_lang = (data.get("source_lang") or "auto").strip()
    target_lang = (data.get("target_lang") or "es").strip()

    if not text:
        return jsonify({"error": "Text is required for translation."}), 400

    tgt_name = LANG_NAME_MAP.get(target_lang.lower(), target_lang)
    src_name = LANG_NAME_MAP.get(source_lang.lower(), "auto-detected") if source_lang != "auto" else "auto-detected"

    api_key = os.getenv("GEMINI_API_KEY")
    if api_key and api_key.strip() and api_key.strip() != "your-gemini-api-key-here":
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key.strip())

            # 1. Primary: Structured JSON Gemini Prompt
            json_prompt = (
                f"You are a professional travel language translator for international travelers.\n"
                f"Translate the following text accurately from {src_name} into {tgt_name}.\n"
                f"Source Text: \"{text}\"\n\n"
                f"Respond STRICTLY in valid JSON matching this schema:\n"
                f"{{\n"
                f'  "translated_text": "...",\n'
                f'  "pronunciation": "... (clear phonetic / romanized pronunciation guide)",\n'
                f'  "detected_source": "... (name of detected language)",\n'
                f'  "travel_tip": "... (practical advice on politeness, culture, or when to use this phrase)"\n'
                f"}}"
            )

            for model_name in CANDIDATE_MODELS:
                try:
                    model = genai.GenerativeModel(
                        model_name,
                        generation_config={"temperature": 0.2, "response_mime_type": "application/json"}
                    )
                    res = model.generate_content(json_prompt)
                    raw_out = (res.text or "").strip()
                    if raw_out.startswith("```"):
                        raw_out = raw_out.split("\n", 1)[-1]
                    if raw_out.endswith("```"):
                        raw_out = raw_out.rsplit("```", 1)[0]
                    raw_out = raw_out.strip()
                    parsed = json.loads(raw_out)

                    translated_candidate = (
                        parsed.get("translated_text")
                        or parsed.get("translation")
                        or parsed.get("translatedText")
                        or parsed.get("target_text")
                        or parsed.get("translated")
                        or parsed.get("result")
                    )

                    # Verify it actually translated (not echoing input when target differs)
                    if translated_candidate and (translated_candidate.strip().lower() != text.strip().lower() or target_lang.lower() == source_lang.lower()):
                        return jsonify({
                            "translated_text": translated_candidate.strip(),
                            "pronunciation": parsed.get("pronunciation", ""),
                            "detected_source": parsed.get("detected_source", src_name),
                            "travel_tip": parsed.get("travel_tip", f"Standard polite phrasing in {tgt_name}."),
                            "target_lang": target_lang,
                            "demo": False,
                            "model": model_name
                        }), 200

                except Exception as m_err:
                    print(f"[Translate JSON] Model {model_name} failed: {m_err}")
                    continue

            # 2. Secondary: Direct Unstructured Gemini Prompt
            for model_name in CANDIDATE_MODELS:
                try:
                    direct_model = genai.GenerativeModel(model_name)
                    direct_res = direct_model.generate_content(
                        f"Translate this text directly from {src_name} into {tgt_name}. Output ONLY the translated text without commentary, explanation, or quotes:\n\"{text}\""
                    )
                    direct_txt = (direct_res.text or "").strip().strip('"').strip("'")
                    if direct_txt and direct_txt.lower() != text.strip().lower():
                        return jsonify({
                            "translated_text": direct_txt,
                            "pronunciation": f"Spoken: {direct_txt}",
                            "detected_source": src_name,
                            "travel_tip": f"Show this translation in {tgt_name} to locals or use audio playback.",
                            "target_lang": target_lang,
                            "demo": False,
                            "model": model_name
                        }), 200
                except Exception as d_err:
                    print(f"[Translate Direct] Model {model_name} failed: {d_err}")
                    continue

        except Exception as ex:
            print(f"[Translate] Gemini API fallback triggered: {ex}")

    # 3. Tertiary: High-Reliability Online Engine (MyMemory)
    mymemory_result = _translate_via_mymemory(text, source_lang, target_lang)
    if mymemory_result and (mymemory_result.strip().lower() != text.strip().lower() or target_lang.lower() == source_lang.lower()):
        return jsonify({
            "translated_text": mymemory_result.strip(),
            "pronunciation": f"Spoken in {tgt_name}: {mymemory_result.strip()}",
            "detected_source": src_name,
            "travel_tip": f"Polite and common translation in {tgt_name}. Tap the Listen button to speak aloud.",
            "target_lang": target_lang,
            "demo": False,
            "model": "mymemory-engine"
        }), 200

    # 4. Quaternary: Comprehensive Offline Phrasebook & Travel Dictionary
    return jsonify(_get_offline_translation(text, source_lang, target_lang)), 200


def _get_offline_translation(text: str, source_lang: str, target_lang: str) -> dict:
    """Offline travel dictionary fallback for essential travel and phrasebook queries."""
    phrase_dict = {
        # Phrases from Traveler Phrasebook
        "where is the nearest hospital?": {
            "es": ("¿Dónde está el hospital más cercano?", "DOHN-deh ehs-TAH el ohs-pee-TAHL mahs sehr-KAH-noh", "Look for emergency signs marked 'Urgencias'."),
            "fr": ("Où se trouve l'hôpital le plus proche ?", "Oo suh troov low-pee-tal luh ploo prosh?", "In France, call SAMU (15) for emergency medical dispatch."),
            "de": ("Wo ist das nächste Krankenhaus?", "Voh ist dahs NAYKH-stuh KRAHN-ken-hows?", "Emergency rooms in Germany are marked 'Notaufnahme'."),
            "hi": ("सबसे नजदीकी अस्पताल कहाँ है?", "Sabse nazdeeki aspataal kahan hai?", "In India, call 108 or 112 for ambulance services."),
            "ja": ("一番近い病院はどこですか？", "Ichiban chikai byōin wa doko desu ka?", "Hospital emergency services in Japan can be reached via 119."),
            "it": ("Dov'è l'ospedale più vicino?", "Doh-VEH lohs-peh-DAH-leh pyoo vee-CHEE-noh?", "Look for 'Pronto Soccorso' for emergency intake.")
        },
        "i need urgent medical help!": {
            "es": ("¡Necesito ayuda médica urgente!", "Neh-seh-SEE-toh ah-YOO-dah MEH-dee-kah oor-HEN-teh", "Emergency triage is available at all public hospitals."),
            "fr": ("J'ai un besoin urgent d'aide médicale !", "Zhay uhn buh-zwan oor-zhahn ded may-dee-kahl!", "Dial 15 for urgent ambulance service."),
            "de": ("Ich brauche dringend ärztliche Hilfe!", "Ikh BROW-khuh DRING-end ERTS-tli-khuh HIL-fuh!", "Dial 112 across Germany."),
            "hi": ("मुझे तुरंत चिकित्सा सहायता चाहिए!", "Mujhe turant chikitsa sahayata chahiye!", "Call 108 or 112 immediately."),
            "ja": ("緊急の医療援助が必要です！", "Kinkyū no iryō enjo ga hitsuyō desu!", "Call 119 for emergency ambulance dispatch in Japan."),
            "it": ("Ho bisogno urgente di assistenza medica!", "Oh bee-ZOH-nyoh oor-ZHEN-teh dee ahs-sees-TEN-tsah MEH-dee-kah!", "Call 112 or 118 in Italy.")
        },
        "please call the police immediately!": {
            "es": ("¡Por favor, llame a la policía de inmediato!", "Por fah-VOR, YAH-meh ah lah poh-lee-SEE-ah deh een-meh-DYAH-toh!", "Police dispatch can be reached at 112 or 911."),
            "fr": ("S'il vous plaît, appelez la police immédiatement !", "Seel voo play, ah-play lah poh-lees ee-may-dyaht-mahn!", "Call 17 for Police Secours in France."),
            "de": ("Bitte rufen Sie sofort die Polizei!", "BIT-tuh ROO-fen zee zoh-FORT dee poh-lee-TSY!", "Dial 110 for Police across Germany."),
            "hi": ("कृपया तुरंत पुलिस को बुलाएं!", "Kripya turant police ko bulayein!", "Call 100 or 112 in India."),
            "ja": ("すぐに警察を呼んでください！", "Sugu ni keisatsu o yonde kudasai!", "Dial 110 for Police in Japan."),
            "it": ("Per favore, chiami subito la polizia!", "Pehr fah-VOH-reh, KYAH-mee SOO-bee-toh lah poh-leet-SEE-ah!", "Call 112 across Italy.")
        },
        "i lost my passport and wallet.": {
            "es": ("Perdí mi pasaporte y mi billetera.", "Pehr-DEE mee pah-sah-POR-teh ee mee bee-yeh-TEH-rah.", "File a formal police report ('denuncia') for emergency consular passport replacement."),
            "fr": ("J'ai perdu mon passeport et mon portefeuille.", "Zhay pehr-doo mohn pahs-por ay mohn port-fuh-yuh.", "Visit the nearest Commissariat de Police immediately."),
            "de": ("Ich habe meinen Pass und meine Brieftasche verloren.", "Ikh HAH-buh MY-nen pahs oont MY-nuh BREEF-tah-shuh fehr-LOH-ren.", "Report to the local Fundbüro and your embassy."),
            "hi": ("मेरा पासपोर्ट और बटुआ खो गया है।", "Mera passport aur batua kho gaya hai.", "Contact the nearest police station to lodge an FIR."),
            "ja": ("パスポートと財布をなくしました。", "Pasupōto to saifu o nakushimashita.", "Report to the nearest Kōban (police box)."),
            "it": ("Ho perso il passaporto e il portafoglio.", "Oh PEHR-soh eel pahs-sah-POR-toh ay eel por-tah-FOH-lyoh.", "File a 'denuncia di smarrimento' with the Carabinieri.")
        },
        "i am allergic to penicillin and nuts.": {
            "es": ("Soy alérgico a la penicilina y a los frutos secos.", "Soy ah-LEHR-hee-koh ah lah peh-nee-see-LEE-nah ee ah lohs FROO-tohs SEH-kohs.", "Show this directly to pharmacy staff or medical staff."),
            "fr": ("Je suis allergique à la pénicilline et aux fruits à coque.", "Zhuh swee zah-lehr-zheek ah lah pay-nee-see-leen ay oh frwee ah kok.", "Carry this on your phone in all dining situations."),
            "de": ("Ich bin allergisch gegen Penicillin und Nüsse.", "Ikh bin ah-LEHR-gish GAY-gen peh-nee-tsee-LEEN oont NEW-suh.", "German servers take allergy notices very seriously."),
            "hi": ("मुझे पेनिसिलिन और मेवों से एलर्जी है।", "Mujhe penicillin aur mewon se allergy hai.", "Inform hospital triage immediately."),
            "ja": ("ペニシリンとナッツにアレルギーがあります。", "Penishirin to nattsu ni arerugī ga arimasu.", "Essential dining safety phrase in Japan."),
            "it": ("Sono allergico alla penicillina e alla frutta a guscio.", "SOH-noh ahl-LEHR-jee-koh AHL-lah peh-nee-cheel-LEE-nah ay AHL-lah FROOT-tah ah GOO-shoh.", "Show before ordering food.")
        },
        "where is the train station?": {
            "es": ("¿Dónde está la estación de tren?", "DOHN-deh ehs-TAH lah ehs-tah-SYOHN deh trehn?", "Look for 'Estación de Ferrocarril' or 'Renfe'."),
            "fr": ("Où est la gare ?", "Oo ay lah gahr?", "Main central terminals are marked 'Gare Centrale'."),
            "de": ("Wo ist der Bahnhof?", "Voh ist der BAHN-hohf?", "Look for the large green 'H' or 'DB' logos."),
            "hi": ("रेलवे स्टेशन कहाँ है?", "Railway station kahan hai?", "Widely recognized throughout India."),
            "ja": ("駅はどこですか？", "Eki wa doko desu ka?", "Look for JR or Tokyo Metro subway signs."),
            "it": ("Dov'è la stazione ferroviaria?", "Doh-VEH lah stah-TSYOH-neh fehr-roh-VYAH-ryah?", "Stations are marked 'Stazione Centrale'.")
        },
        "how much does a ride to the airport cost?": {
            "es": ("¿Cuánto cuesta un viaje al aeropuerto?", "KWAN-toh KWEHS-tah oon VYAH-heh ahl ah-eh-roh-PWEHR-toh?", "Confirm flat rate or meter before boarding."),
            "fr": ("Combien coûte un trajet jusqu'à l'aéroport ?", "Kom-byan koot uhn trah-zhay zhoos-kah lay-roh-por?", "Fixed airport taxi rates apply in Paris."),
            "de": ("Wie viel kostet eine Fahrt zum Flughafen?", "Vee feel KOHS-tet EYE-nuh fart tsoom FLOOG-hah-fen?", "Taxis accept cards and cash."),
            "hi": ("एयरपोर्ट जाने का कितना किराया है?", "Airport jaane ka kitna kiraya hai?", "Prepaid taxi booths provide guaranteed rates."),
            "ja": ("空港までの運賃はいくらですか？", "Kūkō made no unchin wa ikura desu ka?", "Express rail options are often faster than taxis."),
            "it": ("Quanto costa una corsa per l'aeroporto?", "KWAHN-toh KOH-stah OO-nah KOHR-sah pehr lay-roh-POR-toh?", "Ask for 'tariffa fissa'.")
        },
        "please take me to this address.": {
            "es": ("Por favor, lléveme a esta dirección.", "Por fah-VOR, YEH-veh-meh ah EHS-tah dee-rehk-SYOHN.", "Show your destination on Google Maps to the driver."),
            "fr": ("S'il vous plaît, emmenez-moi à cette adresse.", "Seel voo play, ahm-nay-mwah ah set ah-dress.", "Having the street name written down is easiest."),
            "de": ("Bitte bringen Sie mich zu dieser Adresse.", "BIT-tuh BRING-en zee mikh tsoo DEE-zer ah-DREHS-suh.", "Show navigation app pin if pronunciation is unfamiliar."),
            "hi": ("कृपया मुझे इस पते पर ले चलिए।", "Kripya mujhe is pate par le chaliye.", "Point out landmarks for navigation."),
            "ja": ("この住所まで連れて行ってください。", "Kono jūsho made tsurete itte kudasai.", "Addresses in Japan are easiest shown printed or on maps."),
            "it": ("Per favore, mi porti a questo indirizzo.", "Pehr fah-VOH-reh, mee POR-tee ah KWEHS-toh een-dee-REET-tsoh.", "Always verify destination before departing.")
        },
        "where can i rent a car or bike?": {
            "es": ("¿Dónde puedo alquilar un coche o una bicicleta?", "DOHN-deh PWEH-doh ahl-kee-LAHR oon KOH-cheh oh OO-nah bee-see-KLEH-tah?", "Check for international driving permit requirements."),
            "fr": ("Où puis-je louer une voiture ou un vélo ?", "Oo pweezh loo-ay oon vwah-toor oo uhn vay-loh?", "City rental bike kiosks accept standard contactless cards."),
            "de": ("Wo kann ich ein Auto oder ein Fahrrad mieten?", "Voh kahn ikh eye-n OW-toh OH-der eye-n FAHR-raht MEE-ten?", "Look for major rental hubs at stations."),
            "hi": ("कार या बाइक किराए पर कहाँ मिलेगी?", "Car ya bike kiraaye par kahan milegi?", "Keep driving license and national ID ready."),
            "ja": ("車や自転車はどこで借りられますか？", "Kuruma ya jitensha wa doko de kariraremasu ka?", "IDP (Geneva Convention) is strictly required for driving."),
            "it": ("Dove posso noleggiare un'auto o una bicicletta?", "DOH-veh POHS-soh noh-lehd-JAH-reh oon-OW-toh oh OO-nah bee-chee-KLEHT-tah?", "Look for 'Autonoleggio'.")
        },
        "could we have the bill, please?": {
            "es": ("¿Nos trae la cuenta, por favor?", "Nohs TRAH-eh lah KWEHN-tah, por fah-VOR?", "Tips are typically 5-10% in casual dining."),
            "fr": ("L'addition, s'il vous plaît.", "Lah-dee-syohn, seel voo play.", "Service is usually included ('service compris')."),
            "de": ("Die Rechnung, bitte.", "Dee REKH-noong, BIT-tuh.", "Round up to nearest euro or add 5-10%."),
            "hi": ("कृपया बिल दे दीजिए।", "Kripya bill de dijiye.", "Service tax is commonly included on bills."),
            "ja": ("お会計をお願いします。", "O-kaikei o onegai shimasu.", "Pay at the front counter; tipping is not customary."),
            "it": ("Il conto, per favore.", "Eel KOHN-toh, pehr fah-VOH-reh.", "'Coperto' cover charge is normal on Italian restaurant checks.")
        },
        "could i have bottled water, please?": {
            "es": ("¿Me da agua embotellada, por favor?", "Meh dah AH-gwah em-boh-teh-YAH-dah, por fah-VOR?", "'Sin gas' for still water, 'con gas' for sparkling."),
            "fr": ("Pourrais-je avoir de l'eau en bouteille, s'il vous plaît ?", "Poo-rezh ah-vwar duh low ahn boo-tay, seel voo play?", "Ask for 'de l'eau plate' for still water."),
            "de": ("Könnte ich bitte eine Flasche Wasser haben?", "KERN-tuh ikh BIT-tuh EYE-nuh FLAH-shuh VAHS-ser HAH-ben?", "'Ohne Kohlensäure' means still water."),
            "hi": ("कृपया मुझे बोतलबंद पानी दीजिए।", "Kripya mujhe botalband paani dijiye.", "Always check that the seal is unbroken."),
            "ja": ("ミネラルウォーターをいただけますか？", "Mineraru wōtā o itadakemasu ka?", "Tap water is safe everywhere in Japan."),
            "it": ("Potrei avere dell'acqua in bottiglia, per favore?", "Poh-TRAY ah-VEH-reh dehl-AHK-wah een boht-TEEL-yah, pehr fah-VOH-reh?", "'Acqua naturale' is still water.")
        },
        # Common Everyday Words
        "hello": {
            "es": ("Hola", "OH-lah", "Universal friendly greeting."),
            "fr": ("Bonjour", "Bohn-zhoor", "Standard polite greeting during the day."),
            "de": ("Hallo", "HAH-loh", "Casual and polite across German regions."),
            "hi": ("नमस्ते", "Namaste", "Respectful traditional greeting."),
            "ja": ("こんにちは", "Konnichiwa", "Polite daytime greeting."),
            "it": ("Ciao", "CHOW", "Friendly informal greeting.")
        },
        "thank you": {
            "es": ("Muchas gracias", "MOO-chahs GRAH-syahs", "Universal expression of gratitude."),
            "fr": ("Merci beaucoup", "Mehr-see boh-koo", "Standard polite thank you."),
            "de": ("Vielen Dank", "FEE-len dahnk", "Heartfelt thanks."),
            "hi": ("धन्यवाद", "Dhanyavaad", "Formal expression of thanks."),
            "ja": ("ありがとうございます", "Arigatō gozaimasu", "Polite standard thank you."),
            "it": ("Grazie mille", "GRAHT-syeh MEEL-leh", "Very polite thanks.")
        },
        "i need help": {
            "es": ("Necesito ayuda", "Neh-seh-SEE-toh ah-YOO-dah", "Direct call for assistance."),
            "fr": ("J'ai besoin d'aide", "Zhay buh-zwan ded", "Urgent request for assistance."),
            "de": ("Ich brauche Hilfe", "Ikh BROW-khuh HIL-fuh", "Clear emergency request."),
            "hi": ("मुझे मदद चाहिए", "Mujhe madad chahiye", "Urgent call for help."),
            "ja": ("助けてください", "Tasukete kudasai", "Urgent polite cry for help."),
            "it": ("Ho bisogno di aiuto", "Oh bee-ZOH-nyoh dee ah-YOO-toh", "Emergency plea for help.")
        },
        "i missed my train": {
            "es": ("Perdí mi tren", "Pehr-DEE mee trehn", "Speak to station customer service."),
            "fr": ("J'ai raté mon train", "Zhay rah-tay mohn trahn", "Visit the SNCF counter immediately."),
            "de": ("Ich habe meinen Zug verpasst", "Ikh HAH-buh MY-nen tsoog fehr-PAHST", "Speak to DB Reisezentrum staff."),
            "hi": ("मेरी ट्रेन छूट गई है", "Meri train chhoot gayi hai", "Visit the station enquiry counter."),
            "ja": ("電車に乗り遅れました", "Densha ni noriokuremashita", "Speak to station staff at the fare adjustment counter."),
            "it": ("Ho perso il mio treno", "Oh PEHR-soh eel MEE-oh TREH-noh", "Head to the Trenitalia helpdesk.")
        }
    }

    norm = text.lower().strip().rstrip(".!?")
    # Exact or stripped match
    for k, lang_map in phrase_dict.items():
        if k.rstrip(".!?") == norm:
            match = lang_map.get(target_lang)
            if match:
                tr, pron, tip = match
                return {
                    "translated_text": tr,
                    "pronunciation": pron,
                    "detected_source": "English",
                    "travel_tip": tip,
                    "target_lang": target_lang,
                    "demo": False,
                    "model": "offline-phrasebook"
                }

    tgt_label = LANG_NAME_MAP.get(target_lang.lower(), target_lang.upper())
    return {
        "translated_text": f"[{tgt_label}] {text}",
        "pronunciation": f"Spoken in {tgt_label}: {text}",
        "detected_source": source_lang if source_lang != "auto" else "Auto-detected",
        "travel_tip": f"Show this phrase to locals or play audio in {tgt_label}.",
        "target_lang": target_lang,
        "demo": True,
        "model": "fallback"
    }