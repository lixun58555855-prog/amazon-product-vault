/**
 * background.js - Service Worker 后台常驻脚本 (Manifest V3)
 * 职责：
 * 1. 注册浏览器右键上下文菜单（"添加到本地产品库"）
 * 2. 监听右键点击，向当前活跃标签页发送采集指令
 * 3. 容错处理：若 content script 未注入，自动进行动态注入
 * 4. 核心：增量追加单件采集商品至 GitHub 云端 (彻底解耦本地与云端数据)
 */

// 默认 GitHub 配置项（通过本地未提交文件或 storage 注入）
const DEFAULT_CONFIG = {
  owner: "lixun58555855-prog",
  repo: "amazon-product-vault",
  branch: "main",
  token: "",
  autoSync: true
};

// 安全加载本地未跟踪的专属配置 config.local.json
async function loadLocalFallbackConfig() {
  try {
    const url = chrome.runtime.getURL("config.local.json");
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.token) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

// 确保 Service Worker 启动时本地 storage 中有可用配置
async function ensureGithubConfig() {
  chrome.storage.local.get(["az_github_config"], async (res) => {
    if (!res.az_github_config || !res.az_github_config.token) {
      const localCfg = await loadLocalFallbackConfig();
      if (localCfg) {
        chrome.storage.local.set({ az_github_config: localCfg }, () => {
          console.log("[Amazon Collector] 已从本地专属配置加载 GitHub 同步凭证");
        });
      }
    }
  });
}
ensureGithubConfig();

// 自动同步状态互斥锁与增量排队队列
let isSyncing = false;
let pendingSync = false;
const incrementalQueue = [];

// 插件安装或更新时注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  ensureGithubConfig();
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

  // 接收单件商品增量提交信号
  if (message.action === "TRIGGER_AUTO_SYNC") {
    const tabId = sender.tab ? sender.tab.id : null;
    const singleProduct = message.product;
    if (singleProduct && singleProduct.asin) {
      incrementalQueue.push(singleProduct);
      console.log("[AutoSync] 增量加入待同步队列:", singleProduct.asin);
    }
    triggerAutoSync(tabId);
    sendResponse({ status: "sync_queued" });
  }

  return true;
});

/**
 * 触发后台增量同步至 GitHub (带排队队列)
 */
async function triggerAutoSync(sourceTabId) {
  if (isSyncing) {
    pendingSync = true;
    console.log("[AutoSync] 当前正在提交中，队列排队等待下一次增量提交");
    return;
  }

  isSyncing = true;
  updateBadgeState("SYNC", "#f59e0b"); // 橙色提示同步中

  try {
    const result = await executeGitHubIncrementalSync();
    if (result.success) {
      console.log(`[AutoSync] 增量提交成功！云端当前累计总商品数: ${result.count}`);
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
      console.warn("[AutoSync] 增量同步未执行:", result.reason);
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
    if (pendingSync || incrementalQueue.length > 0) {
      pendingSync = false;
      setTimeout(() => triggerAutoSync(sourceTabId), 500);
    }
  }
}

/**
 * 标准现代 Base64 编码 (兼容 UTF-8 中文字符，且完全支持 Service Worker 环境)
 */
function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 核心：仅将当前采集的单个商品增量追加/更新至 GitHub 仓库（绝对不覆盖云端历史商品）
 */
function executeGitHubIncrementalSync() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["az_github_config"], async (storage) => {
      let config = storage.az_github_config;
      if (!config || !config.token) {
        config = (await loadLocalFallbackConfig()) || DEFAULT_CONFIG;
      }

      // 检查是否开启了自动同步（默认开启）
      if (config.autoSync === false) {
        incrementalQueue.length = 0;
        return resolve({ success: false, reason: "用户已在设置中关闭自动同步" });
      }

      const { owner, repo, branch = "main", token } = config;
      if (!owner || !repo || !token) {
        return resolve({ success: false, reason: "GitHub 凭证不完整" });
      }

      if (incrementalQueue.length === 0) {
        return resolve({ success: true, count: 0 });
      }

      // 提取队列中待同步的所有新商品批次，并清空队列
      const batchItems = [...incrementalQueue];
      incrementalQueue.length = 0;

      try {
        const filePath = "data/products.json";
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

        // 1. 获取云端当前最新的产品数据与 sha (保证永远以云端最新数据为基准)
        let existingSha = null;
        let cloudProducts = [];
        try {
          const checkRes = await fetch(`${apiUrl}?ref=${branch}&_t=${Date.now()}`, {
            headers: {
              "Accept": "application/vnd.github.v3+json",
              "Authorization": `Bearer ${token}`,
              "User-Agent": "Amazon-Product-Collector-MV3"
            }
          });
          if (checkRes.ok) {
            const fileInfo = await checkRes.json();
            existingSha = fileInfo.sha;
            if (fileInfo.content) {
              const binary = atob(fileInfo.content.replace(/\s/g, ""));
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const jsonText = new TextDecoder().decode(bytes);
              const parsed = JSON.parse(jsonText);
              if (Array.isArray(parsed)) {
                cloudProducts = parsed;
              }
            }
          }
        } catch (e) {
          console.warn("[AutoSync] 读取云端现有数据异常，将作为初始文件创建:", e);
        }

        // 2. 增量合并：只把当前采集的新商品追加/更新到云端列表前，完整保留云端所有历史！
        batchItems.forEach((newProduct) => {
          if (!newProduct || !newProduct.asin) return;
          const existIdx = cloudProducts.findIndex((p) => p.asin === newProduct.asin);
          if (existIdx > -1) {
            // 已存在则更新价格与时间，移到最前
            const old = cloudProducts[existIdx];
            cloudProducts.splice(existIdx, 1);
            cloudProducts.unshift({
              ...old,
              ...newProduct,
              updatedAt: newProduct.collectedAt || new Date().toLocaleString("zh-CN", { hour12: false })
            });
          } else {
            // 不存在则插入到云端最前面
            cloudProducts.unshift(newProduct);
          }
        });

        // 3. 构造 Base64 提交内容
        const jsonString = JSON.stringify(cloudProducts, null, 2);
        const base64Content = encodeBase64Utf8(jsonString);

        const latestItem = batchItems[0];
        const shortTitle = latestItem.title ? latestItem.title.slice(0, 35) : latestItem.asin;
        const payload = {
          message: `Add: ${shortTitle} (Total Cloud: ${cloudProducts.length})`,
          content: base64Content,
          branch: branch
        };
        if (existingSha) {
          payload.sha = existingSha;
        }

        // 4. 提交至 GitHub API
        const putRes = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Amazon-Product-Collector-MV3",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (putRes.ok) {
          resolve({ success: true, count: cloudProducts.length });
        } else {
          const errData = await putRes.json();
          console.error("[AutoSync] GitHub API 响应错误:", errData);
          // 提交失败时放回队列
          incrementalQueue.unshift(...batchItems);
          resolve({ success: false, isError: true, reason: errData.message });
        }
      } catch (reqErr) {
        console.error("[AutoSync] 网络或执行异常:", reqErr);
        incrementalQueue.unshift(...batchItems);
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
