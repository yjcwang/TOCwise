console.log('Content script loaded');

// 注入一个极简横线样式
const style = document.createElement("style");
style.textContent = `
  .ai-flash-marker {
    height: 2px;
    background:rgb(255, 119, 0); /* 纯蓝色 */
    opacity: 1;
    margin: 0; /* 去掉上下间距避免文字跳动 */
    pointer-events: none;  /* 不挡点击 */
  }
`;
document.head.appendChild(style);

const state = {
  chunks: [],        // [{text, anchorId}] 原文分段（纯文本 + 跳转锚点）
  outlines: []       // [{title, anchorId}] AI 结果（标题+同锚点）
};

//首屏先取前 N 段，滚动时再补
const FIRST_BATCH = 20;

//初始化
async function init() {
  console.log("content: init");
  state.chunks = window.segmentPage(); // 从 segment.js 来, 等待异步返回结果
  // 先返回占位“生成中…”
  state.outlines = state.chunks.map(({anchorId}) => ({
    title: "生成中…",
    anchorId
  }));
  // 触发首批生成
  requestAI(0, Math.min(FIRST_BATCH, state.chunks.length));
}

//AI调用
async function requestAI(start, end) {
  console.log("Content: request AI",start,"to",end);
  const { generateTitles } = await import(chrome.runtime.getURL("ai/llm.js"));
  const slice = state.chunks.slice(start, end);
  const texts = slice.map(c => c.text);
  // 输出[{title: string}]   让模型生成结果, 顺序要与输入严格一致
  const results = await generateTitles(texts); 
  // 把局部位置对齐全局位置，并写入对应锚点id
  results.forEach((r, i) => {
    const idx = start + i;
    state.outlines[idx] = { ...r, anchorId: state.chunks[idx].anchorId };
  });
  // 通知侧栏：start..end 这一段已经更新完，可以做增量渲染
  console.log("Content: Continue with AI");
  chrome.runtime.sendMessage({ type: "aiOutlineUpdated", start, end });
}

// 继续请求剩余部分，侧栏交互或滚动触发
function requestRest() {
  
  const start = Math.min(
    state.outlines.findIndex(o => o.title === "生成中…"),
    state.outlines.length
  );
  if (start === -1) return;
  const end = Math.min(start + FIRST_BATCH, state.outlines.length);
  requestAI(start, end);
}

//监听侧边栏并反应
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  
  if (msg.type === "getOutline") { // 发 getOutline 来索要当前目录列表
    sendResponse({ outlines: state.outlines });
    // “生成中…”占位回给侧栏
    console.log("Content: Request Rest");
    requestRest();
  }
  
  if (msg.type === "jumpTo") { // 点侧栏标题 → 页面平滑跳到对应原文位置，并且标注横线
    const el = document.getElementById(msg.anchorId);
    /* 暂时不添加跳转后向下偏移
    if (/chat\.openai\.com/.test(location.hostname)) {
      console.log("ChatGpt jumpTo");
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // 自定义滚动：目标位置 - 80px 留白
      const rect = el.getBoundingClientRect();
      const targetY = rect.top + window.scrollY - 80;
      window.scrollTo({ top: targetY, behavior: "smooth" });

    }*/
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    
    // 插入一个临时标记线（在锚点位置）
    document.querySelectorAll(".ai-flash-marker").forEach(m => m.remove()); // 先清理之前线
    const marker = document.createElement("div");
    marker.className = "ai-flash-marker";
    el.insertAdjacentElement("afterend", marker);
    setTimeout(() => marker.remove(), 4000);
    // 下一个锚点横线
    if (msg.nextAnchorId) {
      const next = document.getElementById(msg.nextAnchorId);
      if (next) {
        const bottomLine = document.createElement("div");
        bottomLine.className = "ai-flash-marker";
        next.insertAdjacentElement("beforebegin", bottomLine);
        setTimeout(() => bottomLine.remove(), 4000);
      }
    }

    sendResponse(true);
  }
  
  if (msg.type === "getActiveByScroll") { // 高亮 = 在侧边目录里把“当前所在章节”用样式标出来
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

  // 重新生成标题列表
  if (msg.type === "reInit") {
    console.log("Content: reInit triggered from sidebar");
    init();  
    sendResponse({ ok: true });
  }
});

// 延迟 5 秒，确保页面内容加载完成再启动
setTimeout(init, 5000);

