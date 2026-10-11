// TravelGuard AI — AI Language Translator Controller
// Vanilla JS + Fetch API + Web Speech API for Text-to-Speech

document.addEventListener("DOMContentLoaded", () => {
  let csrfToken = null;
  let isTranslating = false;

  // DOM Elements
  const sourceLangSelect = document.getElementById("source-lang-select");
  const targetLangSelect = document.getElementById("target-lang-select");
  const sourceText = document.getElementById("source-text");
  const clearSourceBtn = document.getElementById("clear-source-btn");
  const charCounter = document.getElementById("char-counter");
  const translateBtn = document.getElementById("translate-btn");
  const swapLangBtn = document.getElementById("swap-lang-btn");
  const micBtn = document.getElementById("mic-btn");

  const targetPlaceholder = document.getElementById("target-placeholder");
  const targetContent = document.getElementById("target-content");
  const translatedText = document.getElementById("translated-text");
  const pronunciationBox = document.getElementById("pronunciation-box");
  const pronunciationText = document.getElementById("pronunciation-text");
  const travelTipBox = document.getElementById("travel-tip-box");
  const travelTipText = document.getElementById("travel-tip-text");
  const detectedLangPill = document.getElementById("detected-lang-pill");
  const translationLoading = document.getElementById("translation-loading");
  const speakBtn = document.getElementById("speak-btn");
  const copyBtn = document.getElementById("copy-btn");

  const phraseChips = document.querySelectorAll(".phrase-chip");

  // Get CSRF Token
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch("/api/auth/csrf");
      if (!res.ok) return "";
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    } catch {
      return "";
    }
  }

  // Character counter and clear button
  if (sourceText) {
    sourceText.addEventListener("input", () => {
      const len = sourceText.value.length;
      if (charCounter) charCounter.textContent = `${len} / 1000`;
      if (clearSourceBtn) clearSourceBtn.hidden = len === 0;
    });

    sourceText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doTranslate();
      }
    });
  }

  if (clearSourceBtn) {
    clearSourceBtn.addEventListener("click", () => {
      sourceText.value = "";
      sourceText.focus();
      charCounter.textContent = "0 / 1000";
      clearSourceBtn.hidden = true;
      resetOutput();
    });
  }

  function resetOutput() {
    if (targetPlaceholder) targetPlaceholder.hidden = false;
    if (targetContent) targetContent.hidden = true;
    if (pronunciationBox) pronunciationBox.hidden = true;
    if (travelTipBox) travelTipBox.hidden = true;
    if (detectedLangPill) detectedLangPill.textContent = "";
  }

  // Swap Languages
  if (swapLangBtn) {
    swapLangBtn.addEventListener("click", () => {
      const src = sourceLangSelect.value;
      const tgt = targetLangSelect.value;

      if (src === "auto") {
        sourceLangSelect.value = tgt;
        targetLangSelect.value = "en";
      } else {
        sourceLangSelect.value = tgt;
        targetLangSelect.value = src;
      }

      // If translated text exists, swap it into source and translate back
      const curTranslated = translatedText ? translatedText.textContent.trim() : "";
      if (curTranslated) {
        sourceText.value = curTranslated;
        if (charCounter) charCounter.textContent = `${curTranslated.length} / 1000`;
        doTranslate();
      }
    });
  }

  // Voice Input (Speech-to-Text)
  if (micBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;

      micBtn.addEventListener("click", () => {
        const srcCode = sourceLangSelect.value;
        recognition.lang = srcCode === "auto" ? "en-US" : srcCode;
        micBtn.textContent = "🎙️ Listening...";
        micBtn.classList.add("active");
        try {
          recognition.start();
        } catch (err) {
          console.warn("Recognition already active:", err);
        }
      });

      recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        sourceText.value = speechResult;
        if (charCounter) charCounter.textContent = `${speechResult.length} / 1000`;
        if (clearSourceBtn) clearSourceBtn.hidden = false;
        micBtn.textContent = "🎤 Voice Input";
        doTranslate();
      };

      recognition.onerror = () => {
        micBtn.textContent = "🎤 Voice Input";
      };

      recognition.onend = () => {
        micBtn.textContent = "🎤 Voice Input";
      };
    } else {
      micBtn.title = "Speech recognition not supported in this browser";
      micBtn.disabled = true;
      micBtn.style.opacity = "0.5";
    }
  }

  // Translate Action
  if (translateBtn) {
    translateBtn.addEventListener("click", doTranslate);
  }

  // Language select change triggers immediate re-translation
  if (targetLangSelect) {
    targetLangSelect.addEventListener("change", () => {
      const text = sourceText ? sourceText.value.trim() : "";
      if (text) doTranslate();
    });
  }

  if (sourceLangSelect) {
    sourceLangSelect.addEventListener("change", () => {
      const text = sourceText ? sourceText.value.trim() : "";
      if (text) doTranslate();
    });
  }

  async function doTranslate() {
    const text = sourceText ? sourceText.value.trim() : "";
    if (!text || isTranslating) return;

    const sourceLang = sourceLangSelect ? sourceLangSelect.value : "auto";
    const targetLang = targetLangSelect ? targetLangSelect.value : "es";

    isTranslating = true;
    if (translateBtn) {
      translateBtn.disabled = true;
      translateBtn.textContent = "Translating...";
    }

    if (targetPlaceholder) targetPlaceholder.hidden = true;
    if (targetContent) targetContent.hidden = true;
    if (translationLoading) translationLoading.style.display = "flex";

    try {
      const token = await getCsrfToken();
      let data = null;

      try {
        const res = await fetch("/api/assistant/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "X-CSRF-Token": token } : {})
          },
          body: JSON.stringify({
            text,
            source_lang: sourceLang,
            target_lang: targetLang
          })
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch (netErr) {
        console.warn("Backend translation network warning:", netErr);
      }

      let finalTranslation = data ? data.translated_text : null;

      // If backend returned untranslated text or bracketed fallback, fetch direct MyMemory in browser
      if (!finalTranslation || (finalTranslation.trim().toLowerCase() === text.trim().toLowerCase() && targetLang !== sourceLang) || finalTranslation.startsWith("[")) {
        try {
          const srcParam = sourceLang === "auto" ? "en" : sourceLang;
          const directUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${srcParam}|${targetLang}`;
          const mRes = await fetch(directUrl);
          if (mRes.ok) {
            const mData = await mRes.json();
            const directText = mData.responseData && mData.responseData.translatedText;
            if (directText && !directText.startsWith("MYMEMORY WARNING")) {
              finalTranslation = directText;
            }
          }
        } catch (mErr) {
          console.warn("Browser direct translation warning:", mErr);
        }
      }

      if (!finalTranslation) {
        finalTranslation = text;
      }

      // Render output
      if (translatedText) {
        translatedText.textContent = finalTranslation;
      }

      const pronunciation = data ? data.pronunciation : null;
      if (pronunciation && pronunciation.trim()) {
        if (pronunciationText) pronunciationText.textContent = pronunciation;
        if (pronunciationBox) pronunciationBox.hidden = false;
      } else {
        if (pronunciationBox) pronunciationBox.hidden = true;
      }

      const tip = data ? data.travel_tip : null;
      if (tip && tip.trim()) {
        if (travelTipText) travelTipText.textContent = tip;
        if (travelTipBox) travelTipBox.hidden = false;
      } else {
        if (travelTipBox) travelTipBox.hidden = true;
      }

      if (detectedLangPill) {
        detectedLangPill.textContent = (data && data.detected_source) ? `Detected: ${data.detected_source}` : "";
      }

      if (targetContent) targetContent.hidden = false;

    } catch (err) {
      console.error("Translation error:", err);
      // Final attempt: browser direct translation
      try {
        const srcParam = sourceLang === "auto" ? "en" : sourceLang;
        const directUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${srcParam}|${targetLang}`;
        const mRes = await fetch(directUrl);
        if (mRes.ok) {
          const mData = await mRes.json();
          const directText = mData.responseData && mData.responseData.translatedText;
          if (directText && !directText.startsWith("MYMEMORY WARNING")) {
            if (translatedText) translatedText.textContent = directText;
            if (targetContent) targetContent.hidden = false;
            return;
          }
        }
      } catch (directErr) {
        console.error("Browser direct translation failed:", directErr);
      }

      if (translatedText) translatedText.textContent = "Translation temporarily unavailable. Please try again.";
      if (targetContent) targetContent.hidden = false;
    } finally {
      isTranslating = false;
      if (translationLoading) translationLoading.style.display = "none";
      if (translateBtn) {
        translateBtn.disabled = false;
        translateBtn.textContent = "Translate ➔";
      }
    }
  }

  // Audio Speech (Text-to-Speech)
  if (speakBtn) {
    speakBtn.addEventListener("click", () => {
      const textToSpeak = translatedText ? translatedText.textContent.trim() : "";
      if (!textToSpeak || !window.speechSynthesis) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const tgtCode = targetLangSelect ? targetLangSelect.value : "es";

      // Match voice locale
      utterance.lang = tgtCode;
      utterance.rate = 0.9; // Slightly slower for clear travel pronunciation

      speakBtn.textContent = "🔊 Playing...";
      utterance.onend = () => {
        speakBtn.textContent = "🔊 Listen";
      };
      utterance.onerror = () => {
        speakBtn.textContent = "🔊 Listen";
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  // Copy Translation
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const textToCopy = translatedText ? translatedText.textContent.trim() : "";
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "✓ Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      } catch (e) {
        console.warn("Clipboard copy fallback:", e);
      }
    });
  }

  // Phrasebook chip clicks
  phraseChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const phrase = chip.dataset.phrase;
      if (!phrase) return;

      sourceText.value = phrase;
      if (charCounter) charCounter.textContent = `${phrase.length} / 1000`;
      if (clearSourceBtn) clearSourceBtn.hidden = false;

      // Scroll to translator box on small screens
      sourceText.focus();
      doTranslate();
    });
  });
});
