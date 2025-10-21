const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");

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
    outlineCache[tabId] = res;           // 写入缓存
    render(res.outlines);
  } catch (err) {
    console.warn("sidebar: getOutline failed (no content script yet?)", err);
    ul.innerHTML = "<li class='item'>（Content not loaded, try refresh website）</li>";
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

//渲染目录
function render(outlines) {
  console.log("sidebar: render");
  ul.innerHTML = "";
  // 把每个标题渲染成一个 <li>
  for (const o of outlines) {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.anchor = o.anchorId;
    li.innerHTML = `<div class="t">${o.title}</div>`;
    //点击目录标题，跳转至页面, 在content里横线标注起始和结束的段落
    // 所以需要发送当前o.anchorId和nextAnchorId
    const idx = outlines.indexOf(o);
    const next = outlines[idx + 1]; // 也发送下一个chunk的anchor，可能 undefined
    li.onclick = async () => {
      const tabId = await getActiveTabId();
      await chrome.tabs.sendMessage(tabId, { type: "jumpTo", anchorId: o.anchorId, nextAnchorId: next ? next.anchorId : null });
    };
    ul.appendChild(li);
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
    outlineCache[tabId] = res;                    // ✅ 写入缓存
    render(res.outlines);
  }
  if (msg.type === "aiStatus") {
    if (msg.status === "loading" || msg.status === "downloading") {
      loadingDiv.textContent = "🚀 Initializing Gemini Nano AI...";
      loadingDiv.style.display = "block";
    } else if (msg.status === "failed") {
      loadingDiv.textContent = "⚠️ AI unavailable, using fallback titles.";
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



