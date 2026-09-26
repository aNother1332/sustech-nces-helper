/**
 * content.js — TIS 选课页面注入脚本（我要选课 /Xsxk/query/*、加课申请 /Xsxksq/query/*）。
 *
 * 交互（方案①：hover 悬浮窗）：
 * - 事件委托监听指针进出表格行，一次绑定，免疫 iView 重渲染（查询/翻页/切页签）
 * - hover 意图 150ms 后立即显示骨架卡片（即时反馈），数据由 background 提供，到货填充
 * - 同课程二次 hover 直接命中内存缓存（<10ms）
 * - 点击行空白处（非按钮/链接）同样打开卡片，作为触控/精确指针的兜底
 */
(function () {
  "use strict";

  if (!/^\/(Xsxk|Xsxksq)\/query\//.test(location.pathname)) return;
  if (window.__NCES_HELPER_ACTIVE__) return;
  window.__NCES_HELPER_ACTIVE__ = true;

  const { NcesCard } = globalThis.NcesCard;

  /* ---------------- 行 → {课程代码, 课程名称, 教师[]} 解析 ---------------- */

  // 南科大课程代码格式：2-5位字母 + 2-4位数字 + 可选后缀字母。
  // 注意 GE1221/GE2xxx 等通识课为 4 位数字（曾因只允许 2-3 位数字，
  // 导致通识选修列表翻页后 hover 全部失效）。
  const CODE_RE = /^[A-Z]{2,5}\d{2,4}[A-Z]{0,2}$/;

  function isTeacherName(t) {
    if (!t || t.length < 2 || t.length > 30) return false;
    if (/^[\u4e00-\u9fa5·]{2,6}$/.test(t)) return !/(上课|教师|信息|星期|教学班|实验)/.test(t);
    if (/^[A-Za-z][A-Za-z .·'\-]{2,29}$/.test(t)) return true;
    return false;
  }

  function dedupe(arr) {
    return [...new Set(arr)];
  }

  /** 上课信息单元格 → 教师名列表。教师名是 <a> 链接（选课页），纯文本则按分隔符切分（已选页）。 */
  function parseTeachers(cell) {
    if (!cell) return [];
    const links = [...cell.querySelectorAll("a")]
      .map((a) => a.textContent.trim())
      .filter(isTeacherName);
    if (links.length) return dedupe(links);
    const head = (cell.textContent || "").split(/上课信息|授课教师/)[0] || "";
    const tokens = head.split(/[\s,，、/()（）:：;；]+/).filter(isTeacherName);
    return dedupe(tokens);
  }

  /**
   * iView 表格：表头名 → 列类 token（ivu-table-column-XXXX），行内按 token 取单元格，
   * 天然对齐固定列/隐藏列。
   * 注意：翻页/切换页签时 iView 会重建表头并重新生成随机 token，且可能复用同一 wrapper，
   * 因此这里每次都重新计算，绝不能缓存到元素上（曾导致翻页后 hover 失效）。
   */
  function columnMap(wrapper) {
    const map = {};
    for (const th of wrapper.querySelectorAll(".ivu-table-header th")) {
      const name = (th.textContent || "").trim();
      const token = [...th.classList].find((c) => /^ivu-table-column-/.test(c));
      if (name && token && !(name in map)) map[name] = token;
    }
    return map;
  }

  function mainRowFor(tr) {
    const wrapper = tr.closest(".ivu-table-wrapper");
    if (!wrapper) return null;
    // 固定列克隆表里的行 → 映射回主表同一行，保证右侧“操作”列 hover 也生效
    const fixedRoot = tr.closest(".ivu-table-fixed, .ivu-table-fixed-right");
    if (!fixedRoot) return tr;
    const siblings = [...tr.parentElement.children].filter((n) => n.tagName === "TR");
    const idx = siblings.indexOf(tr);
    const mainBody = wrapper.querySelector(":scope > .ivu-table > .ivu-table-body");
    if (!mainBody || idx < 0) return tr;
    return mainBody.querySelectorAll("tbody tr")[idx] || tr;
  }

  function parseRow(tr) {
    const wrapper = tr.closest(".ivu-table-wrapper");
    if (!wrapper) return null;
    const map = columnMap(wrapper);
    const cell = (name) => {
      const token = map[name];
      return token ? tr.querySelector("." + token) : null;
    };
    const codeEl = cell("课程代码");
    const code = (codeEl ? codeEl.textContent : "").trim().toUpperCase();
    if (!CODE_RE.test(code)) return null;
    const nameEl = cell("课程名称");
    const nameElLink = nameEl ? nameEl.querySelector("a") : null;
    const name = (nameElLink || nameEl)?.textContent?.trim().split(/\s{2,}/)[0] || "";
    const teachers = parseTeachers(cell("上课信息"));
    if (!teachers.length) return null;
    return { code, name, teachers };
  }

  /* ---------------- 学期标签（用于优先匹配本学期班级） ---------------- */

  let termLabelCache = null;
  function currentTermLabel() {
    if (termLabelCache) return termLabelCache;
    for (const el of document.querySelectorAll(".ivu-select-selected-value")) {
      const m = (el.textContent || "").match(/(20\d{2})\s*(秋|春|夏)/);
      if (m) {
        termLabelCache = `${m[1]}${m[2]}`;
        return termLabelCache;
      }
    }
    return "";
  }

  /* ---------------- 与 background 通信（带会话级去重缓存） ---------------- */

  const sessionCache = new Map(); // key -> Promise<brief>

  function lookup(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "nces:lookup", ...payload }, (res) => {
          const err = chrome.runtime.lastError;
          resolve(res || { available: false, error: true, reason: err ? "插件后台无响应" : "空响应" });
        });
      } catch (e) {
        resolve({ available: false, error: true, reason: "插件已更新，请刷新页面后重试" });
      }
    });
  }

  function briefFor(info) {
    const key = `${info.code}|${[...info.teachers].sort().join(",")}`;
    if (!sessionCache.has(key)) {
      sessionCache.set(
        key,
        lookup({ code: info.code, teachers: info.teachers, termLabel: currentTermLabel() })
      );
    }
    return sessionCache.get(key);
  }

  /* ---------------- 悬浮卡片 + hover 交互 ---------------- */

  const card = new NcesCard();
  card.mount();

  const HOVER_INTENT_MS = 150; // 防误触；骨架屏保证“即时出现”的观感
  const GRACE_MS = 220; // 移入卡片的宽限期

  let hoverTr = null;
  let hoverInfo = null;
  let hoverTimer = null;
  let hideTimer = null;
  let pointerInCard = false;
  let reqSeq = 0;

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }

  function cancelShow() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }
  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
  function hideCard() {
    cancelShow();
    cancelHide();
    hoverTr = null;
    hoverInfo = null;
    pointerInCard = false;
    card.hide();
  }

  async function openCard(info, anchor) {
    card.mount();
    card.show({ kind: "loading" }, anchor);
    const seq = ++reqSeq;
    const brief = await briefFor(info);
    if (seq !== reqSeq || !hoverInfo) return; // 已切换目标或卡片已关
    if (brief && brief.available) {
      card.show({ kind: "data", data: brief }, anchor);
    } else {
      // 未收录/出错时也带上行内课程信息，卡片标题不落空
      card.show(
        { kind: brief && brief.error ? "error" : "data", data: { ...brief, name: info.name, code: info.code } },
        anchor
      );
    }
  }

  function scheduleShow(tr, x, y) {
    cancelShow();
    hoverTimer = setTimeout(() => {
      const info = parseRow(tr);
      if (!info) return;
      hoverInfo = info;
      openCard(info, { x, y, rect: rectOf(tr) });
    }, HOVER_INTENT_MS);
  }

  function trFromEvent(e) {
    const t = e.target;
    if (!t || !t.closest) return null;
    const tr = t.closest("tr.ivu-table-row");
    return tr ? mainRowFor(tr) : null;
  }

  function infoKey(info) {
    return `${info.code}|${info.teachers.join(",")}`;
  }

  document.addEventListener(
    "pointerover",
    (e) => {
      if (pointerInCard) return;
      const tr = trFromEvent(e);
      if (!tr) return;
      cancelHide();
      if (tr === hoverTr) {
        // iView 翻页可能复用同一 <tr> 元素并替换内容：内容变了要当作新行重新弹卡
        if (!hoverInfo) return; // 意图计时器已在处理本次 hover
        const fresh = parseRow(tr);
        if (fresh && infoKey(fresh) === infoKey(hoverInfo)) return;
      }
      hoverTr = tr;
      hoverInfo = null;
      card.hide(); // 换行：旧卡立即退场，新卡随后入场（同路径动效）
      scheduleShow(tr, e.clientX, e.clientY);
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      if (pointerInCard) return;
      const tr = trFromEvent(e);
      if (!tr || tr !== hoverTr) return;
      const to = e.relatedTarget;
      if (to && tr.contains(to)) return;
      cancelShow();
      cancelHide();
      hideTimer = setTimeout(() => {
        if (!pointerInCard) hideCard();
      }, GRACE_MS);
    },
    { passive: true }
  );

  // 卡片自身可交互（选中文字/点击跳转），进入时取消关闭
  card.host.addEventListener("pointerenter", () => {
    pointerInCard = true;
    cancelHide();
  });
  card.host.addEventListener("pointerleave", () => {
    pointerInCard = false;
    hideCard();
  });

  // 点击行空白处兜底打开（避开按钮/链接/表单控件）
  document.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    if (card.host.contains(e.target) || e.composedPath?.().includes(card.host)) return;
    const tr = trFromEvent(e);
    if (!tr) {
      hideCard();
      return;
    }
    if (e.target.closest("button, a, input, select, textarea, label, .ivu-select, .ivu-checkbox-wrapper, .ivu-switch, .ivu-page")) {
      return; // 让位于页面原生操作
    }
    e.preventDefault();
    e.stopPropagation();
    const info = parseRow(tr);
    if (!info) return;
    hoverTr = tr;
    hoverInfo = info;
    openCard(info, { x: e.clientX, y: e.clientY, rect: rectOf(tr) });
  }, true);

  // 页面滚动/视口变化/Escape → 收起（卡片锚定于指针位置，滚动后锚点已失效）
  window.addEventListener("scroll", () => hideCard(), { capture: true, passive: true });
  window.addEventListener("resize", () => hideCard(), { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCard();
  });
})();
