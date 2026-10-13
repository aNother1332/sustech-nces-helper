> # ⭐ 鸣谢 · Acknowledgements
>
> 本项目站在两位巨人的肩膀上，谨在最顶端向他们致敬：
>
> - 📊 **数据来源：[NCES 评教网（ncesnext.com）](https://ncesnext.com/)** —— 南科大学生自发维护的非官方课程评教网站。本扩展展示的**所有**评分、评价文字与教师对比数据，均实时来自该站点。请前往原站留下你的评价，让这个数据集继续生长。
> - 🧰 **[dumixthestpd/sustech_survival](https://github.com/dumixthestpd/sustech_survival)** —— 本扩展对 NCES JSON API 的全部调用方式（接口契约、教学班-教师匹配算法、限速与 429 退避策略）均学习自该项目 `src/sustech_survival/nces/` 模块的实现，站在它的肩膀上才得以快速落地，强烈推荐围观。
>
> *本项目与南方科技大学及 NCES 均无官方关联，仅供学习交流。*

<div align="center">

# 南科大选课评教助手 (TIS × NCES)

**选课页悬停课程行即可查看 NCES 评分、热门评价与同课程各教师评分对比；成绩页自动显示每门课排名，悬停看分项成绩，并实时展示整体学分绩排名。**

![在真实选课页面上的效果](docs/screenshots/demo-on-tis.png)

</div>

## 这是什么

南科大教务系统（TIS）选课时看不到评教网站的评分，反复切换网页非常痛苦。这个浏览器扩展（Chrome / Edge，Manifest V3）在 **「我要选课」** 与 **「加课申请」** 页面的每一条课程行上添加了「悬停即查」能力：

| 功能 | 说明 |
| --- | --- |
| ① 评分数字 | 0–10 分大数字 + 五星条 + 评价条数 + 学期覆盖范围 |
| ② 简要评价 | 点赞最高的评价（用户、学期、星级、点赞数），最多 3 条 |
| ③ 教师对比 | 同一课程代码下所有教师班级的评分横向条形图：**本班高亮置顶**、本学期绿色标记，点击行直达 NCES 课程页 |
| 四维画像 | 难度 / 作业量 / 给分 / 收获，0–100 档位条 |
| 防误导 | 教务教师与评教数据对不上时显示黄色提醒，绝不张冠李戴 |

| 完整卡片 | 加载骨架 | 未收录空态 |
| --- | --- | --- |
| ![完整卡片](docs/screenshots/demo-data.png) | ![加载骨架](docs/screenshots/demo-loading.png) | ![未收录](docs/screenshots/demo-notfound.png) |

## 成绩页功能（v1.1 新增）

在「业务查询 → 个人成绩查询」页面自动生效：

| 功能 | 说明 |
| --- | --- |
| **排名列** | 为每门课注入「排名/总人数」列（如 `12/60`），教学班前 10% 绿色高亮。该数据后端接口一直返回，官方前端只是没有渲染 |
| **悬停看分项** | 悬停任意课程行，卡片显示总评成绩、等级、排名（含百分位）+ 作业/期中/期末/quiz 等分项成绩与占比 |
| **整体学分绩胶囊** | 页面左下角实时显示平均学分绩点与排名（如 `3.85 · 12/120`），悬停展开学期绩点明细 |

![成绩页：排名列 + 整体学分绩胶囊](docs/screenshots/grade-overview.png)

| 悬停看分项成绩 | 整体学分绩明细 |
| --- | --- |
| ![分项成绩卡](docs/screenshots/grade-fx-card.png) | ![整体学分绩卡](docs/screenshots/grade-gpa-card.png) |

> **有趣发现**：官方「绩点排名查询」页会请求 `POST /cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj`，但框架给请求注入了值为 null 的 `RoleCode` 请求头，后端因此返回空 JSON（页面显示"暂无数据"）。插件显式不携带该头即可拿到真实数据——这可能就是学校页面上"排名看不到"的原因之一，供校方参考。

## 安装

1. 下载本仓库（`Code → Download ZIP`，解压）。
2. 打开 `edge://extensions`（Edge）或 `chrome://extensions`（Chrome）。
3. 打开右上角 **「开发人员模式 / Developer mode」**。
4. 点 **「加载解压缩的扩展 / Load unpacked」**，选择解压出的 `sustech-nces-helper` 文件夹。
5. 刷新教务系统选课页面即可。**无需登录 NCES。**

> 浏览器启动时如提示"请停用开发者模式扩展"，点忽略即可，不影响使用。

## 使用

- 进入 选课系统 → 我要选课（或 加课申请），查询出课程列表后，**鼠标悬停任意课程行**：
  约 0.15 秒后卡片以骨架态出现，评分数据 1–3 秒内填充；同一门课再次悬停**立即显示**（本地缓存 6 小时）。
- 进入 业务查询 → 个人成绩查询：表格自动多出「排名」列；**悬停任意课程行**查看分项成绩；左下角胶囊显示整体学分绩，悬停展开学期明细。
- 点击课程行空白处也能打开卡片；`Esc`、滚动页面、点击空白处关闭。
- 卡片内可选中文字；点击教师对比行在新标签打开该班级的 NCES 页面。

## 实现思路

```
content.js (页面注入, 每个 iframe 自治)
│  事件委托监听 tr.ivu-table-row 的 hover —— 一次绑定,
│  对 iView 表格的查询/翻页/切页签重渲染天然免疫
│  按表头名「课程代码 / 课程名称 / 上课信息」对齐列(无视列序),
│  提取 代码 + 教师名(上课信息列的 <a> 链接) + 学期
│
├─ chrome.runtime.sendMessage ──────────────► background.js (MV3 service worker)
│                                              │  chrome.storage 缓存: 命中 6h / 未收录 15min
│                                              │  250ms 串行限速 + 429 指数退避(尊重对方站点)
│                                              ▼
│                                          nces-core.js (纯逻辑, Node 可测)
│                                              │  GET ncesnext.com/api/v1/search?q=<课程代码>
│                                              │  GET /api/v1/search?q=<教师名>  (补齐前5名之外的班级)
│                                              │  GET /api/v1/course/<id>/reviews (全量评价→点赞Top3)
│                                              │  教师团队逐名匹配选班: 教师重合→全含→本学期→评论数
│                                              ▼
└─ card.js ◄────────────────────────────────  brief: 评分/维度/评价/同课程各教师班级
   Shadow DOM 毛玻璃卡片(Apple 风格),
   暗色模式 / 减动效 / 减透明度适配, 全 textContent 构建无 XSS

grade.js (成绩页注入 /cjgl/grcjcx/go/*, 与选课页同一套卡片组件)
│  POST /cjgl/grcjcx/grcjcx          → 每门课 排名(pm)/总人数(zrs) → 注入「排名」列
│  POST /cjgl/grcjcx/seeFx           → 行悬停 → 分项成绩卡
│  POST /cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj → 左下角 绩点/排名 胶囊
│  行对齐: 「学期+课程代码+总评成绩」内容匹配(对筛选/排序/翻页免疫);
│  MutationObserver 兜底: 查询/翻页/窗口变化后自动补注入
```

几个关键决策：

- **交互选型**：对比过三种方案——① hover 悬浮窗、② 点击横栏、③ 行内加按钮。行点击与页面原生操作（课程详情链接、选课/购物车按钮）冲突，行内按钮需 MutationObserver 对抗 iView 高频重渲染且侵入布局；hover 用事件委托一次绑定即可，零侵入，故选 ①（另加"点击行空白处"兜底）。
- **响应速度**：NCES 单次搜索实测约 1.3s，完整数据 2–4 次串行请求。首查 1–3s 期间先显示骨架卡保证"即时出现"的观感；双层缓存（内存 + `chrome.storage.local`）让二次悬停 0ms。
- **列解析**：iView 表格每列有随机类名 `ivu-table-column-XXXX`，表头与单元格共享同一 token。按"表头文字 → token → 单元格"对齐，列顺序变化、固定列、隐藏列都天然正确。绝不能缓存这个映射——iView 重建表头会换 token（踩过的坑）。
- **排名列不是"抓"出来的**：成绩接口本就返回 `pm`（排名）与 `zrs`（总人数），官方表格没有渲染；插件按内容把 DOM 行与接口记录对齐（对筛选/排序/翻页免疫），并把记录挂在行元素上供悬停取用。
- **悬停状态自愈**：卡片被滚动 / Esc / 窗口失焦关闭时，指针可能并未真正离开影子宿主，会把「鼠标在卡片内」标志卡死，导致后续悬停全部失灵——用 `host.matches(':hover')` 实测校正 +「同一行但卡片已不在则重新调度」（修过的真实 bug）。
- **绝不张冠李戴**：沿用 sustech_survival 的匹配纪律——教务教师团队必须每一位都能在 NCES 班级教师名单中找到，才认定是同一班级；找不到就亮黄色提醒，而不是拿别人班级的分数冒充。
- **学期映射**：页面"2026秋季"→ TIS `xn=2026-2027, xq=1` → NCES `term_id=20261`；春夏季学期归属上一学年。

## 目录结构

```
sustech-nces-helper/
├── manifest.json      # MV3 清单（content_scripts 命中 tis.sustech.edu.cn，all_frames）
├── background.js      # service worker：消息路由 / 缓存 / 限速
├── nces-core.js       # NCES 数据核心（纯逻辑，Node 可直接测试）
├── content.js         # 选课页注入：行识别 / hover / 卡片生命周期
├── grade.js           # 成绩页注入：排名列 / 分项成绩卡 / 整体绩点胶囊
├── card.js            # 悬浮卡片（Shadow DOM，Apple 风格，暗色模式 & 减动效适配）
├── icons/             # 扩展图标
├── tools/             # 图标生成 & 本地演示服务器（非运行时依赖）
└── DEMO/              # 视觉验收 mock 页（非运行时依赖）
```

## 本地开发

```bash
# 生成图标（零依赖，手写 PNG 编码）
node tools/gen-icons.js

# 起本地演示页，可视化调整卡片（http://127.0.0.1:8811/）
node tools/serve-demo.js

# 直接在 Node 里测试 NCES 数据链路（不装扩展也能调）
node --input-type=module -e "import('./nces-core.js').then(async m => {
  const fetchJSON = async (u) => (await fetch(u)).json();
  console.log(await m.lookupBrief({ fetchJSON, cacheGet: async()=>null, cacheSet: async()=>{} },
    { code: 'IPE112', teachers: ['杨晗旭'], termLabel: '2026秋季' }));
})"
```

## 隐私

- 不收集、不上传任何数据；评教查询不携带任何身份信息，教务系统 Cookie 不会被读取或转发。
- 仅本地缓存查询结果（`chrome.storage.local`）。

## 免责声明

评分与评价均来自第三方非官方站点 [ncesnext.com](https://ncesnext.com/)，仅供选课参考，请理性看待。因使用本扩展造成的任何选课后果由使用者自行承担。

## License

[MIT](LICENSE)
