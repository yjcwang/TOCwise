// 网页语义分段核心逻辑
// 从当前页面提取出「可读的内容块」，然后切分成合适长度的文本段，供后续 AI（Gemini Nano）生成标题
// 两种分割方法，generic或者chat

//TODO 更改字数分段，完善chat分段策略

console.log('Segment script loaded');

// 判断元素是否可见
function isVisible(el) {
  const style = window.getComputedStyle(el); 
  const rect = el.getBoundingClientRect();
  return ( 
    style &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// 给每个node加一个隐藏锚点（anchor），跳转目标的锚点
function ensureAnchor(node) {
  if (!node.id) {
    const id = "ai-anchor-" + Math.random().toString(36).slice(2, 10);
    const span = document.createElement("span");
    span.id = id;
    span.style.cssText = "position:relative;display:block;height:0;overflow:hidden;";
    node.prepend(span);
    node.dataset.__ai_anchor_id = id;
  } else {
    node.dataset.__ai_anchor_id = node.id;
  }
}

// 字数分段法
function segmentPage_generic() {
  const root = document.body;
  // Step 1: 获取候选节点
  const sel = [ // 典型的内容标签
    "article", "section", "main", "blockquote",
    "p", "li", "pre", "div[role='article']",
    "div[role='main']", "div[role='region']",
    "div.markdown", "div.prose", "div.message",
    "div.chat-message", "div.post", "div.comment"
  ].join(",");
  let nodes = [...root.querySelectorAll(sel)].filter(isVisible); // 过滤掉不可见的元素 with isVisible()
  // 去掉导航/脚注/代码块大容器等明显无关区域（可渐进增强）
  nodes = nodes.filter(n => {
    const t = (n.innerText || "").trim();
    if (!t) return false;
    if (t.length < 30) return false;           // 太短的先丢
    if (t.match(/^\s*cookie|accept|subscribe|登录|注册/i)) return false;
    return true;
  });
  // Step 2: 为每个节点添加锚点
  nodes.forEach(ensureAnchor);
  // Step 3: 合并节点为块（chunk）
  const minLen=500;
  const maxLen=1200;
  const chunks = []; // 最终输出结果
  let buf = [];
  let bufLen = 0;

  // 把当前暂存的数据（缓冲区里的段落）输出为一个完整的块（chunk）
  const flush = () => {
    if (buf.length) {
      const text = buf.map(n => (n.innerText || "").trim()).join("\n\n");
      const ids  = buf.map(n => n.dataset.__ai_anchor_id).filter(Boolean);
      const anchorId = buf[0].dataset.__ai_anchor_id;
      chunks.push({ text, anchorId }); // 记录下这些节点的锚点 ID（后面会用于点击跳转）
      buf = []; bufLen = 0;
    }
  };
 // 循环把段落逐个加入缓存
  for (const n of nodes) {
    const text = (n.innerText || "").trim();
    if (bufLen + text.length > maxLen) flush(); // 超长就输出
    buf.push(n);
    bufLen += text.length;
    if (bufLen >= minLen) flush();  // 到达下限也输出
  }
  flush();
  return chunks;
}

// chatbot回答分段法
function segmentPage_chatgpt() {
  // Step 1: 找到所有 <article data-turn="user|assistant"> 节点
  // 过滤掉用户回答
  const nodes = [...document.querySelectorAll("article[data-turn='assistant']")].filter(isVisible);
  // Step 2: 给每个加上一个锚点
  nodes.forEach(ensureAnchor);
  // Step 3: 输出结构（每条消息就是一个块）
  const chunks = nodes.map(node => ({
    text: node.innerText.trim(),
    anchorId: node.dataset.__ai_anchor_id,
    role: node.dataset.turn || "unknown"
  })).filter(c => c.text.length > 0);

  return chunks;
}

// Gemini分段法
function segmentPage_gemini() {
  // 找到所有 Gemini 对话块
  const containers = [...document.querySelectorAll("div.conversation-container")].filter(isVisible);

  const chunks = [];

  for (const container of containers) {
    const node = container.querySelector("model-response");
    if (node && node.innerText.trim()) {
      ensureAnchor(node);
      chunks.push({
        text: node.innerText.trim(),
        anchorId: node.dataset.__ai_anchor_id,
      });
    }
  }

  return chunks;
}

function segmentPage_qwen() {
  // 1️⃣ 找到所有模型回复块
  const responses = [...document.querySelectorAll(".response-message-body--normal")]
    .filter(isVisible);

  // 2️⃣ 为每个回复添加锚点并提取文本
  const chunks = responses.map(el => {
    const textContainer = el.querySelector(".markdown-content-container");
    const text = textContainer ? textContainer.innerText.trim() : el.innerText.trim();

    ensureAnchor(el);
    return {
      text,
      anchorId: el.dataset.__ai_anchor_id,
    };
  }).filter(c => c.text.length > 0);

  return chunks;
}

function segmentPage_claude() {
  // 找到所有回复块（每个 data-is-streaming="false" 的 div 都是一条完整回复）
  const responses = [...document.querySelectorAll('div[data-is-streaming="false"]')].filter(isVisible);

  const chunks = responses.map(el => {
    // 提取文本内容（优先 markdown 容器）
    const textContainer = el.querySelector(".standard-markdown") || el;
    const text = textContainer.innerText.trim();

    ensureAnchor(el);
    return {
      text,
      anchorId: el.dataset.__ai_anchor_id,
    };
  }).filter(c => c.text.length > 0);

  return chunks;
}



// 标题分段法（Wikipedia、Docs类网页）
// 每个 chunk 最多 3000 字，超出自动拆分
function segmentPage_heading() {
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5")].filter(isVisible);
  if (!headings.length) {
    console.warn("No headings found, fallback to generic segmentation");
    return segmentPage_generic();
  }

  const chunks = [];
  const MAX_LEN = 3000; // 增加一个长度上限

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];

    ensureAnchor(current);
    const anchorId = current.dataset.__ai_anchor_id;

    const content = [];
    let node = current.nextElementSibling;
    while (node && node !== next) {
      if (isVisible(node) && node.innerText.trim()) {
        content.push(node.innerText.trim());
      }
      node = node.nextElementSibling;
    }

    const fullText = [current.innerText, ...content].join("\n\n").trim();

    // 如果超出上限则切块
    if (fullText.length > MAX_LEN) {
      for (let j = 0; j < fullText.length; j += MAX_LEN) {
        chunks.push({
          text: fullText.slice(j, j + MAX_LEN),
          anchorId: anchorId,
        });
      }
    } else {
      chunks.push({ text: fullText, anchorId: anchorId });
    }
  }

  return chunks;
}






