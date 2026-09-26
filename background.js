/**
 * background.js — MV3 service worker。
 * 职责：代理所有 ncesnext.com 请求（绕过 CORS）、限速、缓存、消息路由。
 */

import { lookupBrief, RateLimiter } from "./nces-core.js";

const limiter = new RateLimiter(250);

/** 串行 + 限速的 JSON GET；429 自动退避后重试一次 */
async function fetchJSON(url) {
  const once = () =>
    limiter.submit(async () => {
      const r = await fetch(url, { credentials: "omit" });
      if (r.status === 429) {
        const e = new Error("rate limited");
        e.status = 429;
        throw e;
      }
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      return r.json();
    });
  try {
    return await once();
  } catch (e) {
    if (e && e.status === 429) {
      await new Promise((res) => setTimeout(res, 1200));
      return once();
    }
    throw e;
  }
}

const storage = {
  async get(key) {
    try {
      const o = await chrome.storage.local.get(key);
      return o ? o[key] : undefined;
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch {
      /* 配额满时静默放弃缓存 */
    }
  },
};

const cacheGet = async (k) => (await storage.get(`nces:v1:${k}`)) || null;
const cacheSet = (k, v) => storage.set(`nces:v1:${k}`, v);

const inflight = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "nces:lookup") return false;
  const key = `b:${msg.code}|${[...(msg.teachers || [])].sort().join(",")}|${msg.term || ""}`;
  (async () => {
    if (inflight.has(key)) return inflight.get(key);
    const p = lookupBrief({ fetchJSON, cacheGet, cacheSet }, {
      code: msg.code,
      teachers: msg.teachers || [],
      termLabel: msg.termLabel || "",
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ available: false, error: true, reason: String(e) }));
  return true; // 异步响应
});
