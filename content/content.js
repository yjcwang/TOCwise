import { segmentPage } from "./segment.js";

const state = {
  chunks: [],        // [{text, anchorId}]
  outlines: []       // [{title, summary, anchorId}]
};

// 简单节流：首屏先取前 N 段，滚动时再补
const FIRST_BATCH = 8;

async function init() {
  state.chunks = segmentPage();
  // 先返回占位“生成中…”
  state.outlines = state.chunks.map(({anchorId}) => ({
    title: "生成中…",
    summary: "",
    anchorId
  }));
  // 触发首批生成
  requestAI(0, Math.min(FIRST_BATCH, state.chunks.length));
}

async function requestAI(start, end) {
  const { generateTitles } = await import(chrome.runtime.getURL("ai/llm.js"));
  const slice = state.chunks.slice(start, end);
  const texts = slice.map(c => c.text);
  const results = await generateTitles(texts); // [{title, summary}]
  results.forEach((r, i) => {
    const idx = start + i;
    state.outlines[idx] = { ...r, anchorId: state.chunks[idx].anchorId };
  });
  // 通知侧栏增量更新
  chrome.runtime.sendMessage({ type: "aiOutlineUpdated", start, end });
}

// 继续请求剩余部分（侧栏或滚动触发）
function requestRest() {
  const start = Math.min(
    state.outlines.findIndex(o => o.title === "生成中…"),
    state.outlines.length
  );
  if (start === -1) return;
  const end = Math.min(start + FIRST_BATCH, state.outlines.length);
  requestAI(start, end);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getOutline") {
    sendResponse({ outlines: state.outlines });
    // 侧栏一打开就拉余量
    requestRest();
  }
  if (msg.type === "jumpTo") {
    const el = document.getElementById(msg.anchorId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    sendResponse(true);
  }
  if (msg.type === "getActiveByScroll") {
    // 找到最接近视窗顶部的 anchor
    const vis = state.outlines.map(o => {
      const el = document.getElementById(o.anchorId);
      if (!el) return { id: o.anchorId, top: Infinity };
      const rect = el.getBoundingClientRect();
      return { id: o.anchorId, top: Math.abs(rect.top) };
    });
    vis.sort((a,b)=>a.top-b.top);
    sendResponse({ anchorId: vis[0]?.id });
  }
});

init();