function isChatGPT() {
  const host = location.hostname;
  return /(^|\.)chat\.openai\.com$/.test(host) || /(^|\.)chatgpt\.com$/.test(host);
}

function isGemini() {
  const host = location.hostname;
  return /(^|\.)gemini\.google\.com$/.test(host);
}

function isQwen() {
  const host = location.hostname;
  return /(^|\.)qwen\.ai$/.test(host);
}

function isClaude() {
  const host = location.hostname;
  return /(^|\.)claude\.ai$/.test(host);
}




function segmentPage() {
  let chunks = [];

  if (isChatGPT()) {
    chunks = segmentPage_chatgpt();
    console.log("Detected ChatGPT chat layout:", chunks.length, "chunks output");
  } else if (isGemini()) {
    chunks = segmentPage_gemini();
    console.log("Detected Gemini chat layout:", chunks.length, "chunks output");
  } else if (isQwen()) {
    chunks = segmentPage_qwen();
    console.log("Detected Qwen chat layout:", chunks.length, "chunks output");
  } else if (isClaude()) {
    chunks = segmentPage_claude();
    console.log("Detected Claude chat layout:", chunks.length, "chunks output");
  } else if (/wikipedia\.org|readthedocs\.io|mdn\.mozilla\.org|medium\.com/.test(location.hostname)) {
    chunks = segmentPage_heading();
    console.log("Detected heading layout:", chunks.length, "chunks output");
  } else {
    chunks = segmentPage_generic();
    console.log("Detected generic layout:", chunks.length, "chunks output");
  }

  const clean = chunks
    .map(c => ({
      text: c.text,
      anchorId: c.anchorId
    }))
    .filter(c => c.text.trim().length > 0 && c.anchorId);

  return clean; 
}
window.segmentPage = segmentPage;

