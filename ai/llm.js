// ai/llm.js

let cachedSummarizer = null; // Global cache for Summarizer instance
let cachedSummarizerBullet = null; // Global cache for Summarizer instance

 // Check Summarizer availability
async function checkSummarizer() {
  let canUseSummarizer = false;
  if ("Summarizer" in self) {
    try {
      const availability = await Summarizer.availability();
      console.log("llm: api availability is", availability);

      if (availability === "downloading") {
        console.warn("Downloading Gemini Nano... Please wait...");
        chrome.runtime.sendMessage({ type: "aiStatus", status: "downloading" });
        alert("Downloading Gemini Nano... Please wait for some seconds...");
        return false;
      }
      if (availability !== "unavailable") canUseSummarizer = true;
    } catch {
      canUseSummarizer = false;
    }
  }

  if (!canUseSummarizer) {
    console.log("llm: fall back");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return false;
  } else return true;
}

// Generate titles
export async function generateTitles(textArray) {
  if (!Array.isArray(textArray)) return [];

  // Fallback solution
  const fallbackTitle = (t) => {
    const s = String(t || "");
    const firstSentence = (s.split(/(?<=[。！？.!?])/)[0] || s).trim();
    const title = firstSentence.slice(0, 24).replace(/\s+/g, "");
    return { title: title || "无标题" };
  };

  // Summarizer already initialized → reuse directly
  if (cachedSummarizer) {
    console.log("llm: reuse cached summarizer");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
    const results = await summarizeBatch(cachedSummarizer, textArray, fallbackTitle);
    chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
    return results;
  }

  // Notify sidebar to start AI initialization
  chrome.runtime.sendMessage({ type: "aiStatus", status: "loading" });


 // Check Summarizer availability
  const ok = await checkSummarizer();
  if(!ok) {
    console.warn("Gemini Nano unavailable for summarization");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return textArray.map(fallbackTitle);
  }

  // Initialize Summarizer (only on first execution)
  console.log("llm: init ai");
  try {
    cachedSummarizer = await Summarizer.create({
      type: "headline",
      format: "plain-text",
      length: "short",
      sharedContext: "You are a skilled short-title stylist.",
      expectedInputs: [
            { type: "text", languages: ["en" /* system prompt */, "en" /* user prompt */] }
        ],
      expectedOutputs: [
            { type: "text", languages: ["en"] }
        ],
    });
  } catch {
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return textArray.map(fallbackTitle);
  }

  chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });

  const results = await summarizeBatch(cachedSummarizer, textArray, fallbackTitle);
  chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
  return results;
}

// Batch reuse for title generation
async function summarizeBatch(summarizer, textArray, fallbackTitle) {
  const results = [];
  for (const text of textArray) {
    try {
      let raw = await summarizer.summarize(text, {
        context:
          "Write a concise English section title (max 5 words). Use Title Case (Capitalize Each Main Word). Keep style consistent across all titles. Do not use ALL CAPS or punctuation. Do not include brand or product names. Output only the title text."
      });
      let title = String(raw || "").trim();

      // If more than 5 words, retry once
      const wordCount = title.split(/\s+/).filter(Boolean).length;
      if (wordCount > 6) {
        console.warn(`Title too long (${wordCount} words): "${title}" — retrying...`);
        raw = await summarizer.summarize(title, {
          context:
            "Shorten the title to 5 words or fewer. Use Title Case (Capitalize Each Main Word). Keep style consistent across all titles. Avoid sentences — use short noun phrases only. Do not use ALL CAPS or punctuation. Do not include brand or product names. Output only the title text."
        });
        title = String(raw || "").trim();
      }

      results.push({ title: title || fallbackTitle(text).title });
    } catch (err) {
      console.error("Summarizer error on text:", text.slice(0, 20), "...");
      console.error("Error details:", err);
      results.push(fallbackTitle(text));
    }
  }
  return results;
}

// Optional: provide a reset method for content.js refresh
export function resetSummarizer() {
  cachedSummarizer = null;
}


// Generate bullet-point summary
export async function generateBullets(text) {

  // Summarizer already initialized → reuse directly
  if (cachedSummarizerBullet) {
    console.log("llm: reuse cached summarizer");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
    const results = await bulletsBatch(cachedSummarizerBullet, text);
    chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
    return results;
  }

  // Notify sidebar to start AI initialization
  chrome.runtime.sendMessage({ type: "aiStatus", status: "loading" });

  const ok = await checkSummarizer();
  if (!ok) {
    console.warn("Gemini Nano unavailable for bullet summarization");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return ["Local Gemini Nano unavailable. Please enable it in Chrome settings."];
  }

  console.log("llm: init ai");
  try {
    cachedSummarizerBullet = await Summarizer.create({
      type: "key-points",
      format: "plain-text",
      length: "short",
      expectedInputs: [
            { type: "text", languages: ["en" /* system prompt */, "en" /* user prompt */] }
        ],
      expectedOutputs: [
            { type: "text", languages: ["en"] }
        ],
    });
  } catch (err){
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    console.error("Error details:", err);
    return ["Failed to summarize"];
  }

  chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
  const results = await bulletsBatch(cachedSummarizerBullet, text);
  chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
  return results;
}

// Batch reuse for bullet points generation
async function bulletsBatch(summarizer, text){
  try {
    let result = await summarizer.summarize(text, {
      context:
        "Summarize the following chat or text block into 3–5 short, clear bullet points. Output only the bullet points, one per line."
    });
    const output =
      typeof result === "string" ? result :
      (result && typeof result.output === "string" ? result.output : "");

    if (!output.trim()) return ["(No summary generated)"];
    return output.split("\n").filter(l => l.trim());
  } catch (err) {
    console.error("generateBullets failed", err);
    return ["Failed to summarize"];
  }
}

