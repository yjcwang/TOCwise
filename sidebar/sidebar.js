const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");
const summaryCache = {}; // 缓存每个chunk的概览
const summaryState = {}; // 记录概览展开状态


// 初始化AI提示样式
const loadingDiv = document.createElement("div");
loadingDiv.id = "loadingHint";
loadingDiv.textContent = "";
loadingDiv.style.cssText = `
  padding: 10px;
  color: gray;
  text-align: center;
`;
document.body.prepend(loadingDiv);

// 缓存与当前tab
const outlineCache = {};   // { [tabId: number]: { outlines: Array } }
let currentTabId = null;   // 当前侧栏正在展示的 tabId

// 按 tab 加载目录（先缓存、再请求）
async function loadOutlineForTab(tabId) {
  currentTabId = tabId;
  console.log("sidebar: switch to tab", tabId);

  // 1) 命中缓存 → 直接渲染
  if (outlineCache[tabId]) {
    console.log("sidebar: using cached outline");
    render(outlineCache[tabId].outlines);
    return;
  }

  // 2) 未命中 → 请求 content
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "getOutline" });
    outlineCache[tabId] = {
      outlines: res.outlines,
      pinnedSet: new Set()
    };           // 写入缓存
    render(res.outlines);
  } catch (err) {
    console.warn("sidebar: getOutline failed (no content script yet?)", err);
    // ✅ 改进：显示可点击的“刷新网页”提示
    ul.innerHTML = `
    <li class="item" style="text-align:center; padding:10px;">
      <div>Reload Website to load TOCwise</div>
      <button id="reloadPageBtn" class="reload-btn">
        <img src="../icons/reload.svg" alt="refresh" width="18" height="18" style="vertical-align:middle;">
      </button>
    </li>
  `;
    // ✅ 按钮点击：刷新当前标签页
    const btn = document.getElementById("reloadPageBtn");
    if (btn) {
      btn.onclick = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.reload(tab.id); // 自动刷新网页
      };
    }
  }
}

//获取当前标签页
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

//获取ai生成的目录
async function fetchOutline() {
  const tabId = await getActiveTabId();
  // 侧栏 → 当前页面的 content script
  return chrome.tabs.sendMessage(tabId, { type: "getOutline" });
}

// 渲染目录
function render(outlines) {
  console.log("sidebar: render");
  ul.innerHTML = "";

  // 从缓存中取出当前 tab 的 pinnedSet
  const pinnedSet = outlineCache[currentTabId]?.pinnedSet || new Set();

  // 把每个标题渲染成一个 <li>
  for (const o of outlines) {
    const li = document.createElement("li");
    const isPinned = pinnedSet.has(o.anchorId);

    // 样式和数据
    li.className = `item${isPinned ? " pinned" : ""}`;
    li.dataset.anchor = o.anchorId;

    // 内部结构：标题 + 星标
    li.innerHTML = `
  <div class="t">${o.title}</div>
  <div class="icons">
    <img class="star" src="../icons/${isPinned ? "bookmark_pinned.svg" : "bookmark.svg"}" width="18" height="18" />
    <button class="expand">▼</button>
  </div>
  <div class="summary" style="display:none;"></div>
`;


    // 星标点击事件（不触发跳转）
    li.querySelector(".star").onclick = (e) => {
      e.stopPropagation(); // 防止触发跳转
      const newState = !li.classList.contains("pinned");
      li.classList.toggle("pinned", newState);
      e.target.src = `../icons/${newState ? "bookmark_pinned.svg" : "bookmark.svg"}`;


      // 更新缓存中的 pinnedSet
      const set = outlineCache[currentTabId].pinnedSet;
      if (newState) set.add(o.anchorId);
      else set.delete(o.anchorId);
    };

    // 点击目录标题 → 页面跳转
    const idx = outlines.indexOf(o);
    const next = outlines[idx + 1];
    // 点击整行（除了星标）都跳转
    li.onclick = async (e) => {
      if (e.target.classList.contains("star")) return; // ✅ 点击星标不跳转
      const tabId = await getActiveTabId();
      await chrome.tabs.sendMessage(tabId, {
        type: "jumpTo",
        anchorId: o.anchorId,
        nextAnchorId: next ? next.anchorId : null
      });
    };


    ul.appendChild(li);

    //自动恢复展开状态
    if (summaryState[o.anchorId]) {
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      summaryDiv.innerHTML = summaryCache[o.anchorId] || "";
      summaryDiv.style.display = "block";
      btn.textContent = "▲";
    }

    // 展开/折叠逻辑 
    li.querySelector(".expand").onclick = async (ev) => {
      ev.stopPropagation(); // 避免触发跳转
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      const anchorId = o.anchorId;
      
      //折叠
      if (summaryDiv.style.display === "block") {
        summaryDiv.style.display = "none";
        btn.textContent = "▼";
        summaryState[anchorId] = false;
        return;
      }
      //展开
      if (summaryCache[anchorId]) {
        summaryDiv.innerHTML = summaryCache[anchorId];
        summaryDiv.style.display = "block";
        btn.textContent = "▲";
        summaryState[anchorId] = true;
        return;
      }

      // 请求AI生成摘要
      summaryDiv.innerHTML = "<i>Generating summary...</i>";
      btn.disabled = true;
      const tabId = await getActiveTabId();
      //从 content.js 获取原文 chunk 文本
      const { text } = await chrome.tabs.sendMessage(tabId, {
        type: "getChunkText",
        anchorId
      });
      const bullets = await summarizeChunk(text);
      const html = `<ul>${bullets.map(b => `<li>${b}</li>`).join("")}</ul>`;
      summaryCache[anchorId] = html;
      summaryDiv.innerHTML = html;
      summaryDiv.style.display = "block";
      btn.textContent = "▲";
      btn.disabled = false;
      summaryState[anchorId] = true;
    };
  }

}

