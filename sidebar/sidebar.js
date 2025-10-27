const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");
const summaryCache = {}; // Cache overview for each chunk
const summaryState = {}; // Record overview expansion state
const summaryGenerated = {}; // ✅ Record which summaries have been generated


// Initialize AI prompt style
const loadingDiv = document.createElement("div");
loadingDiv.id = "loadingHint";
loadingDiv.textContent = "";
loadingDiv.style.cssText = `
  padding: 10px;
  color: gray;
  text-align: center;
`;
document.body.prepend(loadingDiv);

// Cache and current tab
const outlineCache = {};   // { [tabId: number]: { outlines: Array } }
let currentTabId = null;   // Current tab ID that sidebar is displaying
const editedTitles = {};  // { tabId: { anchorId: "new title" } }


// Load directory by tab (cache first, then request)
async function loadOutlineForTab(tabId) {
  currentTabId = tabId;
  console.log("sidebar: switch to tab", tabId);

  // 1) Hit cache → render directly
  if (outlineCache[tabId]) {
    console.log("sidebar: using cached outline");
    render(outlineCache[tabId].outlines);
    return;
  }

  // 2) Miss cache → request content
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "getOutline" });
    outlineCache[tabId] = {
      outlines: res.outlines,
      pinnedSet: new Set()
    };           // 写入缓存
    render(res.outlines);
  } catch (err) {
    console.warn("sidebar: getOutline failed (no content script yet?)", err);
    // ✅ Improvement: show clickable "reload website" prompt
    ul.innerHTML = `
    <li class="item">
      <div class="header-row">
        <div class="t" style="text-align:center;">Reload Website to load TOCwise</div>
        <button id="reloadPageBtn" class="reload-btn" style="margin-left:10px;">
          <img src="../icons/reload.svg" alt="refresh" width="16" height="16" />
        </button>
      </div>
    </li>
  `;

    // ✅ Button click: reload current tab
    const btn = document.getElementById("reloadPageBtn");
    if (btn) {
      btn.onclick = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.reload(tab.id); // Automatically refresh the webpage
      };
    }
  }
}

//Get current tab
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

//Get AI generated directory
async function fetchOutline() {
  const tabId = await getActiveTabId();
  // Sidebar → current page content script
  return chrome.tabs.sendMessage(tabId, { type: "getOutline" });
}

//=== Search functionality ===
const searchInput = document.getElementById("tocSearch");
const clearBtn = document.getElementById("clearSearch");

searchInput.oninput = (e) => {
  const raw = e.target.value;
  const keyword = raw.trim().toLowerCase(); // Remove leading/trailing spaces
  if (keyword === "") {
    // Empty or spaces: restore all items and clear highlights
    [...ul.children].forEach(li => {
      li.style.display = "flex";
      const tDiv = li.querySelector(".t");
      tDiv.innerHTML = tDiv.textContent; // Remove mark
    });
    return;
  }

  [...ul.children].forEach(li => {
    const text = li.querySelector(".t").textContent.toLowerCase();
    const tDiv = li.querySelector(".t");
    if (text.includes(keyword)) {
      li.style.display = "flex";
      // Highlight matching text
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escape regex
      tDiv.innerHTML = text.replace(
        new RegExp(escaped, "gi"),
        match => `<mark>${match}</mark>`
      );
    } 
  });
};

// Click clear button
clearBtn.onclick = () => {
  searchInput.value = "";
  [...ul.children].forEach(li => {
    li.style.display = "flex";
    const tDiv = li.querySelector(".t");
    tDiv.innerHTML = tDiv.textContent;
  });
};


