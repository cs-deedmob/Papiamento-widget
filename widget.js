(function () {
  function init() {
  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const GEMINI_API_KEY = "AIzaSyCY80ou4ysCiYFYFXZIivdNkTZhtorX6qA"; // ← swap this out later
  const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
    GEMINI_API_KEY;

  // ─── STATE ─────────────────────────────────────────────────────────────────
  let isTranslated = false;
  let originalTexts = new Map(); // node → original text
  let observer = null;
  let isTranslating = false;

  // ─── STYLE ─────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #pap-widget {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }

    #pap-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #1a1a2e;
      color: #fff;
      border: none;
      border-radius: 24px;
      padding: 10px 18px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      transition: background 0.2s, transform 0.15s;
      white-space: nowrap;
    }

    #pap-btn:hover {
      background: #16213e;
      transform: translateY(-1px);
    }

    #pap-btn .pap-flag {
      font-size: 18px;
      line-height: 1;
    }

    #pap-btn .pap-label {
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    #pap-btn .pap-status {
      font-size: 11px;
      opacity: 0.7;
      font-weight: 400;
    }

    #pap-btn.active {
      background: #0f3460;
    }

    #pap-btn.loading {
      opacity: 0.75;
      cursor: wait;
    }

    #pap-toast {
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: #1a1a2e;
      color: #fff;
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      z-index: 99999;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.3s, transform 0.3s;
      pointer-events: none;
      font-family: system-ui, sans-serif;
      max-width: 240px;
    }

    #pap-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);

  // ─── UI ────────────────────────────────────────────────────────────────────
  const widget = document.createElement("div");
  widget.id = "pap-widget";

  const btn = document.createElement("button");
  btn.id = "pap-btn";
  btn.innerHTML = `
    <span class="pap-flag">🇦🇼</span>
    <span class="pap-label">Papiamento</span>
    <span class="pap-status" id="pap-status">EN → PAP</span>
  `;
  widget.appendChild(btn);
  document.body.appendChild(widget);

  const toast = document.createElement("div");
  toast.id = "pap-toast";
  document.body.appendChild(toast);

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  function showToast(msg, duration = 3000) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), duration);
  }

  function setStatus(text) {
    document.getElementById("pap-status").textContent = text;
  }

  // Collect all visible text nodes that are worth translating
  function getTextNodes(root) {
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE"]);
    const nodes = [];
    const walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent.trim();
          if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
          if (skip.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.id === "pap-widget") return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.id === "pap-toast") return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  // Split array into chunks for batched API calls
  function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  // Send a batch of strings to Gemini, get back translated strings
  async function translateBatch(texts) {
    const prompt = `You are a Papiamento translator. Translate the following texts to Papiamento (the Aruban variant). 
Return ONLY a JSON array of translated strings, in the same order, with no explanation or extra text.
If a text is already in Papiamento or is a proper noun/name, return it unchanged.

Texts:
${JSON.stringify(texts)}`;

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!res.ok) throw new Error("Gemini API error: " + res.status);

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // Strip markdown code fences if Gemini wraps the JSON
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(clean);
  }

  // ─── TRANSLATE ─────────────────────────────────────────────────────────────
  async function translatePage() {
    if (isTranslating) return;
    isTranslating = true;
    btn.classList.add("loading");
    setStatus("Traduciendo...");
    showToast("🔄 Traduciendo pagina na Papiamento...", 8000);

    try {
      const nodes = getTextNodes();

      // Save originals
      nodes.forEach((node) => {
        if (!originalTexts.has(node)) originalTexts.set(node, node.textContent);
      });

      const texts = nodes.map((n) => n.textContent.trim());
      const batches = chunk(texts, 40); // 40 strings per API call
      const translated = [];

      for (const batch of batches) {
        const result = await translateBatch(batch);
        translated.push(...result);
      }

      // Apply translations
      nodes.forEach((node, i) => {
        if (translated[i]) node.textContent = translated[i];
      });

      isTranslated = true;
      btn.classList.add("active");
      btn.classList.remove("loading");
      setStatus("PAP ✓");
      showToast("✅ Pagina a wordo tradusi na Papiamento!", 4000);

      // Watch for new content (infinite scroll, modals, etc.)
      startObserver();
    } catch (err) {
      btn.classList.remove("loading");
      setStatus("EN → PAP");
      showToast("❌ Error: " + err.message, 5000);
      console.error("[Papiamento widget]", err);
    }

    isTranslating = false;
  }

  // ─── RESTORE ───────────────────────────────────────────────────────────────
  function restorePage() {
    stopObserver();
    originalTexts.forEach((original, node) => {
      node.textContent = original;
    });
    originalTexts.clear();
    isTranslated = false;
    btn.classList.remove("active");
    setStatus("EN → PAP");
    showToast("↩️ Teksto original a wordo restore.", 3000);
  }

  // ─── MUTATION OBSERVER (handles dynamic content) ───────────────────────────
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(async (mutations) => {
      if (isTranslating || !isTranslated) return;
      const newNodes = [];
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            newNodes.push(...getTextNodes(added));
          }
        }
      }
      if (newNodes.length === 0) return;

      // Only translate nodes we haven't seen before
      const fresh = newNodes.filter((n) => !originalTexts.has(n));
      if (fresh.length === 0) return;

      isTranslating = true;
      try {
        const texts = fresh.map((n) => n.textContent.trim());
        const batches = chunk(texts, 40);
        const translated = [];
        for (const batch of batches) {
          const result = await translateBatch(batch);
          translated.push(...result);
        }
        fresh.forEach((node, i) => {
          originalTexts.set(node, node.textContent);
          if (translated[i]) node.textContent = translated[i];
        });
      } catch (e) {
        console.error("[Papiamento widget observer]", e);
      }
      isTranslating = false;
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ─── TOGGLE ────────────────────────────────────────────────────────────────
  btn.addEventListener("click", () => {
    if (isTranslated) {
      restorePage();
    } else {
      translatePage();
    }
  });
  } // end init()

  if (document.body) {
    init();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    window.addEventListener("load", init);
  }
})();
