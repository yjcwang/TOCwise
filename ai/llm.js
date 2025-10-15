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
      sharedContext: "This is a text section."
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
      const raw = await summarizer.summarize(text, {
        context:
          "Generate a short English section title (max 5 words). \
          Do not include or repeat the website or product name (e.g. ChatGPT, Google). \
          Start directly with the main content."
      });
      const title = String(raw || "").trim();
      results.push({ title: title || fallbackTitle(text).title });
    } catch {
      results.push(fallbackTitle(text));
    }
  }
  return results;
}

// 可选：提供一个reset方法，供content.js刷新时使用
export function resetSummarizer() {
  cachedSummarizer = null;
}
