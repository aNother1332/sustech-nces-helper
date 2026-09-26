/**
 * nces-core.js — NCES (ncesnext.com) 数据核心，纯逻辑、无 Chrome API 依赖。
 * Node 与 MV3 service worker 共用。缓存与限速抽象由宿主注入。
 *
 * API 契约（自 sustech_survival/nces/scraper.py 学习并实测验证）：
 *   GET /api/v1/search?q=<code|teacher>
 *     → { courses: { items: [section], total }, reviews: { items: [review] } }
 *     section: { id, name, course_code, teacher_names, term_ids:[],
 *                review_count, rate_average(0-10),
 *                difficulty_score/homework_score/grading_score/gain_score(0-100) }
 *   GET /api/v1/course/<id>/reviews → { items: [review] }（某教学班全量评价）
 *     review: { rate(1-5), content(HTML), term, upvote_count, author:{username}, publish_time }
 *   服务端限速严格：请求间隔 ≥250ms，429 指数退避。
 */

const NCES_BASE = "https://ncesnext.com";
const MIN_INTERVAL_MS = 250;
const BRIEF_TTL_MS = 6 * 3600 * 1000; // 正缓存 6h
const NEG_TTL_MS = 15 * 60 * 1000; // 未收录负缓存 15min

/* ---------------- 教师名与学期工具（移植自 scraper.py） ---------------- */

