console.log('Content script loaded');

// Inject a minimal horizontal line style
const style = document.createElement("style");
style.textContent = `
  .ai-flash-marker {
    height: 2px;
    background:rgba(140, 0, 255, 0.53);
    opacity: 1;
    margin: 0; /* Remove top/bottom spacing to avoid text jumping */
    pointer-events: none;  /* Don't block clicks */
  }
`;
document.head.appendChild(style);

const state = {
  chunks: [],        // [{text, anchorId}] Original text segments (pure text + jump anchor)
  outlines: []       // [{title, anchorId}] AI results (title + same anchor)
};

// Get first N segments on first screen, then add more on scroll
const FIRST_BATCH = 10;

//Initialize
async function init() {
  console.log("content: init");
  state.chunks = window.segmentPage(); // From segment.js
  // Return placeholder "Generating..." first
  state.outlines = state.chunks.map(({anchorId}) => ({
    title: "Generating…",
    anchorId
  }));
  // Trigger first batch generation
  requestAI(0, Math.min(FIRST_BATCH, state.chunks.length));
}

//AI call
async function requestAI(start, end) {
  console.log("Content: request AI",start,"to",end);
  const { generateTitles } = await import(chrome.runtime.getURL("ai/llm.js"));
  const slice = state.chunks.slice(start, end);
  const texts = slice.map(c => c.text);
  // Output [{title: string}] Let model generate results, order must strictly match input
  const results = await generateTitles(texts); 
  // Align local position with global position and write corresponding anchor id
  results.forEach((r, i) => {
    const idx = start + i;
    state.outlines[idx] = { ...r, anchorId: state.chunks[idx].anchorId };
  });
  // Notify sidebar: start..end segment has been updated, can do incremental rendering
  console.log("Content: Continue with AI");
  chrome.runtime.sendMessage({ type: "aiOutlineUpdated", start, end });
}

// Continue requesting remaining parts, triggered by sidebar interaction or scroll
function requestRest() {
  
  const start = Math.min(
    state.outlines.findIndex(o => o.title === "Generating…"),
    state.outlines.length
  );
  if (start === -1) return;
  const end = Math.min(start + FIRST_BATCH, state.outlines.length);
  requestAI(start, end);
}

//Listen to sidebar and respond
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  
  if (msg.type === "getOutline") { // Send getOutline to request current directory list
    // ✅ If state.outlines is not ready yet, return placeholder first to prevent blank sidebar
    if (!state.outlines || state.outlines.length === 0) {
      console.log("Content: outlines not ready → return placeholder");
      const temp = window.segmentPage?.() || [];
      const placeholder = temp.map(c => ({
        title: "Generating…",
        anchorId: c.anchorId
      }));
      sendResponse({ outlines: placeholder });
      // Start async generation
      init();
      return;
    }
    sendResponse({ outlines: state.outlines });
    // "Generating..." placeholder returned to sidebar
    console.log("Content: Request Rest");
    requestRest();
  }
  
  if (msg.type === "jumpTo") { // Click sidebar title → page smoothly jumps to corresponding original text position and marks horizontal line
    const el = document.getElementById(msg.anchorId);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    
    // Insert a temporary marker line (at anchor position)
    document.querySelectorAll(".ai-flash-marker").forEach(m => m.remove()); // Clear previous lines first
    const marker = document.createElement("div");
    marker.className = "ai-flash-marker";
    el.insertAdjacentElement("afterend", marker);
    setTimeout(() => marker.remove(), 4000);
    // Next anchor horizontal line
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
  
  if (msg.type === "getActiveByScroll") { // Highlight = mark "current section" in sidebar directory with style
   // Find anchor closest to top of viewport
    const vis = state.outlines.map(o => {
      const el = document.getElementById(o.anchorId);
      if (!el) return { id: o.anchorId, top: Infinity };
      const rect = el.getBoundingClientRect();
      return { id: o.anchorId, top: Math.abs(rect.top) };
    });
    vis.sort((a,b)=>a.top-b.top);
    sendResponse({ anchorId: vis[0]?.id });
  }

  // Regenerate title list
  if (msg.type === "reInit") {
    console.log("Content: reInit triggered from sidebar");
    init();  
    sendResponse({ ok: true });
  }

 // Add new title
  if (msg.type === "checkUpdate") {
    console.log("content: checkUpdate triggered from sidebar");
    rebuildIncremental();
    sendResponse({ ok: true });
  }

  // Provide chunk text to sidebar
  if (msg.type === "getChunkText") {
  const chunk = state.chunks.find(c => c.anchorId === msg.anchorId);
  sendResponse({ text: chunk?.text || "" });
}
});


// Add new title function
async function rebuildIncremental() {
  console.log("content: incremental rebuild start");

  const newChunks = window.segmentPage();  // Re-get page segments
  const oldLen = state.chunks.length;
  const newLen = newChunks.length;

  // Identify chunk count to determine if new titles are needed
  if (newLen <= oldLen) {
    console.log("No new chunks detected, directory is up to date.");
    return;
  }

  // Find newly added parts
  const added = newChunks.slice(oldLen);
  console.log(`Detected ${added.length} new chunks`);

  // Append to state.chunks
  state.chunks.push(...added);

  // Prepare placeholder titles for newly added parts
  const start = oldLen;
  const end = newLen;
  for (let i = start; i < end; i++) {
    state.outlines[i] = { title: "Generating…", anchorId: newChunks[i].anchorId };
  }

  // Call AI to generate titles only for newly added parts
  await requestAI(start, end);

  // Notify sidebar update
  chrome.runtime.sendMessage({ type: "aiOutlineUpdated", start, end });
  console.log("content: incremental rebuild complete");
}


// Initial startup, start generating titles when chunk count is not 0, wait up to 30 seconds
/*
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

    // Retry every 2 seconds
    await new Promise(r => setTimeout(r, 2000));
    tries ++;
  }
})();*/

// Wait for sidebar to open and notify before starting
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "manualInit") {
    console.log("content: manualInit received → start init()");
    init();
  }
});


// When page URL changes (e.g. switch to new Chat), automatically re-init()
let lastUrl = location.href;
let sidebarActive = false; // ✅ Flag whether sidebar is open

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "manualInit") {
    sidebarActive = true;
    console.log("content: manualInit received → start init()");
    init();
  }
  if (msg.type === "sidebarClosed") {
    sidebarActive = false;
    console.log("content: sidebar closed → pause auto reInit");
  }
});

// ✅ Only detect URL changes when sidebar is in open state
setInterval(() => {
  if (!sidebarActive) return;
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log("Detected URL change → reInit()");
    init();
  }
}, 1000);

