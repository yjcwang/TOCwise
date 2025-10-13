// 网页语义分段核心逻辑
// 从当前页面提取出「可读的内容块」，然后切分成合适长度的文本段，供后续 AI（Gemini Nano）生成标题

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

// 获取候选内容块
function getCandidateNodes_generic(root=document.body) {
  const sel = [ // 典型的内容标签
    "article", "section", "main", "blockquote",
    "p", "li", "pre", "div[role='article']",
    "div[role='main']", "div[role='region']",
    "div.markdown", "div.prose", "div.message",
    "div.chat-message", "div.post", "div.comment"
  ].join(",");
  const nodes = [...root.querySelectorAll(sel)].filter(isVisible); // 过滤掉不可见的元素 with isVisible()
  // 去掉导航/脚注/代码块大容器等明显无关区域（可渐进增强）
  return nodes.filter(n => {
    const t = (n.innerText || "").trim();
    if (!t) return false;
    if (t.length < 30) return false;           // 太短的先丢
    if (t.match(/^\s*cookie|accept|subscribe|登录|注册/i)) return false;
    return true;
  });
}

// 合并内容块
function mergeToChunks_generic(nodes, minLen=300, maxLen=1200) {
  
}

// 给每个内容块加一个隐藏锚点（anchor），跳转目标的锚点
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

// 默认分段策略,字数分段法
function segmentPage_generic() {
  // Step 1: 获取候选节点
  const nodes = getCandidateNodes_generic();
  // Step 2: 为每个节点添加锚点
  nodes.forEach(ensureAnchor);
  // Step 3: 合并节点为块（chunk）
  const chunks = []; // 最终输出结果
  let buf = [];
  let bufLen = 0;

  // 把当前暂存的数据（缓冲区里的段落）输出为一个完整的块（chunk）
  const flush = () => {
    if (buf.length) {
      const text = buf.map(n => (n.innerText || "").trim()).join("\n\n");
      const ids  = buf.map(n => n.dataset.__ai_anchor_id).filter(Boolean);
      chunks.push({ text, anchorIds: ids }); // 记录下这些节点的锚点 ID（后面会用于点击跳转）
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

export function segmentPage() {
  if(true) {
    const chunks = segmentPage_generic();
  } else {
    // TODO: 其他分段策略
  }
  // 输出：供 AI 使用的干净分段数据
  return chunks.map((c) => ({  
    text: c.text,
    anchorId: c.anchorIds && c.anchorIds.length ? c.anchorIds[0] : null
  })).filter(c => c.text.trim().length > 0 && c.anchorId);
}