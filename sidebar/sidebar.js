const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");
const summaryCache = {}; // 缓存每个chunk的概览
const summaryState = {}; // 记录概览展开状态
const summaryGenerated = {}; // ✅ 记录哪些 summary 已生成


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
const editedTitles = {};  // { tabId: { anchorId: "new title" } }


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
    <li class="item">
      <div class="header-row">
        <div class="t" style="text-align:center;">Reload Website to load TOCwise</div>
        <button id="reloadPageBtn" class="reload-btn" style="margin-left:10px;">
          <img src="../icons/reload.svg" alt="refresh" width="16" height="16" />
        </button>
      </div>
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

//=== 搜索功能 ===
const searchInput = document.getElementById("tocSearch");
const clearBtn = document.getElementById("clearSearch");

searchInput.oninput = (e) => {
  const raw = e.target.value;
  const keyword = raw.trim().toLowerCase(); // ✅ 去掉首尾空格
  if (keyword === "") {
    // ✅ 空或空格：恢复所有 item 并清除高亮
    [...ul.children].forEach(li => {
      li.style.display = "flex";
      const tDiv = li.querySelector(".t");
      tDiv.innerHTML = tDiv.textContent; // 去掉 mark
    });
    return;
  }

  [...ul.children].forEach(li => {
    const text = li.querySelector(".t").textContent.toLowerCase();
    const tDiv = li.querySelector(".t");
    if (text.includes(keyword)) {
      li.style.display = "flex";
      // ✅ 高亮匹配文字
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // 转义正则
      tDiv.innerHTML = text.replace(
        new RegExp(escaped, "gi"),
        match => `<mark>${match}</mark>`
      );
    } 
  });
};

