// Service Worker ——
// 运行在后台、不直接操作网页，
// 用于监听事件、管理扩展状态、与内容脚本通信。

// 扩展安装事件
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details);
});

// 消息监听, 监听来自内容脚本或侧边栏的消息
// 在 content script → background → Gemini Nano 之间传数据
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  
  // 处理消息逻辑
  switch (request.action) {
    default:
      console.log('Unknown action:', request.action);
  }
});

// 侧边栏点击事件
chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  });
  