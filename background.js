/**
 * background.js - Service Worker 后台常驻脚本 (Manifest V3)
 * 职责：
 * 1. 注册浏览器右键上下文菜单（"添加到本地产品库"）
 * 2. 监听右键点击，向当前活跃标签页发送采集指令
 * 3. 容错处理：若 content script 未注入，自动进行动态注入
 * 4. 响应打开独立 Dashboard 管理页的消息
 */

// 插件安装或更新时注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  // 先清理可能存在的历史同名菜单，防止重复创建报错
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "collectAmazonProduct",
      title: "📥 添加到本地产品库",
      contexts: ["page", "link", "image", "selection"],
      // 限制仅在各类亚马逊域名下显示右键菜单
      documentUrlPatterns: [
        "*://*.amazon.com/*",
        "*://*.amazon.co.uk/*",
        "*://*.amazon.de/*",
        "*://*.amazon.co.jp/*",
        "*://*.amazon.fr/*",
        "*://*.amazon.it/*",
        "*://*.amazon.es/*",
        "*://*.amazon.ca/*",
        "*://*.amazon.com.au/*",
        "*://*.amazon.com.mx/*",
        "*://*.amazon.sg/*",
        "*://*.amazon.ae/*",
        "*://*.amazon.sa/*",
        "*://*.amazon.in/*",
        "*://*.amazon.nl/*",
        "*://*.amazon.se/*",
        "*://*.amazon.pl/*"
      ]
    });
    console.log("[Amazon Collector] 右键菜单注册成功");
  });
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "collectAmazonProduct" && tab && tab.id) {
    sendCollectMessageToTab(tab.id);
  }
});

// 向指定标签页发送采集信号，带自动重试与动态注入机制
async function sendCollectMessageToTab(tabId) {
  try {
    // 尝试直接发送消息
    const response = await chrome.tabs.sendMessage(tabId, { action: "TRIGGER_COLLECT" });
    console.log("[Amazon Collector] 采集指令响应:", response);
  } catch (err) {
    console.warn("[Amazon Collector] Content script 未响应，正在尝试动态注入...", err.message);
    try {
      // 针对用户刚安装扩展尚未刷新页面的情况，动态注入 content.js
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      // 注入后稍作延迟并再次发送
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, { action: "TRIGGER_COLLECT" });
        } catch (retryErr) {
          console.error("[Amazon Collector] 重试发送采集指令失败:", retryErr);
        }
      }, 150);
    } catch (injectErr) {
      console.error("[Amazon Collector] 脚本注入失败 (可能非网页或权限不足):", injectErr);
    }
  }
}

// 监听来自 Popup 或 Content 的通用消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 打开全屏产品库管理面板
  if (message.action === "OPEN_DASHBOARD") {
    const dashboardUrl = chrome.runtime.getURL("dashboard.html");
    // 查找是否已打开 Dashboard 标签页，如有则激活，无则新建
    chrome.tabs.query({ url: dashboardUrl }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
    });
    sendResponse({ status: "ok" });
  }
  return true; // 保持异步通道开启
});
