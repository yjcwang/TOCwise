// ai/llm.js

let cachedLanguageModel = null; // 全局缓存 LanguageModel 实例

export async function generateTitles(textArray) {
  if (!Array.isArray(textArray)) return [];

  // 回退方案
  const fallbackTitle = (t) => {
    const s = String(t || "");
    const firstSentence = (s.split(/(?<=[。！？.!?])/)[0] || s).trim();
    const title = firstSentence.slice(0, 24).replace(/\s+/g, "");
    return { title: title || "无标题" };
  };

  // LanguageModel 已经初始化 → 直接复用
  if (cachedLanguageModel) {
    console.log("llm: reuse cached LanguageModel");
    chrome.runtime.sendMessage({ type: "aiStatus", status: "ready" });
    const results = await summarizeBatch(cachedLanguageModel, textArray, fallbackTitle);
    chrome.runtime.sendMessage({ type: "aiStatus", status: "finish" });
    return results;
  }

  // 通知sidebar开始初始化ai
  chrome.runtime.sendMessage({ type: "aiStatus", status: "loading" });
  
  console.log("llm: Hi I start check");
  // 检查LanguageModel可用性
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

  // 初始化 LanguageModel（仅第一次执行）
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

// 提取批量生成逻辑，方便复用
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

// 可选：提供一个reset方法，供content.js刷新时使用
export function resetLanguageModel() {
  cachedLanguageModel = null;
}
