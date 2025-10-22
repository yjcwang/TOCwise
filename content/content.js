console.log('Content script loaded');

// 注入一个极简横线样式
const style = document.createElement("style");
style.textContent = `
  .ai-flash-marker {
    height: 2px;
    background:rgba(140, 0, 255, 0.53);
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
const FIRST_BATCH = 10;

//初始化
async function init() {
  console.log("content: init");
  state.chunks = window.segmentPage(); // 从 segment.js 来
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

 // 新增标题
  if (msg.type === "checkUpdate") {
    console.log("content: checkUpdate triggered from sidebar");
    rebuildIncremental();
    sendResponse({ ok: true });
  }
});


// 新增标题函数
async function rebuildIncremental() {
  console.log("content: incremental rebuild start");

  const newChunks = window.segmentPage();  // 重新获取页面分段
  const oldLen = state.chunks.length;
  const newLen = newChunks.length;

  // 识别chunk数量来判断是否需要新增标题
  if (newLen <= oldLen) {
    console.log("No new chunks detected, directory is up to date.");
    return;
  }

  // 找到新增部分
  const added = newChunks.slice(oldLen);
  console.log(`Detected ${added.length} new chunks`);

  // 追加到 state.chunks
  state.chunks.push(...added);

  // 为新增部分准备占位标题
  const start = oldLen;
  const end = newLen;
  for (let i = start; i < end; i++) {
    state.outlines[i] = { title: "生成中…", anchorId: newChunks[i].anchorId };
  }

  // 调用 AI 仅生成新增部分标题
  await requestAI(start, end);

  // 通知侧栏更新
  chrome.runtime.sendMessage({ type: "aiOutlineUpdated", start, end });
  console.log("content: incremental rebuild complete");
}


// 初次启动，检测到chunk数量不为0时才开始生成标题，最多等待30秒
(async function waitForChunks() {
  console.log("content: waiting for chunks...");
  tries = 0;
  while (tries < 15) {
    try {
      // 执行分段
      const temp = window.segmentPage?.();
      if (Array.isArray(temp) && temp.length > 0) {
        console.log("content: chunks ready → start init()");
        init(); // 开始生成标题
        break;
      }
    } catch (e) {
      console.warn("segmentPage not ready yet", e);
    }

    // 每隔 2 秒重试一次
    await new Promise(r => setTimeout(r, 2000));
    tries ++;
  }
})();