// 调用 llm.js 的 bullet 模式生成摘要
async function summarizeChunk(text) {
  try {
    const { generateBullets } = await import(chrome.runtime.getURL("ai/llm.js"));
    return await generateBullets(text);
  } catch (err) {
    console.warn("sidebar: summarizeChunk failed", err);
    return ["Summary unavailable"];
  }
}

//自动高亮当前章节：寻找最接近视窗顶部锚点，高亮对应标题
async function tickActive() {
  const tabId = await getActiveTabId();
  const res = await chrome.tabs.sendMessage(tabId, { type: "getActiveByScroll" });
  if (!res) return;
  const { anchorId } = res;
  [...ul.children].forEach(li => {
    li.classList.toggle("active", li.dataset.anchor === anchorId);
  });
}
// 监听ai标题更新，刷新显示
// 监听 API 统一是 runtime.onMessage
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "aiOutlineUpdated") {
    // 增量更新，重新取一次
    console.log("sidebar: aiOutline Updated");
    const tabId = await getActiveTabId();         // 拿到当前侧栏对应的 tab
    const res = await fetchOutline();             // 重新取最新
    // ✅ 只更新 outlines，不覆盖 pinnedSet
    if (!outlineCache[tabId]) outlineCache[tabId] = { outlines: [], pinnedSet: new Set() };
    outlineCache[tabId].outlines = res.outlines;
    render(res.outlines);

  }
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
  }
});

// ✅ 新增：监听切换到其它 tab 时，自动切换目录
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId !== currentTabId) {
    await loadOutlineForTab(activeInfo.tabId);
  }
});

// ✅ 新增：监听同 tab 内的导航/刷新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentTabId && changeInfo.status === "complete") {
    // URL/DOM 变化 → 清掉旧缓存，重新拉取
    delete outlineCache[tabId];
    await loadOutlineForTab(tabId);
  }
});

//页面初始化
document.addEventListener("DOMContentLoaded", async () => {
  //获取目录
  console.log("sidebar: init outline");
  const tabId = await getActiveTabId();
  await loadOutlineForTab(tabId);   
  // 每600ms自动高亮当前章节
  setInterval(tickActive, 600);
});

//刷新按钮，重新生成标题列表
refreshBtn.onclick = async () => {
  console.log("sidebar: click on refresh");
  try {
    // 重新获取tab id
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // 向该tab id发送信息
    await chrome.tabs.sendMessage(tab.id, { type: "reInit" });
  } catch (err) {
    console.warn("sidebar: refresh failed, no receiver in this page", err);
  }
};


// 检查新增 按钮绑定
const checkBtn = document.getElementById("checkUpdate");
checkBtn.onclick = async () => {
  console.log("sidebar: click on check update");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "checkUpdate" });
  } catch (err) {
    console.warn("sidebar: check update failed", err);
  }
};

// dark mode 暗色模式
const themeBtn = document.getElementById("toggleTheme");

// 初始化时读取主题
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.classList.toggle("dark", savedTheme === "dark");
  themeBtn.querySelector("img").src = savedTheme === "dark" ? "../icons/sun.svg" : "../icons/moon.svg";
});

// 切换主题
themeBtn.onclick = () => {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  themeBtn.querySelector("img").src = isDark ? "../icons/sun.svg" : "../icons/moon.svg";
};




