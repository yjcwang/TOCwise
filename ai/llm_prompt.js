// ai/llm.js

let cachedLanguageModel = null; // Global cache for LanguageModel instance

export async function generateTitles(textArray) {
  if (!Array.isArray(textArray)) return [];

  // Fallback solution
  const fallbackTitle = (t) => {
    const s = String(t || "");
    const firstSentence = (s.split(/(?<=[。！？.!?])/)[0] || s).trim();
    const title = firstSentence.slice(0, 24).replace(/\s+/g, "");
    return { title: title || "无标题" };
  };

  // LanguageModel already initialized → reuse directly
  if (cachedLanguageModel) {
    console.log("llm: reuse cached LanguageModel");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
    const results = await summarizeBatch(cachedLanguageModel, textArray, fallbackTitle);
    chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
    return results;
  }

  // Notify sidebar to start AI initialization
  chrome.runtime.sendMessage({ type: "aiStatus", status: "loading" });
  
  console.log("llm: Hi I start check");
  // Check LanguageModel availability
  let canUseLanguageModel = false;

    try {
      const availability = await LanguageModel.availability();
      console.log("llm: api availability is", availability);

      if (availability === "downloading") {
        console.warn("Downloading Gemini Nano... Please wait...");
        chrome.runtime.sendMessage({ type: "aiStatus", status: "downloading" });
        alert("Downloading Gemini Nano... Please wait for some seconds...");
        return textArray.map(fallbackTitle);
      }
      if (availability !== "unavailable") canUseLanguageModel = true;
    } catch {
      canUseLanguageModel = false;
    }
  

  if (!canUseLanguageModel) {
    console.log("llm: fall back");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return textArray.map(fallbackTitle);
  }

  // Initialize LanguageModel (only on first execution)
  console.log("llm: init ai");
  const params = await LanguageModel.params();
  try {
    cachedLanguageModel = await LanguageModel.create({
        temperature: 0.4,
        topK: params.defaultTopK,
        expectedInputs: [
            { type: "text", languages: ["en" /* system prompt */, "en" /* user prompt */] }
        ],
        expectedOutputs: [
            { type: "text", languages: ["en"] }
        ],
        initialPrompts: [
            {
            role: 'system',
            content:
                'You are a skilled title stylist.'
            },
        ]
    });
  } catch {
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return textArray.map(fallbackTitle);
  }

  chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });

  const results = await summarizeBatch(cachedLanguageModel, textArray, fallbackTitle);
  chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
  return results;
}

// Extract batch generation logic for reuse
async function summarizeBatch(session, textArray, fallbackTitle) {
  const results = [];
  for (const text of textArray) {
    try {
      const raw = await session.prompt(`Here is the text that you want to summarize: ${text} Your task: Generate a natural and concise English section title. Do not include or repeat the website or product name (e.g. ChatGPT, Google). Keep the title in maximal 5 words. Output only the title text.`);
      const title = String(raw || "").trim();
      results.push({ title: title || fallbackTitle(text).title });
    } catch {
      results.push(fallbackTitle(text));
    }
  }
  return results;
}

// Optional: provide a reset method for content.js refresh
export function resetLanguageModel() {
  cachedLanguageModel = null;
}
