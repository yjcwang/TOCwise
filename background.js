// Service Worker ——
// Runs in background, does not directly operate web pages,
// Used for listening to events, managing extension state, and communicating with content scripts.


// Initialize extension on installation
chrome.runtime.onInstalled.addListener(() => {
  // Set to automatically open sidebar when extension icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle extension icon click events
chrome.action.onClicked.addListener(async (tab) => {
  // Open sidebar in specified tab
  await chrome.sidePanel.open({ tabId: tab.id });
});

