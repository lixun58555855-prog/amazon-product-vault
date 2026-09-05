/**
 * background.js - Service Worker 后台常驻脚本 (Manifest V3)
 * 职责：
 * 1. 注册浏览器右键上下文菜单（"添加到本地产品库"）
 * 2. 监听右键点击，向当前活跃标签页发送采集指令
 * 3. 容错处理：若 content script 未注入，自动进行动态注入
 * 4. 响应打开独立 Dashboard 管理页的消息
 * 5. 核心：采集后全自动静默将数据提交至 GitHub 云端 (带互斥排队机制)
 */

// 自动同步状态互斥锁与排队标记
let isSyncing = false;
let pendingSync = false;

// 插件安装或更新时注册右键菜单与加载预设配置
chrome.runtime.onInstalled.addListener(async () => {
  // 1. 初始化右键菜单
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "collectAmazonProduct",
      title: "📥 添加到本地产品库",
      contexts: ["page", "link", "image", "selection"],
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

  // 2. 尝试读取本地专属配置文件 config.local.json 自动初始化 GitHub 设置
  try {
    const configUrl = chrome.runtime.getURL("config.local.json");
    const res = await fetch(configUrl);
    if (res.ok) {
      const localCfg = await res.json();
      chrome.storage.local.get(["az_github_config"], (stored) => {
        if (!stored.az_github_config || !stored.az_github_config.token) {
          chrome.storage.local.set({ az_github_config: localCfg }, () => {
            console.log("[Amazon Collector] 已自动加载本地 GitHub 专属同步凭证");
          });
        }
      });
    }
  } catch (e) {
    console.log("[Amazon Collector] 未找到本地专属配置文件，将使用常规配置");
  }
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
    const response = await chrome.tabs.sendMessage(tabId, { action: "TRIGGER_COLLECT" });
    console.log("[Amazon Collector] 采集指令响应:", response);
  } catch (err) {
    console.warn("[Amazon Collector] Content script 未响应，正在尝试动态注入...", err.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, { action: "TRIGGER_COLLECT" });
        } catch (retryErr) {
          console.error("[Amazon Collector] 重试发送采集指令失败:", retryErr);
        }
      }, 150);
    } catch (injectErr) {
      console.error("[Amazon Collector] 脚本注入失败:", injectErr);
    }
  }
}

// 监听来自 Popup 或 Content 的通用消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 打开全屏产品库管理面板
  if (message.action === "OPEN_DASHBOARD") {
    const dashboardUrl = chrome.runtime.getURL("dashboard.html");
    chrome.tabs.query({ url: dashboardUrl }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
    });
    sendResponse({ status: "ok" });
  }

  // 触发后台静默自动同步至 GitHub
  if (message.action === "TRIGGER_AUTO_SYNC") {
    const tabId = sender.tab ? sender.tab.id : null;
    triggerAutoSync(tabId);
    sendResponse({ status: "sync_queued" });
  }

  return true;
});

/**
 * 触发后台自动同步至 GitHub (带排队队列)
 */
async function triggerAutoSync(sourceTabId) {
  if (isSyncing) {
    pendingSync = true;
    console.log("[AutoSync] 当前正在同步中，已排队等待下一次提交");
    return;
  }

  isSyncing = true;
  updateBadgeState("SYNC", "#f59e0b"); // 橙色提示同步中

  try {
    const result = await executeGitHubSync();
    if (result.success) {
      console.log(`[AutoSync] 成功自动同步 ${result.count} 件商品至 GitHub 云端`);
      updateBadgeState("✓", "#10b981", 3500); // 绿色打勾

      // 通知前端网页更新 Toast 状态
      if (sourceTabId) {
        chrome.tabs.sendMessage(sourceTabId, {
          action: "AUTO_SYNC_STATUS",
          success: true,
          count: result.count
        }).catch(() => {});
      }
    } else {
      console.warn("[AutoSync] 自动同步跳过或未完成:", result.reason);
      updateBadgeState("", "");
      if (sourceTabId && result.isError) {
        chrome.tabs.sendMessage(sourceTabId, {
          action: "AUTO_SYNC_STATUS",
          success: false,
          error: result.reason
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[AutoSync] 执行发生异常:", err);
    updateBadgeState("ERR", "#ef4444", 3000);
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      setTimeout(() => triggerAutoSync(sourceTabId), 600);
    }
  }
}

/**
 * 执行 GitHub API 提交
 */
function executeGitHubSync() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["amazon_products", "az_github_config"], async (storage) => {
      const config = storage.az_github_config;
      const products = storage.amazon_products || [];

      // 检查是否开启了自动同步（默认开启）
      if (!config || config.autoSync === false) {
        return resolve({ success: false, reason: "用户未开启自动同步或未配置" });
      }

      const { owner, repo, branch = "main", token } = config;
      if (!owner || !repo || !token) {
        return resolve({ success: false, reason: "GitHub 凭证不完整" });
      }

      try {
        const filePath = "data/products.json";
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

        // 1. 获取现有文件的 sha
        let existingSha = null;
        try {
          const checkRes = await fetch(`${apiUrl}?ref=${branch}`, {
            headers: {
              "Accept": "application/vnd.github.v3+json",
              "Authorization": `token ${token}`
            }
          });
          if (checkRes.ok) {
            const fileInfo = await checkRes.json();
            existingSha = fileInfo.sha;
          }
        } catch (e) {
          console.warn("[AutoSync] 检查旧文件失败，尝试直接创建:", e);
        }

        // 2. 构造 UTF-8 Base64 数据
        const jsonString = JSON.stringify(products, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

        const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
        const payload = {
          message: `Auto-sync Amazon Products (${products.length} items) - ${nowStr}`,
          content: base64Content,
          branch: branch
        };
        if (existingSha) {
          payload.sha = existingSha;
        }

        // 3. 提交至 GitHub
        const putRes = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (putRes.ok) {
          resolve({ success: true, count: products.length });
        } else {
          const errData = await putRes.json();
          resolve({ success: false, isError: true, reason: errData.message });
        }
      } catch (reqErr) {
        resolve({ success: false, isError: true, reason: reqErr.message });
      }
    });
  });
}

/**
 * 辅助：更新扩展工具栏图标角标文字与颜色
 */
function updateBadgeState(text, color, durationMs = 0) {
  try {
    chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });

    if (durationMs > 0) {
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "" });
      }, durationMs);
    }
  } catch (e) {}
}
