/**
 * grade.js — TIS「个人成绩查询」页增强（/cjgl/grcjcx/go/*）。
 *
 * 三项功能：
 *  1) 排名列：给成绩表格注入「排名」列（pm/zrs）——后端 /cjgl/grcjcx/grcjcx
 *     一直返回这两个字段，官方前端只是没渲染。
 *  2) 悬停分项成绩：悬停课程行 → 悬浮卡片显示 总评/等级/排名 + 各分项
 *     （作业/期中/期末…，来自 /cjgl/grcjcx/seeFx），卡片样式复用 NCES 评教卡。
 *  3) 整体学分绩胶囊：左下角悬浮胶囊显示平均学分绩点与排名
 *     （/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj）。
 *
 * 实现要点：
 * - 列对齐沿用「表头文字 → iView 列 token」现算现用（token 会在重渲染时更换，不能缓存）；
 * - 行数据按「学期+课程代码+总评成绩」与接口数据对齐，对筛选/排序/翻页天然免疫；
 * - MutationObserver 兜底：查询/翻页/调整窗口导致表格重建后自动补注入；
 * - 隐私：全部请求为页面同源请求（直接携带教务系统会话），数据不离开本机。
 */
(function () {
  "use strict";

  if (!/^\/cjgl\/grcjcx\/go\//.test(location.pathname)) return;
  if (window.__NCES_GRADE_ACTIVE__) return;
  window.__NCES_GRADE_ACTIVE__ = true;

  const { NcesCard } = globalThis.NcesCard;
  const XRW = { "X-Requested-With": "XMLHttpRequest" };
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* ---------------- 数据层（同源 fetch，带登录会话） ---------------- */

  async function fetchJSON(url, init) {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  let listPromise = null;
  function fetchList() {
    if (!listPromise) {
      listPromise = fetchJSON("/cjgl/grcjcx/grcjcx", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...XRW },
        body: JSON.stringify({
          xn: null, xq: null, kcmc: null, cxbj: "-1",
          pylx: "1", current: 1, pageSize: 1000, sffx: null,
        }),
      })
        .then((d) => (d && d.content && d.content.list) || [])
        .catch(() => []);
    }
    return listPromise;
  }

  const fxCache = new Map();
  function fetchFx(rwid, cjid) {
    const key = `${rwid}|${cjid}`;
    if (!fxCache.has(key)) {
      fxCache.set(
        key,
        fetchJSON("/cjgl/grcjcx/seeFx", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", ...XRW },
          body: `rwid=${encodeURIComponent(rwid)}&cjid=${encodeURIComponent(cjid)}`,
        })
          .then((x) => (Array.isArray(x) ? x : []))
          .catch(() => null)
      );
    }
    return fxCache.get(key);
  }

  // 注意：页面自身经框架发请求会带上 RoleCode 头（值为 null 字符串），
  // 后端因此返回空数据；这里显式不带该头才能拿到真实数据。
  async function fetchGpa() {
    try {
      const d = await fetchJSON("/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj", {
        method: "POST",
        headers: { ...XRW },
      });
      const pm = d && d.xfjandpm;
      if (pm && (pm.PM || pm.PJXFJ != null)) {
        return {
          pjxfj: pm.PJXFJ,
          pm: pm.PM,
          terms: (d.xnanxqxfj || []).map((x) => ({ XNXQ: x.XNXQ, xqxfj: x.XQXFJ, xnxfj: x.XNXFJ })),
        };
      }
    } catch (e) {}
    return null;
  }

  /* ---------------- 表格解析与排名列注入 ---------------- */

  // 表头文字 → 列类 token（iView 重渲染会换 token，必须每次现算）
  function columnMap(wrapper) {
    const map = {};
    for (const th of wrapper.querySelectorAll(".ivu-table-header th")) {
      const name = norm(th.textContent);
      const token = [...th.classList].find((c) => /^ivu-table-column-/.test(c));
      if (name && token && !(name in map)) map[name] = token;
    }
    return map;
  }

  const RANK_WIDTH = 84;
  const rowRec = new WeakMap(); // tr -> 接口记录（含 rwid/pm/zrs…）

  function makeIndex(list) {
    const idx = new Map();
    for (const rec of list) {
      const k = `${norm(rec.xnxqmc)}|${norm(rec.kcdm)}|${norm(rec.zzcj)}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(rec);
    }
    return idx;
  }

  function injectTable(wrapper, index) {
    const table = wrapper.querySelector(":scope > .ivu-table");
    if (!table) return;
    const header = table.querySelector(".ivu-table-header");
    const body = table.querySelector(".ivu-table-body");
    if (!header || !body) return;
    const hTr = header.querySelector("thead tr");
    if (!hTr) return;
    const insertAt = [...hTr.querySelectorAll("th")].findIndex((th) => norm(th.textContent) === "总评成绩") + 1;
    if (!insertAt) return; // 没找到总评成绩列

    // 表头 colgroup + th
    const hColgroup = header.querySelector("colgroup");
    if (hColgroup && !hColgroup.querySelector(".nces-rank-col")) {
      const hCol = document.createElement("col");
      hCol.className = "nces-rank-col";
      hCol.style.width = `${RANK_WIDTH}px`;
      hColgroup.insertBefore(hCol, hColgroup.children[insertAt] || null);
    }
    if (!hTr.querySelector(".nces-rank-th")) {
      const th = document.createElement("th");
      th.className = "ivu-table-column-center nces-rank-th";
      const cell = document.createElement("div");
      cell.className = "ivu-table-cell";
      cell.textContent = "排名";
      th.appendChild(cell);
      hTr.insertBefore(th, hTr.children[insertAt] || null);
    }
    const bColgroup = body.querySelector("colgroup");
    if (bColgroup && !bColgroup.querySelector(".nces-rank-col")) {
      const bCol = document.createElement("col");
      bCol.className = "nces-rank-col";
      bCol.style.width = `${RANK_WIDTH}px`;
      bColgroup.insertBefore(bCol, bColgroup.children[insertAt] || null);
    }

    // 行：注入排名徽章 + 记录映射
    const cols = columnMap(wrapper);
    const cellText = (tr, name) => {
      const t = cols[name];
      return t ? norm(tr.querySelector("." + t)?.textContent) : "";
    };
    for (const tr of body.querySelectorAll("tbody tr.ivu-table-row")) {
      if (tr.querySelector(".nces-rank-td")) continue;
      const td = document.createElement("td");
      td.className = "ivu-table-column-center nces-rank-td";
      const wrap = document.createElement("div");
      wrap.className = "ivu-table-cell";
      const badge = document.createElement("span");
      badge.className = "nces-rank-badge";
      wrap.appendChild(badge);
      td.appendChild(wrap);
      tr.insertBefore(td, tr.children[insertAt] || null);

      // 按「学期+课程代码+总评成绩」对齐接口记录（对筛选/排序/翻页免疫）
      const bucket = index.get(`${cellText(tr, "学年学期")}|${cellText(tr, "课程代码")}|${cellText(tr, "总评成绩")}`);
      const rec = bucket && bucket.length ? bucket.shift() : null;
      rowRec.set(tr, rec || null);

      if (rec && rec.pm != null && rec.zrs) {
        badge.textContent = `${rec.pm}/${rec.zrs}`;
        badge.classList.add("has");
        if (Number(rec.pm) / Number(rec.zrs) <= 0.1) badge.classList.add("top");
      } else {
        badge.textContent = "—";
        badge.classList.add("empty");
      }
    }
  }

  function injectAll() {
    for (const w of document.querySelectorAll(".ivu-table-wrapper")) {
      const isGradeTable = [...w.querySelectorAll(".ivu-table-header th")].some(
        (th) => norm(th.textContent) === "总评成绩"
      );
      if (isGradeTable) injectTable(w, index);
    }
  }

  let index = new Map();
  let injectTimer = null;
  function scheduleInject() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectAll();
    }, 180);
  }

  function injectStyle() {
    if (document.getElementById("nces-grade-style")) return;
    const st = document.createElement("style");
    st.id = "nces-grade-style";
    st.textContent = `
      .nces-rank-th .ivu-table-cell { font-weight: 600; }
      .nces-rank-td .ivu-table-cell { padding: 0 4px; }
      .nces-rank-badge {
        display: inline-block; min-width: 46px; padding: 1px 7px; border-radius: 999px;
        font-size: 12px; font-weight: 600; text-align: center;
        font-variant-numeric: tabular-nums;
        background: rgba(10, 132, 255, 0.10); color: #0a84ff;
        transition: background 150ms ease;
      }
      .nces-rank-badge.empty { background: transparent; color: #98a2ad; font-weight: 400; }
      .nces-rank-badge.top { background: rgba(48, 209, 88, 0.16); color: #1e9e4a; }
      .nces-rank-td:hover .nces-rank-badge { background: rgba(10, 132, 255, 0.2); }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- 悬浮卡片：行悬停 → 分项成绩 ---------------- */

  const card = new NcesCard();
  card.mount();

  const HOVER_INTENT_MS = 150;
  const GRACE_MS = 220;
  let hoverTr = null;
  let hoverTimer = null;
  let hideTimer = null;
  let pointerInCard = false;
  let seq = 0;

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };

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
    pointerInCard = false;
    card.hide();
  }

  async function openCard(rec, tr, x, y) {
    const anchor = { x, y, rect: rectOf(tr) };
    let fx = [];
    if (rec.rwid) {
      card.show({ kind: "loading", src: "tis" }, anchor);
      const s = ++seq;
      const rows = await fetchFx(rec.rwid, rec.id);
      if (s !== seq || !hoverTr) return; // 已切换目标或卡片已关
      fx = rows || [];
    }
    card.show(
      {
        kind: "fx",
        data: {
          kcmc: rec.kcmc, kcdm: rec.kcdm, xnxqmc: rec.xnxqmc,
          xscj: rec.xscj, zzcj: rec.zzcj, xf: rec.xf, kclb: rec.kclb,
          pm: rec.pm, zrs: rec.zrs, fx,
        },
      },
      anchor
    );
  }

  function scheduleShow(tr, x, y) {
    cancelShow();
    hoverTimer = setTimeout(() => {
      const rec = rowRec.get(tr);
      if (rec) openCard(rec, tr, x, y);
    }, HOVER_INTENT_MS);
  }

  document.addEventListener(
    "pointerover",
    (e) => {
      // 自愈：卡片被滚动/Esc/失焦等原因关闭时，鼠标可能并未真正离开影子宿主，
      // 导致 pointerInCard 卡死、后续悬停全部失效。用 :hover 实测校正。
      if (pointerInCard && !card.host.matches(":hover")) {
        pointerInCard = false;
        if (!card.cardEl) hoverTr = null;
      }
      if (pointerInCard) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const tr = t.closest("tr.ivu-table-row");
      if (!tr || !rowRec.has(tr)) return; // 仅成绩主表行
      cancelHide();
      // 自愈：同一行但卡片已不在（被外部关闭）时，重新调度而不是跳过
      if (tr === hoverTr && card.cardEl) return;
      hoverTr = tr;
      card.hide();
      scheduleShow(tr, e.clientX, e.clientY);
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      if (pointerInCard) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const tr = t.closest("tr.ivu-table-row");
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

  card.host.addEventListener("pointerenter", () => {
    pointerInCard = true;
    cancelHide();
  });
  card.host.addEventListener("pointerleave", () => {
    pointerInCard = false;
    hideCard();
  });

  // 点击行兜底打开（避开按钮/链接/分页器）
  document.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0) return;
      if (e.composedPath && e.composedPath().includes(card.host)) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const tr = t.closest("tr.ivu-table-row");
      if (!tr || !rowRec.has(tr)) return;
      if (t.closest("button, a, input, select, .ivu-btn, .ivu-page")) return;
      if (tr === hoverTr && card.lastKind === "fx") return; // 悬停已展示，无需重开
      const rec = rowRec.get(tr);
      if (!rec) return;
      hoverTr = tr;
      openCard(rec, tr, e.clientX, e.clientY);
    },
    true
  );

  window.addEventListener("scroll", () => hideCard(), { capture: true, passive: true });
  window.addEventListener("resize", () => hideCard(), { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCard();
  });

  /* ---------------- 整体学分绩胶囊（左下角） ---------------- */

  const PILL_CSS = `
    :host { all: initial; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 13px; border-radius: 999px;
      font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
            "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
      color: #1d1d1f;
      background: rgba(250, 250, 252, 0.82);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-top-color: rgba(255, 255, 255, 0.6);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 10px 28px rgba(0, 0, 0, 0.10);
      cursor: default;
      transition: transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 180ms ease;
    }
    .pill:hover { transform: scale(1.04); box-shadow: 0 4px 14px rgba(0,0,0,.16), 0 14px 34px rgba(0,0,0,.14); }
    .lbl { color: #86868b; }
    b { font-weight: 700; font-variant-numeric: tabular-nums; }
    .sep { color: #c7c7cc; }
    @media (prefers-color-scheme: dark) {
      .pill { background: rgba(38, 38, 42, 0.84); color: #f5f5f7; border-color: rgba(255,255,255,.12); }
      .lbl { color: #98989d; }
      .sep { color: #48484a; }
    }
    @media (prefers-reduced-motion: reduce) { .pill { transition: none; } }
  `;

  function mountPill(gpa) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483646;";
    const shadow = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = PILL_CSS;
    shadow.appendChild(st);

    const pill = document.createElement("div");
    pill.className = "pill";
    const mk = (cls, text) => {
      const el = document.createElement("span");
      el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };
    pill.appendChild(mk("lbl", "平均学分绩点"));
    const b1 = document.createElement("b");
    const v = Number(gpa.pjxfj);
    b1.textContent = isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : "—";
    pill.appendChild(b1);
    if (gpa.pm) {
      pill.appendChild(mk("sep", "·"));
      pill.appendChild(mk("lbl", "排名"));
      const b2 = document.createElement("b");
      b2.textContent = gpa.pm;
      pill.appendChild(b2);
    }
    shadow.appendChild(pill);
    (document.body || document.documentElement).appendChild(host);

    let t = null;
    pill.addEventListener("pointerenter", () => {
      cancelHide();
      if (t) {
        clearTimeout(t);
        t = null;
      }
      const r = pill.getBoundingClientRect();
      card.show(
        { kind: "gpa", data: gpa },
        { x: r.left + 8, y: r.top, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
      );
    });
    pill.addEventListener("pointerleave", () => {
      t = setTimeout(() => {
        if (!pointerInCard) hideCard();
      }, GRACE_MS);
    });
  }

  /* ---------------- 启动 ---------------- */

  (async function init() {
    injectStyle();
    const list = await fetchList();
    index = makeIndex(list);
    injectAll();
    // 查询/翻页/排序/窗口变化导致表格重建 → 自动补注入
    const mo = new MutationObserver(scheduleInject);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    const gpa = await fetchGpa();
    if (gpa) mountPill(gpa);
  })();
})();