// Render directory
function render(outlines) {
  console.log("sidebar: render");
  ul.innerHTML = "";

  // Get pinnedSet from cache for current tab
  const pinnedSet = outlineCache[currentTabId]?.pinnedSet || new Set();

  // Render each title as a <li>
  for (const o of outlines) {
    const li = document.createElement("li");
    const isPinned = pinnedSet.has(o.anchorId);

    // Style and data
    li.className = `item${isPinned ? " pinned" : ""}`;
    li.dataset.anchor = o.anchorId;

    // Internal structure: title + star
    // Internal structure: one header-row (star + title + expand) + one summary
    li.innerHTML = `
    <div class="header-row">
      <img class="star" 
          src="../icons/${isPinned ? "bookmark_pinned.svg" : "bookmark.svg"}" 
          width="16" height="16" />
      <div class="t">${(editedTitles[currentTabId]?.[o.anchorId]) || o.title}</div>
      <button class="edit">
        <img src="../icons/edit.svg" alt="edit" width="16" height="16" />
      </button>
      <button class="expand">
        <img src="../icons/${summaryCache[o.anchorId] ? "expand_a" : "expand"}.svg"
         alt="expand" width="16" height="16" />
      </button>
    </div>
    <div class="summary"></div>
    `;



    // Star click event (does not trigger jump)
    li.querySelector(".star").onclick = (e) => {
      e.stopPropagation(); // Prevent triggering jump
      const newState = !li.classList.contains("pinned");
      li.classList.toggle("pinned", newState);
      e.target.src = `../icons/${newState ? "bookmark_pinned.svg" : "bookmark.svg"}`;


      // Update pinnedSet in cache
      const set = outlineCache[currentTabId].pinnedSet;
      if (newState) set.add(o.anchorId);
      else set.delete(o.anchorId);
    };

    // Click directory title → page jump
    const idx = outlines.indexOf(o);
    const next = outlines[idx + 1];
    // Click entire row (except star) to jump
    li.onclick = async (e) => {
      if (e.target.classList.contains("star")) return; // Clicking star does not jump
      const tabId = await getActiveTabId();
      await chrome.tabs.sendMessage(tabId, {
        type: "jumpTo",
        anchorId: o.anchorId,
        nextAnchorId: next ? next.anchorId : null
      });
    };


    ul.appendChild(li);

    // === Edit button logic ===
    const editBtn = li.querySelector(".edit");
    editBtn.onclick = (ev) => {
      ev.stopPropagation();
      const tDiv = li.querySelector(".t");

      // If already in edit mode
      if (tDiv.isContentEditable) {
        tDiv.contentEditable = "false";
        tDiv.classList.remove("editing");
        editBtn.innerHTML = '<img src="../icons/edit.svg" alt="edit" width="16" height="16" />';
        // Save changes to cache
        const tabId = currentTabId;
        if (!editedTitles[tabId]) editedTitles[tabId] = {};
        editedTitles[tabId][o.anchorId] = tDiv.textContent.trim();

        return;
      }

      // Enter edit mode
      tDiv.contentEditable = "true";
      tDiv.classList.add("editing");
      tDiv.focus();
      editBtn.innerHTML = '<img src="../icons/save.svg" alt="save" width="16" height="16" />';

      // Press Enter to exit edit
      tDiv.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          editBtn.click();
        }
      };
    };


    //Auto restore expansion state
    if (summaryState[o.anchorId]) {
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      summaryDiv.innerHTML = summaryCache[o.anchorId] || "";
      li.classList.add("expanded"); 
      btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
    }

    // Expand/collapse logic 
    li.querySelector(".expand").onclick = async (ev) => {
      ev.stopPropagation(); // Avoid triggering jump
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      const anchorId = o.anchorId;

      // Collapse logic
      if (li.classList.contains("expanded")) {
        li.classList.remove("expanded"); // Use class control
        const nextIcon = summaryCache[anchorId] ? "expand_a" : "expand";
        btn.innerHTML = `<img src="../icons/${nextIcon}.svg" alt="expand" width="16" height="16" />`;
        summaryState[anchorId] = false;
        return;
      }

      // Expand logic
      if (summaryCache[anchorId]) {
        summaryDiv.innerHTML = summaryCache[anchorId];
        li.classList.add("expanded"); // Add class name to trigger animation
        btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
        summaryState[anchorId] = true;
        return;
      }

      // Generating summary
      summaryDiv.innerHTML = "<i>Generating summary...</i>";
      btn.disabled = true;
      btn.innerHTML = '<img src="../icons/loading.svg" class="loading-spin" width="16" height="16" />';
      const tabId = await getActiveTabId();
      const { text } = await chrome.tabs.sendMessage(tabId, {
        type: "getChunkText",
        anchorId
      });

      const bullets = await summarizeChunk(text);
      // Remove * or • symbols from beginning of each line
      const cleaned = bullets.map(b => b.replace(/^[*\s•-]+/, "").trim());
      const html = `<ul>${cleaned.map(b => `<li>${b}</li>`).join("")}</ul>`;
      summaryCache[anchorId] = html;
      summaryDiv.innerHTML = html;
      li.classList.add("expanded"); // Animate expansion
      btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
      btn.disabled = false;
      summaryState[anchorId] = true;
    };

  }

}

// Call llm.js bullet mode to generate summary
async function summarizeChunk(text) {
  try {
    const { generateBullets } = await import(chrome.runtime.getURL("ai/llm.js"));
    return await generateBullets(text);
  } catch (err) {
    console.warn("sidebar: summarizeChunk failed", err);
    return ["Summary unavailable"];
  }
}

