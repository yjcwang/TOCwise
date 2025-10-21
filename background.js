// Service Worker ——
// 运行在后台、不直接操作网页，
// 用于监听事件、管理扩展状态、与内容脚本通信。


// 扩展安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  // 设置点击扩展图标时自动打开侧边栏
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// 处理扩展图标点击事件
chrome.action.onClicked.addListener(async (tab) => {
  // 在指定标签页打开侧边栏
  await chrome.sidePanel.open({ tabId: tab.id });
});

