const ul = document.getElementById("list");
const refreshBtn = document.getElementById("refresh");

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
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "aiOutlineUpdated") {
    // 增量更新，重新取一次
    console.log("sidebar: aiOutline Updated");
    fetchOutline().then(res => render(res.outlines));
  }
});

//页面初始化
document.addEventListener("DOMContentLoaded", async () => {
  //获取目录
  console.log("sidebar: init outline");
  const res = await fetchOutline();
  //渲染目录
  render(res.outlines);
  // 每600ms自动高亮当前章节
  setInterval(tickActive, 600);
});

//手动刷新按钮
refreshBtn.onclick = async () => {
  // 触发内容脚本继续拉余量
  console.log("sidebar: click on refresh");
  const res = await fetchOutline();
  render(res.outlines);
};