// Auto highlight current section: find anchor closest to top of viewport, highlight corresponding title
async function tickActive() {
  const tabId = await getActiveTabId();
  const res = await chrome.tabs.sendMessage(tabId, { type: "getActiveByScroll" });
  if (!res) return;
  const { anchorId } = res;
  [...ul.children].forEach(li => {
    li.classList.toggle("active", li.dataset.anchor === anchorId);
  });
}
// Listen to AI title updates, refresh display
// Listen to API uniformly with runtime.onMessage
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "aiOutlineUpdated") {
    // Incremental update, fetch again
    console.log("sidebar: aiOutline Updated");
    const tabId = await getActiveTabId();         // Get current tab corresponding to sidebar
    const res = await fetchOutline();             // Fetch latest again
    // ✅ Only update outlines, do not overwrite pinnedSet
    if (!outlineCache[tabId]) outlineCache[tabId] = { outlines: [], pinnedSet: new Set() };
    outlineCache[tabId].outlines = res.outlines;
    render(res.outlines);

  }
  /*
  if (msg.type === "aiStatus") {
    if (msg.status === "loading" || msg.status === "downloading") {
      loadingDiv.textContent = "🚀 Initializing Gemini Nano AI...";
      loadingDiv.style.display = "block";
    } else if (msg.status === "failed") {
      loadingDiv.textContent = "⚠️ AI unavailable, using fallback titles. Open and Enable ➡️ chrome://flags/#prompt-api-for-gemini-nano 🔁 Close and Reload Chrome";
    } else if (msg.status === "ready") {
      loadingDiv.textContent = "Generating Summary...";
    } else if (msg.status === "finish") {
      loadingDiv.textContent = "Created by TOCwise";
    }
  } */
  // Only show text info above when AI is unavailable
  if (msg.type === "aiStatus" && msg.status === "failed") {
    loadingDiv.textContent = "⚠️ AI unavailable, using fallback titles. Open and Enable ➡️ chrome://flags/#prompt-api-for-gemini-nano 🔁 Close and Reload Chrome";
  }
});

// New: listen to switching to other tabs, automatically switch directory
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId !== currentTabId) {
    await loadOutlineForTab(activeInfo.tabId);
  }
});

// New: listen to navigation/refresh within same tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentTabId && changeInfo.status === "complete") {
    // URL/DOM changes → clear old cache, re-fetch
    delete outlineCache[tabId];
    await loadOutlineForTab(tabId);
  }
});

// Open sidebar
document.addEventListener("DOMContentLoaded", async () => {
  console.log("sidebar: init on open");

  const tabId = await getActiveTabId();
  // First tell content to start generating
  try {
    await chrome.tabs.sendMessage(tabId, { type: "manualInit" });
  } catch (err) {
    console.warn("sidebar: manualInit failed, content not ready", err);
  }

  // Then load outline
  await loadOutlineForTab(tabId);
  setInterval(tickActive, 600);
});


//Refresh button, regenerate title list
refreshBtn.onclick = async () => {
  console.log("sidebar: click on refresh");
  // Temporarily switch to rotation animation
  const originalHTML = refreshBtn.innerHTML;
  refreshBtn.innerHTML = `
    <img src="../icons/loading_refresh.svg" class="loading-spin"/>
  `;

  // Prevent duplicate clicks
  refreshBtn.classList.add("busy");
  refreshBtn.style.pointerEvents = "none";

  try {
    // Re-get tab id
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Send message to that tab id
    await chrome.tabs.sendMessage(tab.id, { type: "reInit" });
    // Wait for AI generation to complete and stop animation
    await new Promise((resolve) => {
      const listener = (msg) => {
        if (msg.type === "aiStatus" && msg.status === "finish") {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(); // Receive finish signal → stop rotation
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  } catch (err) {
    console.warn("sidebar: refresh failed, no receiver in this page", err);
  }
  // Restore original state
  refreshBtn.innerHTML = originalHTML;
  refreshBtn.classList.remove("busy");
  refreshBtn.style.pointerEvents = "auto";
};


// Check new additions button
const checkBtn = document.getElementById("checkUpdate");
checkBtn.onclick = async () => {
  console.log("sidebar: click on check update");

  // Temporarily switch to rotation animation
  const originalHTML = checkBtn.innerHTML;
  checkBtn.innerHTML = `
    <img src="../icons/loading_update.svg" class="loading-spin"/>
  `;
  checkBtn.classList.add("busy");
  checkBtn.style.pointerEvents = "none";

  try {
    // Current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "checkUpdate" });

    // Wait for AI completion or timeout (e.g. 6 seconds)
    await Promise.race([
      new Promise((resolve) => {
        const listener = (msg) => {
          if (msg.type === "aiStatus" && msg.status === "finish") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve("finish");
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      }),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 6000))
    ]);

  } catch (err) {
    console.warn("sidebar: check update failed", err);
  }
  // Restore original state
  checkBtn.innerHTML = originalHTML;
  checkBtn.classList.remove("busy");
  checkBtn.style.pointerEvents = "auto";
};

// dark mode dark theme
const themeBtn = document.getElementById("toggleTheme");

// Initialize theme on startup
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.classList.toggle("dark", savedTheme === "dark");
  themeBtn.querySelector("img").src = savedTheme === "dark" ? "../icons/sun.svg" : "../icons/moon.svg";
});

// Switch theme
themeBtn.onclick = () => {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  themeBtn.querySelector("img").src = isDark ? "../icons/sun.svg" : "../icons/moon.svg";
};

// When user closes sidebar, notify content to stop auto init
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    const tabId = await getActiveTabId();
    chrome.tabs.sendMessage(tabId, { type: "sidebarClosed" });
  }
});