// ✅ 点击清空按钮
clearBtn.onclick = () => {
  searchInput.value = "";
  [...ul.children].forEach(li => {
    li.style.display = "flex";
    const tDiv = li.querySelector(".t");
    tDiv.innerHTML = tDiv.textContent;
  });
};


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
    // 内部结构：一行 header-row（star + 标题 + expand） + 一行 summary
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

    // === 编辑按钮逻辑 ===
    const editBtn = li.querySelector(".edit");
    editBtn.onclick = (ev) => {
      ev.stopPropagation();
      const tDiv = li.querySelector(".t");

      // 如果已在编辑模式
      if (tDiv.isContentEditable) {
        tDiv.contentEditable = "false";
        tDiv.classList.remove("editing");
        editBtn.innerHTML = '<img src="../icons/edit.svg" alt="edit" width="16" height="16" />';
        // ✅ 保存修改到缓存
        const tabId = currentTabId;
        if (!editedTitles[tabId]) editedTitles[tabId] = {};
        editedTitles[tabId][o.anchorId] = tDiv.textContent.trim();

        return;
      }

      // 进入编辑模式
      tDiv.contentEditable = "true";
      tDiv.classList.add("editing");
      tDiv.focus();
      editBtn.innerHTML = '<img src="../icons/save.svg" alt="save" width="16" height="16" />';

      // 按 Enter 退出编辑
      tDiv.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          editBtn.click();
        }
      };
    };


    //自动恢复展开状态
    if (summaryState[o.anchorId]) {
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      summaryDiv.innerHTML = summaryCache[o.anchorId] || "";
      li.classList.add("expanded"); 
      btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
    }

    // 展开/折叠逻辑 
    li.querySelector(".expand").onclick = async (ev) => {
      ev.stopPropagation(); // 避免触发跳转
      const btn = li.querySelector(".expand");
      const summaryDiv = li.querySelector(".summary");
      const anchorId = o.anchorId;

      // 折叠逻辑
      if (li.classList.contains("expanded")) {
        li.classList.remove("expanded"); // ✅ 用类控制
        const nextIcon = summaryCache[anchorId] ? "expand_a" : "expand";
        btn.innerHTML = `<img src="../icons/${nextIcon}.svg" alt="expand" width="16" height="16" />`;
        summaryState[anchorId] = false;
        return;
      }

      // 展开逻辑
      if (summaryCache[anchorId]) {
        summaryDiv.innerHTML = summaryCache[anchorId];
        li.classList.add("expanded"); // ✅ 加类名触发动画
        btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
        summaryState[anchorId] = true;
        return;
      }

      // 生成摘要中
      summaryDiv.innerHTML = "<i>Generating summary...</i>";
      btn.disabled = true;
      btn.innerHTML = '<img src="../icons/loading.svg" class="loading-spin" width="16" height="16" />';
      const tabId = await getActiveTabId();
      const { text } = await chrome.tabs.sendMessage(tabId, {
        type: "getChunkText",
        anchorId
      });

      const bullets = await summarizeChunk(text);
      // 去掉每行前面的 * 或 • 等符号
      const cleaned = bullets.map(b => b.replace(/^[*\s•-]+/, "").trim());
      const html = `<ul>${cleaned.map(b => `<li>${b}</li>`).join("")}</ul>`;
      summaryCache[anchorId] = html;
      summaryDiv.innerHTML = html;
      li.classList.add("expanded"); // ✅ 动画展开
      btn.innerHTML = '<img src="../icons/collapse.svg" alt="collapse" width="16" height="16" />';
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
  // 只有当ai不可用才在上方显示文字信息
  if (msg.type === "aiStatus" && msg.status === "failed") {
    loadingDiv.textContent = "⚠️ AI unavailable, using fallback titles. Open and Enable ➡️ chrome://flags/#prompt-api-for-gemini-nano 🔁 Close and Reload Chrome";
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

// 打开侧边栏
document.addEventListener("DOMContentLoaded", async () => {
  console.log("sidebar: init on open");

  const tabId = await getActiveTabId();
  // ✅ 先告诉 content 开始生成
  try {
    await chrome.tabs.sendMessage(tabId, { type: "manualInit" });
  } catch (err) {
    console.warn("sidebar: manualInit failed, content not ready", err);
  }

  // 然后加载 outline
  await loadOutlineForTab(tabId);
  setInterval(tickActive, 600);
});


//刷新按钮，重新生成标题列表
refreshBtn.onclick = async () => {
  console.log("sidebar: click on refresh");
  // ✅ 临时切换为旋转动画
  const originalHTML = refreshBtn.innerHTML;
  refreshBtn.innerHTML = `
    <img src="../icons/loading_refresh.svg" class="loading-spin"/>
  `;

  // ✅ 禁止重复点击
  refreshBtn.classList.add("busy");
  refreshBtn.style.pointerEvents = "none";

  try {
    // 重新获取tab id
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // 向该tab id发送信息
    await chrome.tabs.sendMessage(tab.id, { type: "reInit" });
    // ✅ 等待 AI 生成完毕停止动画
    await new Promise((resolve) => {
      const listener = (msg) => {
        if (msg.type === "aiStatus" && msg.status === "finish") {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(); // ✅ 收到 finish 信号 → 停止旋转
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  } catch (err) {
    console.warn("sidebar: refresh failed, no receiver in this page", err);
  }
  // ✅ 恢复原状态
  refreshBtn.innerHTML = originalHTML;
  refreshBtn.classList.remove("busy");
  refreshBtn.style.pointerEvents = "auto";
};


// 检查新增按钮
const checkBtn = document.getElementById("checkUpdate");
checkBtn.onclick = async () => {
  console.log("sidebar: click on check update");

  // ✅ 临时切换为旋转动画
  const originalHTML = checkBtn.innerHTML;
  checkBtn.innerHTML = `
    <img src="../icons/loading_update.svg" class="loading-spin"/>
  `;
  checkBtn.classList.add("busy");
  checkBtn.style.pointerEvents = "none";

  try {
    // 当前激活标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "checkUpdate" });

    // ✅ 等待 AI 完成 或 超时（例如 6 秒）
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
  // ✅ 恢复原状态
  checkBtn.innerHTML = originalHTML;
  checkBtn.classList.remove("busy");
  checkBtn.style.pointerEvents = "auto";
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

// ✅ 当用户关闭侧栏时，通知 content 停止自动 init
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    const tabId = await getActiveTabId();
    chrome.tabs.sendMessage(tabId, { type: "sidebarClosed" });
  }
});



