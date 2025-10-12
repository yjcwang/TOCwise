// Background script for TOC Gemini Nano AI Chrome Extension

// 扩展安装事件
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details);
});

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  
  // 处理消息逻辑
  switch (request.action) {
    default:
      console.log('Unknown action:', request.action);
  }
});