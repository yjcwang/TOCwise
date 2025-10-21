// ai/llm.js

let cachedSummarizer = null; // 全局缓存 Summarizer 实例

export async function generateTitles(textArray) {
  if (!Array.isArray(textArray)) return [];

  // 回退方案
  const fallbackTitle = (t) => {
    const s = String(t || "");
    const firstSentence = (s.split(/(?<=[。！？.!?])/)[0] || s).trim();
    const title = firstSentence.slice(0, 24).replace(/\s+/g, "");
    return { title: title || "无标题" };
  };

  // Summarizer 已经初始化 → 直接复用
  if (cachedSummarizer) {
    console.log("llm: reuse cached summarizer");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
    const results = await summarizeBatch(cachedSummarizer, textArray, fallbackTitle);
    chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
    return results;
  }

  // 通知sidebar开始初始化ai
  chrome.runtime.sendMessage({ type: "aiStatus", status: "loading" });
  
  // 检查Summarizer可用性
  let canUseSummarizer = false;
  if ("Summarizer" in self) {
    try {
      const availability = await Summarizer.availability();
      console.log("llm: api availability is", availability);

      if (availability === "downloading") {
        console.warn("Downloading Gemini Nano... Please wait...");
        chrome.runtime.sendMessage({ type: "aiStatus", status: "downloading" });
        alert("Downloading Gemini Nano... Please wait for some seconds...");
        return textArray.map(fallbackTitle);
      }
      if (availability !== "unavailable") canUseSummarizer = true;
    } catch {
      canUseSummarizer = false;
    }
  }

  if (!canUseSummarizer) {
    console.log("llm: fall back");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "failed" });
    return textArray.map(fallbackTitle);
  }

  // 初始化 Summarizer（仅第一次执行）
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

// 提取批量生成逻辑，方便复用
async function summarizeBatch(summarizer, textArray, fallbackTitle) {
  const results = [];
  for (const text of textArray) {
    try {
      let raw = await summarizer.summarize(text, {
        context:
          "Write a concise English section title (max 5 words). Use Title Case (Capitalize Each Main Word). Keep style consistent across all titles. Do not use ALL CAPS or punctuation. Do not include brand or product names. Output only the title text."
      });
      let title = String(raw || "").trim();

      // 如果超过5词，重试一次
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

// 可选：提供一个reset方法，供content.js刷新时使用
export function resetSummarizer() {
  cachedSummarizer = null;
}
