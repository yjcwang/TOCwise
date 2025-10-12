const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

async function fetchOutline() {
  const tabId = await getActiveTabId();
  return chrome.tabs.sendMessage(tabId, { type: "getOutline" });
}

function render(outlines) {
  ul.innerHTML = "";
  for (const o of outlines) {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.anchor = o.anchorId;
    li.innerHTML = `<div class="t">${o.title}</div><div class="s">${o.summary || ""}</div>`;
    li.onclick = async () => {
      const tabId = await getActiveTabId();
      await chrome.tabs.sendMessage(tabId, { type: "jumpTo", anchorId: o.anchorId });
    };
    ul.appendChild(li);
  }
}

async function tickActive() {
  const tabId = await getActiveTabId();
  const res = await chrome.tabs.sendMessage(tabId, { type: "getActiveByScroll" });
  if (!res) return;
  const { anchorId } = res;
  [...ul.children].forEach(li => {
    li.classList.toggle("active", li.dataset.anchor === anchorId);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "aiOutlineUpdated") {
    // 增量更新：重新取一次
    fetchOutline().then(res => render(res.outlines));
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetchOutline();
  render(res.outlines);
  // 定期同步滚动高亮（也可以换成 onscroll 事件轮询）
  setInterval(tickActive, 600);
});

refreshBtn.onclick = async () => {
  // 触发内容脚本继续拉余量
  await fetchOutline(); // 会顺手 requestRest
};
