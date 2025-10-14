// ai/llm.js

// 输入：文本段落 string[]   输出：标题 { title: string }[]
export async function generateTitles(textArray) {
  // 确保是数组
  if (!Array.isArray(textArray)) return [];

  // 回退方案：取首句，截断到 24 字符
  const fallbackTitle = (t) => {
    const s = String(t || "");
    const firstSentence = (s.split(/(?<=[。！？.!?])/)[0] || s).trim();
    const title = firstSentence.slice(0, 24).replace(/\s+/g, "");
    return { title: title || "无标题" };
  };

  // 判断用户是否可以使用Summarizer
  let canUseSummarizer = false;
  if ("Summarizer" in self) {
    try {
      const availability = await Summarizer.availability(); 
      // availability: 'downloadable'|'downloading'|'unavailable'| 'available'
      
      console.log("llm: api availability is ", availability);
      
      // 等待下载，弹窗提示用户等待
      if (availability === "downloading") {
      console.warn("Downloading Gemini Nano... Please wait...");
      alert("Downloading Gemini Nano... Please wait for some seconds...");
      return textArray.map(fallbackTitle);
    }
      
      // 确认Suammarizer可用
      if (availability !== "unavailable") {
        canUseSummarizer = true;
      }
    } catch {
      canUseSummarizer = false;
    }
  }
  // 如果不可用就回退
  if (!canUseSummarizer) {
    console.log("llm: fall back");
    return textArray.map(fallbackTitle);
  }

  console.log("llm: init ai");
  // 创建初始化 summarizer 实例
  let summarizer;
  try {
    summarizer = await Summarizer.create({
      type: "headline",                // 标题
      format: "plain-text",            // 纯文本
      length: "short",                 // 简短
      sharedContext: "This is a text section."
    });
  } catch {
    return textArray.map(fallbackTitle);
  }

  // suammarizer逐段生成标题
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
