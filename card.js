/**
 * card.js — NCES 评教悬浮卡片（Apple Design 风格），Shadow DOM 渲染。
 * content script 与本地 mock 页共用。暴露 globalThis.NcesCard。
 *
 * 设计要点（fluid interfaces）：
 * - 材质：backdrop-filter 毛玻璃 + 高光顶边 + 大阴影，浮于页面内容之上
 * - 动效：从触发点 transform-origin 缩放淡入，进出场同路径；JS 零依赖 CSS spring 近似
 * - 响应：调用方立即以 loading 态 show（骨架屏），数据到达后填充
 * - 降级：prefers-reduced-motion 淡入淡出；prefers-reduced-transparency 近实心
 * - 安全：全部 createElement/textContent 构建，不拼接数据 HTML
 */
(function () {
  "use strict";

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .card {
      position: fixed; z-index: 2147483647;
      width: 400px; max-width: calc(100vw - 24px);
      max-height: min(680px, calc(100vh - 24px));
      display: flex; flex-direction: column;
      font: 400 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
            "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
      color: #1d1d1f;
      background: rgba(250, 250, 252, 0.78);
      backdrop-filter: blur(28px) saturate(180%);
      -webkit-backdrop-filter: blur(28px) saturate(180%);
      border-radius: 14px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-top-color: rgba(255, 255, 255, 0.65);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 28px rgba(0,0,0,.16), 0 32px 64px rgba(0,0,0,.18);
      opacity: 0; transform: scale(0.94) translateY(6px);
      transition: opacity 220ms cubic-bezier(0.25, 0.8, 0.35, 1),
                  transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1.2);
      will-change: transform, opacity;
      cursor: default;
    }
    .card.shown { opacity: 1; transform: scale(1) translateY(0); }
    .card.above { transform-origin: bottom center; }
    .card.below { transform-origin: top center; }

    @media (prefers-reduced-motion: reduce) {
      .card { transform: none !important; transition: opacity 160ms ease; }
    }
    @media (prefers-reduced-transparency: reduce) {
      .card { background: #fafafc; backdrop-filter: none; -webkit-backdrop-filter: none; }
    }
    @media (prefers-color-scheme: dark) {
      .card {
        color: #f5f5f7;
        background: rgba(38, 38, 42, 0.80);
        border-color: rgba(255, 255, 255, 0.12);
        border-top-color: rgba(255, 255, 255, 0.18);
        box-shadow: 0 12px 28px rgba(0,0,0,.45), 0 32px 64px rgba(0,0,0,.5);
      }
      .dim { color: #98989d; }
      .muted { color: #b9b9c0; }
      .rv-text { color: #d9d9de; }
      .review { border-color: rgba(255,255,255,.09) !important; }
      .track { background: rgba(255,255,255,.12) !important; }
      .pill { background: rgba(255,255,255,.10) !important; }
      .warn { background: rgba(255,214,10,.14) !important; color: #ffd60a !important; }
    }

    .scroll { overflow-y: auto; overscroll-behavior: contain; }

    header.head {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 14px 16px 10px;
    }
    .head-titles { flex: 1; min-width: 0; }
    .course-name {
      font-size: 16px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3;
      overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; align-items: center; }
    .pill {
      font-size: 11px; font-weight: 500; letter-spacing: 0.01em;
      background: rgba(120, 120, 128, 0.12); color: inherit;
      padding: 2px 8px; border-radius: 999px; white-space: nowrap;
    }
    .ext {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px;
      color: #007aff; text-decoration: none;
      transition: background 150ms ease;
    }
    .ext:hover { background: rgba(0, 122, 255, 0.12); }
    .ext:active { transform: scale(0.94); }
    .ext svg { width: 16px; height: 16px; }

    .warn {
      margin: 0 16px 8px; padding: 7px 10px; border-radius: 9px;
      background: rgba(255, 214, 10, 0.16); color: #8a6d00;
      font-size: 12px; font-weight: 500;
    }

    .body { padding: 0 16px 12px; }

    /* 评分 hero */
    .hero { display: flex; align-items: center; gap: 14px; padding: 2px 0 10px; }
    .score { display: flex; align-items: baseline; gap: 2px; }
    .score-num { font-size: 34px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
    .score-den { font-size: 13px; font-weight: 500; }
    .hero-side { flex: 1; min-width: 0; }
    .stars { position: relative; display: inline-block; height: 16px; line-height: 0; }
    .stars svg { width: 16px; height: 16px; }
    .stars .fill { position: absolute; inset: 0; overflow: hidden; white-space: nowrap; }
    .review-count { font-size: 12px; margin-top: 3px; }
    .teacher-pill {
      display: inline-block; margin-top: 5px; font-size: 11.5px; font-weight: 500;
      color: #007aff; background: rgba(0, 122, 255, 0.10);
      padding: 2px 8px; border-radius: 999px; max-width: 100%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* 维度条 */
    .dims { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; padding: 4px 0 10px; }
    .dim-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .dim-label { flex: none; width: 42px; }
    .track { flex: 1; height: 5px; border-radius: 3px; background: rgba(120, 120, 128, 0.18); overflow: hidden; }
    .fillbar { display: block; height: 100%; border-radius: 3px; background: #30d158; transition: width 400ms cubic-bezier(0.25, 1, 0.4, 1); }
    .fillbar.mid { background: #ff9f0a; }
    .fillbar.low { background: #ff453a; }
    .dim-grade { flex: none; width: 34px; text-align: right; font-weight: 500; }

    /* 热门评价 */
    .sec-title {
      font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
      padding: 8px 0 6px; display: flex; align-items: center; gap: 6px;
    }
    .review {
      padding: 8px 0; border-top: 1px solid rgba(0, 0, 0, 0.06);
    }
    .rv-head { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
    .rv-user { font-weight: 600; }
    .rv-stars { color: #ff9f0a; font-size: 10px; letter-spacing: 1px; }
    .rv-likes { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; }
    .rv-text {
      margin-top: 3px; font-size: 12.5px; line-height: 1.55; color: #3a3a3c;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }

    /* 教师对比图 */
    .cmp { margin-top: 2px; }
    .cmp-row {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 6px; margin: 0 -6px; border-radius: 8px;
      font-size: 12px; text-decoration: none; color: inherit;
      transition: background 150ms ease;
    }
    .cmp-row:hover { background: rgba(120, 120, 128, 0.10); }
    .cmp-name {
      flex: none; width: 96px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-weight: 500;
    }
    .cmp-track { flex: 1; height: 8px; border-radius: 4px; background: rgba(120, 120, 128, 0.16); overflow: hidden; }
    .cmp-fill {
      display: block; height: 100%; border-radius: 4px; background: rgba(120, 120, 128, 0.55);
      transition: width 450ms cubic-bezier(0.25, 1, 0.4, 1);
    }
    .cmp-row.current .cmp-fill { background: #007aff; }
    .cmp-row.current .cmp-name { color: #007aff; }
    .cmp-val { flex: none; width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
    .cmp-val b { font-weight: 700; }
    .chip {
      display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 999px;
      font-size: 10px; font-weight: 600; line-height: 15px;
      background: #007aff; color: #fff; vertical-align: 1px;
    }
    .chip.term { background: #30d158; }

    footer.foot {
      padding: 8px 16px 10px; border-top: 1px solid rgba(0, 0, 0, 0.06);
      display: flex; align-items: center; gap: 6px;
    }
    footer.foot a { color: #007aff; text-decoration: none; font-weight: 500; }
    footer.foot a:hover { text-decoration: underline; }

    .dim, .muted { color: #86868b; }

    /* 骨架屏 */
    .sk { position: relative; overflow: hidden; background: rgba(120, 120, 128, 0.16); border-radius: 6px; }
    .sk::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }
    .sk-line { height: 12px; margin: 10px 0; }
    .sk-hero { width: 90px; height: 40px; border-radius: 10px; margin: 4px 0 10px; }

    .empty { padding: 18px 4px 14px; text-align: center; }
    .empty-icon { font-size: 26px; line-height: 1; margin-bottom: 8px; }
    .empty-title { font-size: 14px; font-weight: 600; }
    .empty-sub { font-size: 12px; margin-top: 4px; }

    /* 成绩页：分项成绩 / 整体学分绩 */
    .rank-hero { display: flex; align-items: center; gap: 14px; padding: 2px 0 10px; }
    .rank-hero .score-num { font-variant-numeric: tabular-nums; }
    .badge-grade {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 42px; padding: 3px 10px; border-radius: 10px;
      font-size: 14px; font-weight: 700; letter-spacing: 0.01em;
      background: rgba(10, 132, 255, 0.12); color: #0a84ff;
    }
    .fx-row { display: flex; align-items: center; gap: 9px; padding: 5px 0; font-size: 12px; }
    .fx-name { flex: none; width: 64px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fx-track { flex: 1; height: 7px; border-radius: 4px; background: rgba(120, 120, 128, 0.18); overflow: hidden; }
    .fx-fill { display: block; height: 100%; border-radius: 4px; background: #0a84ff; transition: width 420ms cubic-bezier(0.25, 1, 0.4, 1); }
    .fx-score { flex: none; width: 86px; text-align: right; font-variant-numeric: tabular-nums; }
    .fx-score b { font-weight: 700; }
    .fx-weight { flex: none; width: 52px; text-align: right; }
    .gpa-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid rgba(0, 0, 0, 0.06); font-size: 12.5px; }
    .gpa-term { flex: none; width: 72px; font-weight: 500; }
    .gpa-track { flex: 1; height: 7px; border-radius: 4px; background: rgba(120, 120, 128, 0.18); overflow: hidden; }
    .gpa-fill { display: block; height: 100%; border-radius: 4px; background: #30d158; transition: width 420ms cubic-bezier(0.25, 1, 0.4, 1); }
    .gpa-val { flex: none; width: 84px; text-align: right; font-variant-numeric: tabular-nums; }
    .gpa-val b { font-weight: 700; }

    @media (prefers-color-scheme: dark) {
      .gpa-row { border-color: rgba(255, 255, 255, 0.09) !important; }
      .fx-track, .gpa-track { background: rgba(255, 255, 255, 0.12) !important; }
      .badge-grade { background: rgba(10, 132, 255, 0.22) !important; color: #6cb2ff !important; }
    }
  `;

  const STAR =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6l2.86 5.8 6.4.93-4.63 4.51 1.1 6.37L12 17.2l-5.72 3.01 1.09-6.37-4.63-4.51 6.4-.93z"/></svg>';
  const LINK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M19 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V7a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>';

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function svgIcon(mark) {
    const s = document.createElement("span");
    s.innerHTML = mark; // 静态内置字符串，非数据
    const svg = s.firstElementChild;
    return svg;
  }
  function starsRow(value /* 0-5 */) {
    const wrap = h("span", "stars");
    const gray = h("span");
    gray.style.color = "rgba(120,120,128,.35)";
    for (let i = 0; i < 5; i++) gray.appendChild(svgIcon(STAR));
    const fill = h("span", "fill");
    fill.style.color = "#ff9f0a";
    for (let i = 0; i < 5; i++) fill.appendChild(svgIcon(STAR));
    fill.style.width = `${Math.max(0, Math.min(100, (value / 5) * 100))}%`;
    wrap.appendChild(gray);
    wrap.appendChild(fill);
    return wrap;
  }

  function gradeClass(pct) {
    return pct == null ? "" : pct <= 33 ? "low" : pct <= 67 ? "mid" : "";
  }

  function fmtRating(r) {
    return r == null ? "—" : (Math.round(r * 10) / 10).toFixed(1);
  }

  /** 构建（或重建）卡片内容。state.kind: loading | data(NCES) | error | fx(分项成绩) | gpa(整体学分绩) */
  function renderContent(root, state) {
    root.textContent = "";
    const card = h("div", "card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "课程信息");

    if (state.kind === "loading") {
      card.appendChild(buildSkeleton(state.src));
    } else if (state.kind === "fx") {
      const d = state.data || {};
      card.appendChild(buildFxHead(d));
      card.appendChild(buildFxBody(d));
    } else if (state.kind === "gpa") {
      const d = state.data || {};
      card.appendChild(buildGpaHead(d));
      card.appendChild(buildGpaBody(d));
    } else if (state.kind === "error" || state.data?.available === false) {
      card.appendChild(buildHead(state.data || {}));
      card.appendChild(buildEmpty(state));
    } else {
      const d = state.data;
      card.appendChild(buildHead(d));
      if (d.teacherMismatch) {
        const w = h("div", "warn");
        w.textContent = "教务系统教师与评教数据不完全匹配，以下为该课程在评教网站的数据";
        card.appendChild(w);
      }
      card.appendChild(buildBody(d));
    }
    card.appendChild(buildFoot(state));
    root.appendChild(card);
    return card;
  }

  function buildFoot(state) {
    const foot = h("footer", "foot");
    const isTis = state.kind === "fx" || state.kind === "gpa" || state.src === "tis";
    if (isTis) {
      foot.appendChild(h("span", "dim", "数据来自"));
      const t = h("span", null, "教务系统");
      t.style.fontWeight = "500";
      foot.appendChild(t);
      const tip = h("span", "muted", "· 仅本机展示，请勿外传");
      tip.style.marginLeft = "auto";
      foot.appendChild(tip);
      return foot;
    }
    const src = h("span", "dim", "数据来自");
    const a = h("a", null, "NCES 评教");
    const url = state.data?.detailUrl || state.data?.searchUrl || "https://ncesnext.com";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    foot.appendChild(src);
    foot.appendChild(a);
    const tip = h("span", "muted", "· 仅供参考");
    tip.style.marginLeft = "auto";
    foot.appendChild(tip);
    return foot;
  }

  function buildHead(d) {
    const head = h("header", "head");
    const titles = h("div", "head-titles");
    titles.appendChild(h("div", "course-name", d.name || d.code || "未知课程"));
    const meta = h("div", "meta-row");
    if (d.code) meta.appendChild(h("span", "pill", d.code));
    if (d.ncesTeacher && d.teacherMatched !== false)
      meta.appendChild(h("span", "pill", d.ncesTeacher));
    const sems = d.semesters || [];
    if (sems.length) meta.appendChild(h("span", "pill", `近学期 ${sems.join(" / ")}`));
    titles.appendChild(meta);
    head.appendChild(titles);
    const ext = h("a", "ext");
    ext.href = d.detailUrl || d.searchUrl || "https://ncesnext.com";
    ext.target = "_blank";
    ext.rel = "noopener noreferrer";
    ext.title = "在 NCES 中查看";
    ext.appendChild(svgIcon(LINK_ICON));
    head.appendChild(ext);
    return head;
  }

  function buildBody(d) {
    const body = h("div", "body scroll");

    // hero：大评分 + 星 + 评论数 + 教师徽章
    const hero = h("div", "hero");
    const score = h("div", "score");
    score.appendChild(h("span", "score-num", fmtRating(d.rating)));
    const den = h("span", "score-den dim", "/ 10");
    score.appendChild(den);
    hero.appendChild(score);
    const side = h("div", "hero-side");
    side.appendChild(starsRow((d.rating || 0) / 2));
    side.appendChild(
      h("div", "review-count dim", d.reviewCount ? `${d.reviewCount} 条评价` : "暂无评价")
    );
    if (d.ncesTeacher && d.teacherMatched !== false) {
      side.appendChild(h("span", "teacher-pill", `本班教师：${d.ncesTeacher}`));
    } else if (d.tisTeachers && d.tisTeachers.length) {
      side.appendChild(h("span", "teacher-pill", `教务教师：${d.tisTeachers.join("、")}`));
    }
    hero.appendChild(side);
    body.appendChild(hero);

    // 四维度
    if (d.dims && d.dims.some((x) => x.pct != null)) {
      const dims = h("div", "dims");
      for (const dim of d.dims) {
        const row = h("div", "dim-row");
        row.appendChild(h("span", "dim-label dim", dim.label));
        const track = h("span", "track");
        const fill = h("span", `fillbar ${gradeClass(dim.pct)}`);
        fill.style.width = `${dim.pct == null ? 0 : Math.min(100, dim.pct)}%`;
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(h("span", "dim-grade", dim.grade || "—"));
        dims.appendChild(row);
      }
      body.appendChild(dims);
    }

    // 热门评价
    const revs = d.reviews || [];
    if (revs.length) {
      body.appendChild(h("div", "sec-title", "热门评价"));
      for (const rv of revs) {
        const item = h("div", "review");
        const head = h("div", "rv-head");
        head.appendChild(h("span", "rv-user", rv.user || "匿名"));
        if (rv.term) head.appendChild(h("span", "muted", rv.term));
        const st = h("span", "rv-stars");
        st.textContent = "★★★★★".slice(0, Math.max(0, Math.min(5, Math.round((rv.rate || 0) / 2))));
        head.appendChild(st);
        const likes = h("span", "rv-likes dim");
        likes.textContent = `👍 ${rv.likes || 0}`;
        head.appendChild(likes);
        item.appendChild(head);
        item.appendChild(h("div", "rv-text", rv.text || ""));
        body.appendChild(item);
      }
    }

    // 同课程教师对比
    const alts = d.alternatives || [];
    if (alts.length) {
      body.appendChild(h("div", "sec-title", "同课程各教师评分对比"));
      const cmp = h("div", "cmp");
      const rows = [{ teacher: d.ncesTeacher, rating: d.rating, reviewCount: d.reviewCount, current: true, url: d.detailUrl, currentTerm: d.currentTermIncluded }, ...alts]
        .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.rating ?? -1) - (a.rating ?? -1));
      for (const a of rows) {
        const row = h(a.url ? "a" : "div", "cmp-row" + (a.current ? " current" : ""));
        if (a.url) {
          row.href = a.url;
          row.target = "_blank";
          row.rel = "noopener noreferrer";
        }
        const nm = h("span", "cmp-name", a.teacher || "未知教师");
        if (a.current) nm.appendChild(h("span", "chip", "本班"));
        if (a.currentTerm) nm.appendChild(h("span", "chip term", "本学期"));
        row.appendChild(nm);
        const track = h("span", "cmp-track");
        const fill = h("span", "cmp-fill");
        fill.style.width = `${((a.rating == null ? 0 : a.rating) / 10) * 100}%`;
        track.appendChild(fill);
        row.appendChild(track);
        const val = h("span", "cmp-val");
        const b = h("b", null, fmtRating(a.rating));
        val.appendChild(b);
        val.appendChild(h("span", "dim", ` · ${a.reviewCount || 0}评`));
        row.appendChild(val);
        cmp.appendChild(row);
      }
      body.appendChild(cmp);
    } else {
      body.appendChild(h("div", "sec-title", "同课程各教师评分对比"));
      body.appendChild(
        h("div", "muted", revs.length ? "NCES 上该课程暂未收录其他教师班级的评分。" : "这门课还没有人在 NCES 留下评价。选课后欢迎去留下第一条。")
      );
    }
    return body;
  }

  function buildSkeleton(src) {
    const body = h("div", "body");
    const hero = h("div", "hero");
    hero.appendChild(h("div", "sk sk-hero"));
    const side = h("div", "hero-side");
    const l1 = h("div", "sk sk-line");
    l1.style.width = "70%";
    const l2 = h("div", "sk sk-line");
    l2.style.width = "45%";
    side.appendChild(l1);
    side.appendChild(l2);
    hero.appendChild(side);
    body.appendChild(hero);
    for (const w of ["92%", "85%", "60%"]) {
      const l = h("div", "sk sk-line");
      l.style.width = w;
      body.appendChild(l);
    }
    const tip = h("div", "muted", src === "tis" ? "正在读取成绩明细…" : "正在查询 NCES 评教数据…");
    tip.style.marginTop = "10px";
    tip.style.fontSize = "12px";
    body.appendChild(tip);
    return body;
  }

  function buildEmpty(state) {
    const d = state.data || {};
    const empty = h("div", "empty");
    empty.appendChild(h("div", "empty-icon", state.kind === "error" ? "⚠️" : "🔍"));
    empty.appendChild(h("div", "empty-title", state.kind === "error" ? (d.reason || "查询失败") : "评教网站未收录该课程"));
    const sub = h("div", "empty-sub muted", state.kind === "error"
      ? "可稍后重试，或直接前往评教网站搜索"
      : "可能暂无评价，或课程代码有出入。可前往 NCES 手动搜索");
    empty.appendChild(sub);
    return empty;
  }

  /* ---------------- 成绩页：分项成绩卡（kind: 'fx'） ---------------- */

  function buildFxHead(d) {
    const head = h("header", "head");
    const titles = h("div", "head-titles");
    titles.appendChild(h("div", "course-name", d.kcmc || d.kcdm || "未知课程"));
    const meta = h("div", "meta-row");
    if (d.kcdm) meta.appendChild(h("span", "pill", d.kcdm));
    if (d.xnxqmc) meta.appendChild(h("span", "pill", d.xnxqmc));
    if (d.xf != null && d.xf !== "") meta.appendChild(h("span", "pill", `${d.xf} 学分`));
    if (d.kclb) meta.appendChild(h("span", "pill", d.kclb));
    titles.appendChild(meta);
    head.appendChild(titles);
    return head;
  }

  function buildFxBody(d) {
    const body = h("div", "body scroll");

    // hero：总评成绩 + 等级徽章 + 班级排名
    const hero = h("div", "rank-hero");
    const score = h("div", "score");
    score.appendChild(h("span", "score-num", d.zzcj == null || d.zzcj === "" ? "—" : String(d.zzcj)));
    hero.appendChild(score);
    const side = h("div", "hero-side");
    const row1 = h("div", "meta-row");
    row1.style.marginTop = "0";
    if (d.xscj) row1.appendChild(h("span", "badge-grade", d.xscj));
    if (d.pm != null && d.zrs) {
      row1.appendChild(h("span", "teacher-pill", `排名 ${d.pm} / ${d.zrs}`));
    } else {
      row1.appendChild(h("span", "pill", "暂无排名"));
    }
    side.appendChild(row1);
    if (d.pm != null && d.zrs && Number(d.zrs) > 0) {
      const pct = Math.max(1, Math.ceil((Number(d.pm) / Number(d.zrs)) * 100));
      side.appendChild(h("div", "review-count dim", `教学班排名 · 位于前 ${pct}%`));
    }
    hero.appendChild(side);
    body.appendChild(hero);

    // 分项成绩
    const fx = d.fx || [];
    body.appendChild(h("div", "sec-title", "分项成绩"));
    if (!fx.length) {
      body.appendChild(h("div", "muted", "暂无分项明细（可能尚未公布，或该课程不设分项）"));
    } else {
      for (const it of fx) {
        const name = it.FXMC || "—";
        const df = it.DF == null || it.DF === "" ? null : it.DF;
        const mf = it.MF == null || it.MF === "" ? null : it.MF;
        const nd = parseFloat(df), nm = parseFloat(mf);
        const pct = isFinite(nd) && isFinite(nm) && nm > 0 ? Math.max(0, Math.min(100, (nd / nm) * 100)) : null;
        const row = h("div", "fx-row");
        row.appendChild(h("span", "fx-name", name));
        const track = h("span", "fx-track");
        const fill = h("span", "fx-fill");
        fill.style.width = `${pct == null ? 0 : pct}%`;
        track.appendChild(fill);
        row.appendChild(track);
        const sc = h("span", "fx-score");
        sc.appendChild(h("b", null, df == null ? "—" : String(df)));
        sc.appendChild(h("span", "dim", ` / ${mf == null ? "—" : mf}`));
        row.appendChild(sc);
        row.appendChild(h("span", "fx-weight dim", it.LJFXBZ == null || it.LJFXBZ === "" ? "" : `占 ${it.LJFXBZ}%`));
        body.appendChild(row);
      }
    }
    return body;
  }

  /* ---------------- 成绩页：整体学分绩卡（kind: 'gpa'） ---------------- */

  function buildGpaHead() {
    const head = h("header", "head");
    const titles = h("div", "head-titles");
    titles.appendChild(h("div", "course-name", "整体学分绩"));
    const meta = h("div", "meta-row");
    meta.appendChild(h("span", "pill", "全部学期"));
    titles.appendChild(meta);
    head.appendChild(titles);
    return head;
  }

  function buildGpaBody(d) {
    const body = h("div", "body scroll");
    const hero = h("div", "rank-hero");
    const score = h("div", "score");
    const v = Number(d.pjxfj);
    score.appendChild(h("span", "score-num", isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : "—"));
    hero.appendChild(score);
    const side = h("div", "hero-side");
    const row1 = h("div", "meta-row");
    row1.style.marginTop = "0";
    if (d.pm) row1.appendChild(h("span", "teacher-pill", `排名 ${d.pm}`));
    side.appendChild(row1);
    side.appendChild(h("div", "review-count dim", "平均学分绩点（满分 4.0）"));
    hero.appendChild(side);
    body.appendChild(hero);

    const terms = d.terms || [];
    if (terms.length) {
      body.appendChild(h("div", "sec-title", "学期学分绩点"));
      for (const t of terms) {
        const row = h("div", "gpa-row");
        row.appendChild(h("span", "gpa-term", t.XNXQ || "—"));
        const track = h("span", "gpa-track");
        const fill = h("span", "gpa-fill");
        const q = Number(t.xqxfj);
        fill.style.width = `${isFinite(q) ? Math.max(0, Math.min(100, (q / 4) * 100)) : 0}%`;
        track.appendChild(fill);
        row.appendChild(track);
        const val = h("span", "gpa-val");
        val.appendChild(h("span", "dim", "学期 "));
        val.appendChild(h("b", null, isFinite(q) ? (Math.round(q * 100) / 100).toFixed(2) : "—"));
        row.appendChild(val);
        body.appendChild(row);
      }
    }
    return body;
  }

  class NcesCard {
    constructor() {
      this.host = document.createElement("div");
      this.host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
      this.shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      this.shadow.appendChild(style);
      this.root = h("div");
      this.shadow.appendChild(this.root);
      this.cardEl = null;
      this.placement = "below";
    }

    /** state: {kind:'loading',src?} | {kind:'data'|'error', data} | {kind:'fx'|'gpa', data} */
    show(state, anchor /* {x,y,rect:{top,bottom,left,right}} */) {
      const wasShown = !!this.cardEl && this.cardEl.classList.contains("shown");
      const sameData =
        !!state.data && state.kind === this.lastKind && this.lastData === state.data;
      if (this.cardEl && ((state.kind === "loading" && this.lastKind === "loading") || sameData)) {
        // 仅更新位置
        this.place(anchor);
        return;
      }
      this.lastKind = state.kind;
      this.lastData = state.data || null;

      this.cardEl = renderContent(this.root, state);
      this.place(anchor);
      // 从当前值过渡到目标（重渲染时若已显示则不做入场动画）
      if (!wasShown) {
        requestAnimationFrame(() => requestAnimationFrame(() => this.cardEl?.classList.add("shown")));
      } else {
        this.cardEl.classList.add("shown");
      }
    }

    place(anchor) {
      const card = this.cardEl;
      if (!card) return;
      const pad = 10;
      const vw = window.innerWidth, vh = window.innerHeight;
      const cw = 400;
      let left = anchor.x + 18;
      if (left + cw + pad > vw) {
        left = anchor.rect
          ? Math.max(pad, Math.min(anchor.rect.left + 8, vw - cw - pad))
          : Math.max(pad, vw - cw - pad);
      }
      // 指针下方空间足够则向下展开，否则向上（用 bottom 锚定，卡高自适应）
      const belowSpace = vh - anchor.y - pad;
      const showBelow = belowSpace >= 300 || anchor.y < 220;
      card.style.top = "";
      card.style.bottom = "";
      if (showBelow) {
        card.style.top = `${Math.round(Math.min(anchor.y + 10, vh - pad - 160))}px`;
      } else {
        card.style.bottom = `${Math.round(Math.min(vh - anchor.y + 10, vh - pad - 160))}px`;
      }
      card.style.left = `${Math.round(left)}px`;
      this.placement = showBelow ? "below" : "above";
      card.classList.toggle("below", showBelow);
      card.classList.toggle("above", !showBelow);
      card.style.transformOrigin = showBelow ? "top left" : "bottom left";
    }

    /** 淡出后移除 DOM（进出场同路径） */
    hide() {
      this.lastKind = null;
      this.lastData = null;
      const card = this.cardEl;
      if (!card) return;
      this.cardEl = null;
      card.classList.remove("shown");
      setTimeout(() => card.remove(), 260);
    }

    mount() {
      if (!this.host.isConnected) (document.documentElement || document.body).appendChild(this.host);
    }
    destroy() {
      this.host.remove();
    }
  }

  globalThis.NcesCard = { NcesCard };
})();
