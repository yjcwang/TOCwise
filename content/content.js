// Content script for TOC Gemini Nano AI Chrome Extension

console.log('Content script loaded');

// 初始化
function init() {
  console.log('Initializing content script');
}

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  switch (request.action) {
    default:
      console.log('Unknown action:', request.action);
  }
});

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}