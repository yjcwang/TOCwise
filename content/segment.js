// Core logic for web page semantic segmentation
// Extract "readable content blocks" from current page, then split into appropriately sized text segments for subsequent AI (Gemini Nano) title generation
// Two segmentation methods: generic or chat

//TODO Change word count segmentation, improve chat segmentation strategy

console.log('Segment script loaded');

// Check if element is visible
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

// Add a hidden anchor (anchor) to each node, target anchor for jumping
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

// Word count segmentation method
function segmentPage_generic() {
  const root = document.body;
  // Step 1: Get candidate nodes
  const sel = [ // Typical content tags
    "article", "section", "main", "blockquote",
    "p", "li", "pre", "div[role='article']",
    "div[role='main']", "div[role='region']",
    "div.markdown", "div.prose", "div.message",
    "div.chat-message", "div.post", "div.comment"
  ].join(",");
  let nodes = [...root.querySelectorAll(sel)].filter(isVisible); // Filter out invisible elements with isVisible()
  // Remove navigation/footnotes/code block containers and other obviously irrelevant areas (can be progressively enhanced)
  nodes = nodes.filter(n => {
    const t = (n.innerText || "").trim();
    if (!t) return false;
    if (t.length < 30) return false;           // Too short, discard first
    if (t.match(/^\s*cookie|accept|subscribe|登录|注册/i)) return false;
    return true;
  });
  // Step 2: Add anchor to each node
  nodes.forEach(ensureAnchor);
  // Step 3: Merge nodes into chunks
  const minLen=100;
  const maxLen=3000;
  const chunks = []; // Final output result
  let buf = [];
  let bufLen = 0;

  // Output current buffered data (paragraphs in buffer) as a complete chunk
  const flush = () => {
    if (buf.length) {
      const text = buf.map(n => (n.innerText || "").trim()).join("\n\n");
      const ids  = buf.map(n => n.dataset.__ai_anchor_id).filter(Boolean);
      const anchorId = buf[0].dataset.__ai_anchor_id;
      chunks.push({ text, anchorId }); // Record anchor IDs of these nodes (used for click jumping later)
      buf = []; bufLen = 0;
    }
  };
 // Loop to add paragraphs one by one to cache
  for (const n of nodes) {
    const text = (n.innerText || "").trim();
    if (bufLen + text.length > maxLen) flush(); // Output if too long
    buf.push(n);
    bufLen += text.length;
    if (bufLen >= minLen) flush();  // Output when reaching lower limit
  }
  flush();
  return chunks;
}

// Chatbot response segmentation method
function segmentPage_chatgpt() {
  // Step 1: Find all <article data-turn="user|assistant"> nodes
  // Filter out user responses
  const nodes = [...document.querySelectorAll("article[data-turn='assistant']")].filter(isVisible);
  // Step 2: Add an anchor to each
  nodes.forEach(ensureAnchor);
  // Step 3: Output structure (each message is a chunk)
  const chunks = nodes.map(node => ({
    text: node.innerText.trim(),
    anchorId: node.dataset.__ai_anchor_id,
    role: node.dataset.turn || "unknown"
  })).filter(c => c.text.length > 0);

  return chunks;
}

// Gemini segmentation method
function segmentPage_gemini() {
  // Find all Gemini conversation blocks
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
  // 1️⃣ Find all model response blocks
  const responses = [...document.querySelectorAll(".response-message-body--normal")]
    .filter(isVisible);

  // 2️⃣ Add anchor to each response and extract text
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
  // Find all response blocks (each div with data-is-streaming="false" is a complete response)
  const responses = [...document.querySelectorAll('div[data-is-streaming="false"]')].filter(isVisible);

  const chunks = responses.map(el => {
    // Extract text content (prioritize markdown container)
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



// Heading segmentation method (Wikipedia, Docs, blog-like web pages)
// Each chunk max 3000 characters, auto-split if exceeded, ignore chunks smaller than 50 characters
function segmentPage_heading() {
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(isVisible);
  if (!headings.length) {
    console.warn("No headings found, fallback to generic segmentation");
    return segmentPage_generic();
  }

  const chunks = [];
  const MAX_LEN = 3000; // Add a length upper limit
  const MIN_LEN = 50;

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

    if (!fullText) continue;
    // Skip if too small (except Wikipedia format)
    if (fullText.length < MIN_LEN && !/wikipedia\.org/.test(location.hostname)) continue;
    

    // Split if exceeds upper limit
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
  } else {
    chunks = segmentPage_heading();
    console.log("Detected generic heading layout:", chunks.length, "chunks output");
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