function splitTeachers(s) {
  if (!s) return [];
  return String(s)
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function nameOverlap(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function teachersOverlap(tisTeachers, ncesTeachers) {
  for (const t of tisTeachers)
    for (const n of ncesTeachers) if (nameOverlap(t, n)) return true;
  return false;
}

/** 每位 TIS 教师都能在 NCES 教师名单中找到 → 视为同一教学班 */
function exactTeamMatch(tisTeachers, ncesTeachers) {
  if (!tisTeachers.length) return true;
  return tisTeachers.every((t) => ncesTeachers.some((n) => nameOverlap(t, n)));
}

/** TIS 学年学期（xn="2026-2027", xq="1"）→ NCES term_id（"20261"） */
function tisToNcesTerm(xn, xq) {
  if (!xn || !xq) return "";
  if (String(xq) === "1") return `${String(xn).slice(0, 4)}1`;
  return `${String(xn).slice(5, 9)}${xq}`;
}

/** 页面下拉文本（"2026秋季"/"2027春季"）→ xn/xq。春夏季学期归属上一学年。 */
function termLabelToXnXq(label) {
  const m = String(label || "").match(/(20\d{2})\s*(秋|春|夏)/);
  if (!m) return null;
  const year = +m[1];
  if (m[2] === "秋") return { xn: `${year}-${year + 1}`, xq: "1" };
  if (m[2] === "春") return { xn: `${year - 1}-${year}`, xq: "2" };
  return { xn: `${year - 1}-${year}`, xq: "3" };
}

/** "20252" → "2025春" */
function termIdToDisplay(termId) {
  if (!termId || String(termId).length < 5) return termId || "";
  const season = { 1: "秋", 2: "春", 3: "夏" }[String(termId)[4]] || "";
  return `${String(termId).slice(0, 4)}${season}`;
}

/* ---------------- 维度 0-100 分 → 档位（阈值 33/67，越高越好） ---------------- */

const DIMENSIONS = [
  { key: "difficulty", field: "difficulty_score", label: "难度", low: "困难", mid: "中等", high: "简单" },
  { key: "workload", field: "homework_score", label: "作业量", low: "很大", mid: "一般", high: "很少" },
  { key: "grading", field: "grading_score", label: "给分", low: "偏严", mid: "一般", high: "友好" },
  { key: "takeaways", field: "gain_score", label: "收获", low: "较少", mid: "一般", high: "很多" },
];

function dimsFromSection(sec) {
  return DIMENSIONS.map((d) => {
    let pct = Number(sec[d.field]);
    if (!Number.isFinite(pct)) pct = null;
    let grade = null;
    if (pct !== null) grade = pct <= 33 ? d.low : pct <= 67 ? d.mid : d.high;
    return { key: d.key, label: d.label, pct, grade };
  });
}

/* ---------------- HTML 清洗 ---------------- */

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- 限速器：串行队列 + 最小间隔 + 429 退避 ---------------- */

class RateLimiter {
  constructor(minIntervalMs = MIN_INTERVAL_MS) {
    this.minIntervalMs = minIntervalMs;
    this.lastAt = 0;
    this.tail = Promise.resolve();
    this.backoffUntil = 0;
    this.n429 = 0;
  }
  submit(fn) {
    const run = async () => {
      const wait = Math.max(
        this.lastAt + this.minIntervalMs - Date.now(),
        this.backoffUntil - Date.now()
      );
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const out = await fn();
        this.n429 = 0;
        return out;
      } catch (e) {
        if (e && e.status === 429) {
          this.n429 += 1;
          this.backoffUntil = Date.now() + Math.min(30000, 1000 * 2 ** this.n429);
        }
        throw e;
      } finally {
        this.lastAt = Date.now();
      }
    };
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => {});
    return p;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { RateLimiter, NCES_BASE, splitTeachers, tisToNcesTerm, termLabelToXnXq, termIdToDisplay };

/* ---------------- 核心：查询一个 (课程代码, 教师组) 的评教摘要 ---------------- */

/**
 * @param deps {{fetchJSON: (url: string) => Promise<any>, cacheGet, cacheSet}}
 * @returns brief 或 { available:false, ... }
 */
export async function lookupBrief(deps, { code, teachers = [], termLabel = "" }) {
  code = String(code || "").trim().toUpperCase();
  teachers = (teachers || []).map((t) => String(t).trim()).filter(Boolean);
  const xnXq = termLabelToXnXq(termLabel);
  const termId = xnXq ? tisToNcesTerm(xnXq.xn, xnXq.xq) : "";
  const cacheKey = `b:${code}|${[...teachers].sort().join(",")}|${termId}`;

  const cached = await deps.cacheGet(cacheKey);
  if (cached) {
    const ttl = cached.available === false ? NEG_TTL_MS : BRIEF_TTL_MS;
    if (Date.now() - cached._t < ttl) return cached;
  }

  let brief;
  try {
    brief = await buildBrief(deps, { code, teachers, termId });
  } catch (e) {
    // 上游故障不写负缓存，下次再试
    return {
      available: false,
      error: true,
      reason: e && e.status === 429 ? "评教网站限流中，请稍候再试" : "评教网站暂时不可用",
      searchUrl: `${NCES_BASE}/search?q=${encodeURIComponent(code)}`,
    };
  }
  brief._t = Date.now();
  await deps.cacheSet(cacheKey, brief);
  return brief;
}

async function buildBrief(deps, { code, teachers, termId }) {
  // 1) 课程代码搜索（搜索接口约返回前 5 个班级，按评论量排序）
  const data = await deps.fetchJSON(`${NCES_BASE}/api/v1/search?q=${encodeURIComponent(code)}`);
  let sections = (data?.courses?.items || []).slice();
  const pool = sections.filter((s) => String(s.course_code || "").toUpperCase() === code);
  if (pool.length) sections = pool;

  // 2) 教师名增补搜索：目标教师不在前 5 时补齐其班级
  const seen = new Set(sections.map((s) => s.id));
  for (const t of teachers.slice(0, 2)) {
    let tdata;
    try {
      tdata = await deps.fetchJSON(`${NCES_BASE}/api/v1/search?q=${encodeURIComponent(t)}`);
    } catch (e) {
      if (e && e.status === 429) throw e; // 限流直接上抛，让上层稍后重试
      continue;
    }
    for (const s of tdata?.courses?.items || []) {
      if (String(s.course_code || "").toUpperCase() === code && !seen.has(s.id)) {
        sections.push(s);
        seen.add(s.id);
      }
    }
  }
  if (!sections.length) {
    return {
      available: false,
      reason: "评教网站未收录该课程",
      searchUrl: `${NCES_BASE}/search?q=${encodeURIComponent(code)}`,
    };
  }

  // 3) 选最匹配的教学班：教师重合数 → 全含 → 本学期 → 评论数（字典序）
  let best = null;
  let bestScore = null;
  for (const s of sections) {
    const nt = splitTeachers(s.teacher_names);
    const matched = teachers.filter((t) => nt.some((n) => nameOverlap(t, n))).length;
    const subset = exactTeamMatch(teachers, nt) ? 1 : 0;
    const termMatch = termId && (s.term_ids || []).includes(termId) ? 1 : 0;
    const score = [matched, subset, termMatch, Number(s.review_count) || 0];
    if (bestScore === null || lexGreaterThan(score, bestScore)) {
      bestScore = score;
      best = s;
    }
  }
  if (!best) best = sections[0];

  const ncesTeachers = splitTeachers(best.teacher_names);
  const matched = teachers.length ? exactTeamMatch(teachers, ncesTeachers) : true;
  const mismatch = teachers.length > 0 && !matched;

  // 4) 该教学班全量评价 → 点赞最高的 3 条
  let reviews = [];
  try {
    const rd = await deps.fetchJSON(`${NCES_BASE}/api/v1/course/${best.id}/reviews`);
    reviews = (rd?.items || []).map((r) => ({
      user: r?.author?.username || "匿名",
      term: termIdToDisplay(r.term),
      rate: Number(r.rate) || 0,
      likes: Number(r.upvote_count) || 0,
      text: stripHtml(r.content).slice(0, 200),
    }));
  } catch (e) {
    if (e && e.status === 429) throw e;
    reviews = (data?.reviews?.items || []).map((r) => ({
      user: r?.author?.username || "匿名",
      term: termIdToDisplay(r.term),
      rate: Number(r.rate) || 0,
      likes: Number(r.upvote_count) || 0,
      text: stripHtml(r.content).slice(0, 200),
    }));
  }
  reviews.sort((a, b) => b.likes - a.likes);
  const topReviews = reviews.slice(0, 3);

  // 5) 同课程其他教师班级（对比图数据）：需求是"当前课程各老师评分对比"，
  //    因此展示该课程代码下所有有评价的班级，不做教师重叠过滤（当前班在 UI 中高亮）。
  const alternatives = sections
    .filter((s) => s.id !== best.id)
    .filter((s) => (Number(s.review_count) || 0) > 0)
    .map((s) => ({
      ncesId: s.id,
      teacher: s.teacher_names || "未知教师",
      rating: s.rate_average == null ? null : Number(s.rate_average),
      reviewCount: Number(s.review_count) || 0,
      termIds: s.term_ids || [],
      currentTerm: termId ? (s.term_ids || []).includes(termId) : false,
      dims: dimsFromSection(s),
      url: `${NCES_BASE}/course/${s.id}/`,
    }))
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));

  return {
    available: true,
    code,
    name: best.name || "",
    ncesTeacher: best.teacher_names || "",
    tisTeachers: teachers,
    teacherMatched: matched,
    teacherMismatch: mismatch,
    termId,
    rating: best.rate_average == null ? null : Number(best.rate_average),
    reviewCount: Number(best.review_count) || 0,
    dims: dimsFromSection(best),
    currentTermIncluded: termId ? (best.term_ids || []).includes(termId) : false,
    semesters: (best.term_ids || []).slice(0, 4).map(termIdToDisplay),
    detailUrl: `${NCES_BASE}/course/${best.id}/`,
    reviews: topReviews,
    alternatives,
  };
}

function lexGreaterThan(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
