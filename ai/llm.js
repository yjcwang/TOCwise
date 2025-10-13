// ai/llm.js
export async function generateTitles(textArray) {
  // 纯本地 mock：取首句前 24 字当标题，后面一句做摘要
  return textArray.map(t => {
    const sents = t.split(/(?<=[。！？.!?])/);
    const first = (sents[0] || t).trim();
    const title = first.slice(0, 24).replace(/\s+/g, ""); // 简短标题
    return { title: title || "小节", summary };
  });
}

