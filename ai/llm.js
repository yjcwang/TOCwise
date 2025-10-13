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
      // availability: 'readily'|'after-download'|'unavailable'
      
      // 等待下载，弹窗提示用户等待
      if (availability === "after-download") {
      console.warn("Downloading Gemini Nano... Please wait...");
      alert("Downloading Gemini Nano... Please wait for some seconds...");
      return textArray.map(fallbackTitle);
    }
      
      // 首次创建需要用户手势激活，如点击按钮等
      if (availability !== "unavailable" && navigator.userActivation?.isActive) {
        canUseSummarizer = true;
      }
    } catch {
      canUseSummarizer = false;
    }
  }
  // 如果不可用或无用户激活，直接回退
  if (!canUseSummarizer) {
    return textArray.map(fallbackTitle);
  }

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
        context: "Generate a concise and short section title in the same language as the input."
      });
      const title = String(raw || "").trim();
      results.push({ title: title || fallbackTitle(text).title });
    } catch {
      results.push(fallbackTitle(text));
    }
  }

  return results;
}
