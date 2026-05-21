const state = {
  projects: [],
  baseProjects: [],
  sourceLabel: "Local project data",
  refreshTimer: null,
  filters: {
    search: "",
    unit: "All",
    status: "All",
    hideEmpty: true,
    issueOnly: false
  },
  activeTab: "overview"
};

const statuses = ["Done", "In Progress", "Blocked", "Not Start"];
const palette = ["#2364aa", "#0f766e", "#b7791f", "#6251a8", "#bb2d3b", "#667085"];
const statusColors = {
  "Done": "#13795b",
  "In Progress": "#2364aa",
  "Blocked": "#bb2d3b",
  "Not Start": "#8a94a6"
};
const severityRank = { critical: 4, high: 3, medium: 2, info: 1, low: 0 };
const severityLabel = { critical: "Critical", high: "High", medium: "Medium", info: "Info", low: "Low" };
const statusClassMap = {
  "Done": "done",
  "In Progress": "progress",
  "Blocked": "blocked",
  "Not Start": "not-start"
};

const money = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0
});
const compact = new Intl.NumberFormat("th-TH", {
  notation: "compact",
  maximumFractionDigits: 1
});

const $ = id => document.getElementById(id);
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));
const near = (a, b, tolerance = 1) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const pct = (num, den) => den ? num / den : 0;
const safeWidth = value => `${Math.max(2, Math.min(100, value * 100))}%`;
const formatPct = value => `${Math.round((value || 0) * 100)}%`;
const statusClass = status => statusClassMap[status] || "system";
const issueTone = issues => {
  const top = issues.reduce((current, issue) => severityRank[issue.severity] > severityRank[current] ? issue.severity : current, "low");
  return top;
};

function toNumber(value, percent = false) {
  const text = clean(value);
  if (!text || text.includes("#")) return null;
  const negative = text.includes("-");
  const stripped = text.replace(/[฿,%\s]/g, "").replace("-", "");
  if (!/\d/.test(stripped)) return null;
  const parsed = Number(stripped);
  if (Number.isNaN(parsed)) return null;
  const normalized = percent ? parsed / 100 : parsed;
  return negative ? -normalized : normalized;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeReportCsv(csvText) {
  const rows = parseCsv(csvText);
  const projects = [];
  const statusSet = new Set(statuses);
  let businessUnit = "Unassigned";
  rows.forEach((rawRow, rowIndex) => {
    const values = [...rawRow.map(clean), ...Array(30).fill("")];
    const looksLikeUnit = values[3] && !statusSet.has(values[4]) && !values[1] && !values[2] && !values[5] && !values[7];
    if (looksLikeUnit) {
      businessUnit = values[3];
      return;
    }
    if (!statusSet.has(values[4])) return;
    const project = {
      sourceRow: rowIndex + 1,
      businessUnit,
      projectNumber: values[1],
      projectCode: values[2],
      projectName: values[3] || "(ยังไม่ระบุชื่อ)",
      status: values[4],
      startDateText: values[5],
      endDateText: values[6],
      revenuePlan: toNumber(values[7]) || 0,
      revenueActual: toNumber(values[8]) || 0,
      revenueDiffSource: toNumber(values[9]),
      cashReceived: toNumber(values[10]) || 0,
      cashDiffSource: toNumber(values[11]),
      note: values[12],
      costPlan: toNumber(values[13]) || 0,
      costActual: toNumber(values[14]) || 0,
      costDiffSource: toNumber(values[15]),
      costPctPlanSource: toNumber(values[16], true),
      costPctActualSource: toNumber(values[17], true),
      profitPlan: toNumber(values[18]) || 0,
      profitActual: toNumber(values[19]) || 0,
      profitDiffSource: toNumber(values[20]),
      marginPlanSource: toNumber(values[21], true),
      marginActualSource: toNumber(values[22], true)
    };
    project.isPlaceholder = isEmptyProject(project);
    projects.push(project);
  });
  return projects;
}

function cloneProjects(projects) {
  return JSON.parse(JSON.stringify(projects));
}

function isEmptyProject(project) {
  const nameBlank = !project.projectName || project.projectName === "(ยังไม่ระบุชื่อ)";
  return Boolean(
    project.isPlaceholder ||
    (nameBlank &&
      !project.projectCode &&
      !project.revenuePlan &&
      !project.revenueActual &&
      !project.cashReceived &&
      !project.costPlan &&
      !project.costActual &&
      !project.profitPlan &&
      !project.profitActual)
  );
}

function totals(rows) {
  const revenuePlan = sum(rows, "revenuePlan");
  const revenueActual = sum(rows, "revenueActual");
  const cashReceived = sum(rows, "cashReceived");
  const costActual = sum(rows, "costActual");
  const profitPlan = sum(rows, "profitPlan");
  const profitActual = sum(rows, "profitActual");
  const recomputedProfitActual = revenueActual - costActual;
  const recomputedProfitPlan = revenuePlan - sum(rows, "costPlan");
  return {
    revenuePlan,
    revenueActual,
    cashReceived,
    costActual,
    profitPlan,
    profitActual,
    recomputedProfitActual,
    recomputedProfitPlan,
    revenueGap: revenueActual - revenuePlan,
    collectionGap: cashReceived - revenueActual,
    revenueProgress: pct(revenueActual, revenuePlan),
    cashCoverage: pct(cashReceived, revenueActual),
    reportedMargin: pct(profitActual, revenueActual),
    recomputedMargin: pct(recomputedProfitActual, revenueActual),
    profitGap: recomputedProfitActual - profitActual
  };
}

function projectIssues(project) {
  const issues = [];
  const add = (severity, title, detail, impact = 0) => {
    issues.push({
      severity,
      title,
      detail,
      impact,
      project,
      sourceRow: project.sourceRow
    });
  };
  const actualMinusPlan = project.revenueActual - project.revenuePlan;
  const cashMinusActual = project.cashReceived - project.revenueActual;
  const costPlanMinusActual = project.costPlan - project.costActual;
  const profitActualMinusPlan = project.profitActual - project.profitPlan;

  if (isEmptyProject(project)) {
    add("info", "Blank placeholder row", "แถวนี้ไม่มีชื่อ/code และไม่มีมูลค่า อาจไม่ควรนับเป็น active project");
    return issues;
  }
  if (!project.projectName || project.projectName === "(ยังไม่ระบุชื่อ)") {
    add("info", "Missing project name", "ควรใส่ชื่อ project เพื่อให้ dashboard อ่านง่าย");
  }
  if (project.cashDiffSource !== null && !near(project.cashDiffSource, cashMinusActual)) {
    add(
      "critical",
      "Cash variance formula mismatch",
      `ช่อง source cash diff = ${money.format(project.cashDiffSource)} แต่ cash - actual revenue ควรเป็น ${money.format(cashMinusActual)}`,
      Math.abs(cashMinusActual - project.cashDiffSource)
    );
  }
  if (project.costDiffSource !== null && !near(project.costDiffSource, costPlanMinusActual)) {
    add(
      "medium",
      "Cost variance formula mismatch",
      `ช่อง source cost diff ไม่ตรงกับ planned cost - actual cost`,
      Math.abs(costPlanMinusActual - project.costDiffSource)
    );
  }
  if (project.revenueDiffSource !== null && !near(project.revenueDiffSource, actualMinusPlan) && !near(project.revenueDiffSource, -actualMinusPlan)) {
    add(
      "medium",
      "Revenue variance formula mismatch",
      `ช่อง source revenue diff ไม่ตรงกับ actual-plan หรือ plan-actual`,
      Math.abs(actualMinusPlan - project.revenueDiffSource)
    );
  }
  if (project.revenueActual > 0 && !near(project.profitActual, project.revenueActual - project.costActual)) {
    add(
      "critical",
      "Actual profit does not reconcile",
      `reported profit = ${money.format(project.profitActual)} แต่ revenue - cost = ${money.format(project.revenueActual - project.costActual)}`,
      Math.abs(project.profitActual - (project.revenueActual - project.costActual))
    );
  }
  if (project.revenuePlan > 0 && (project.costPlan > 0 || project.profitPlan > 0) && !near(project.profitPlan, project.revenuePlan - project.costPlan)) {
    add(
      "high",
      "Planned profit does not reconcile",
      `planned profit = ${money.format(project.profitPlan)} แต่ planned revenue - planned cost = ${money.format(project.revenuePlan - project.costPlan)}`,
      Math.abs(project.profitPlan - (project.revenuePlan - project.costPlan))
    );
  }
  if (project.profitDiffSource !== null && !near(project.profitDiffSource, profitActualMinusPlan) && !near(project.profitDiffSource, -profitActualMinusPlan)) {
    add("medium", "Profit variance formula mismatch", "ช่อง source profit diff ไม่ตรงกับ actual-plan หรือ plan-actual", Math.abs(profitActualMinusPlan - project.profitDiffSource));
  }
  if (project.marginActualSource !== null && project.revenueActual > 0 && !near(project.marginActualSource, pct(project.profitActual, project.revenueActual), 0.002)) {
    add("medium", "Actual margin mismatch", "margin ใน source ไม่ตรงกับ profit / revenue", project.revenueActual);
  }
  if (project.costPctActualSource !== null && project.revenueActual > 0 && !near(project.costPctActualSource, pct(project.costActual, project.revenueActual), 0.002)) {
    add("medium", "Actual cost percent mismatch", "cost % ใน source ไม่ตรงกับ cost / revenue", project.revenueActual);
  }
  if (project.status === "Blocked" && project.revenuePlan > 0) {
    add("high", "Blocked project with planned revenue", "มี revenue อยู่ในแผนแต่งานติด block", project.revenuePlan);
  }
  if (project.status === "In Progress" && project.revenuePlan > 0 && project.revenueActual === 0) {
    add("medium", "In progress with no actual revenue", "มี planned revenue แต่ยังไม่เกิด actual revenue", project.revenuePlan);
  }
  if (project.revenueActual > 0 && project.cashReceived === 0) {
    add(project.status === "Done" ? "high" : "medium", "Cash not recorded", "มี actual revenue แล้วแต่ cash ยังเป็นศูนย์", project.revenueActual);
  }
  if (project.revenueActual > 0 && project.cashReceived < project.revenueActual) {
    add("medium", "Cash collection gap", `เงินเข้ายังขาด ${money.format(project.revenueActual - project.cashReceived)} จาก actual revenue`, project.revenueActual - project.cashReceived);
  }
  if (project.revenueActual > 0 && project.cashReceived > project.revenueActual) {
    add("info", "Cash exceeds revenue", "cash มากกว่า actual revenue อาจมี VAT, advance payment, หรือ timing difference", project.cashReceived - project.revenueActual);
  }
  if (project.revenueActual > 0 && project.costActual === 0) {
    add("medium", "Cost actual missing", "มี actual revenue แล้วแต่ cost actual ยังเป็นศูนย์", project.revenueActual);
  }
  if (project.revenueActual > 0 && pct(project.profitActual, project.revenueActual) >= 0.9) {
    add("info", "Very high margin", "margin สูงมาก ควรตรวจว่า cost ถูกกรอกครบหรือยัง", project.revenueActual);
  }
  return issues;
}

function validationPackage(rows) {
  const rowIssues = rows.flatMap(projectIssues);
  const profitModes = new Set();
  rows.forEach(project => {
    if (project.profitDiffSource === null || project.profitDiffSource === 0) return;
    const diff = project.profitActual - project.profitPlan;
    if (near(project.profitDiffSource, diff)) profitModes.add("Actual-Plan");
    if (near(project.profitDiffSource, -diff)) profitModes.add("Plan-Actual");
  });
  const globalIssues = [];
  if (profitModes.size > 1) {
    globalIssues.push({
      severity: "high",
      title: "Profit variance sign is inconsistent",
      detail: `source profit diff ใช้ทั้ง ${[...profitModes].join(" และ ")} ในไฟล์เดียวกัน`,
      impact: 0,
      project: { projectName: "Source formulas", businessUnit: "Global", projectCode: "" },
      sourceRow: "-"
    });
  }
  const issues = [...globalIssues, ...rowIssues].sort((a, b) => {
    const rank = severityRank[b.severity] - severityRank[a.severity];
    return rank || Math.abs(b.impact || 0) - Math.abs(a.impact || 0);
  });
  const counts = {
    critical: issues.filter(issue => issue.severity === "critical").length,
    high: issues.filter(issue => issue.severity === "high").length,
    medium: issues.filter(issue => issue.severity === "medium").length,
    info: issues.filter(issue => issue.severity === "info").length
  };
  const deduction =
    Math.min(38, counts.critical * 7) +
    Math.min(26, counts.high * 5) +
    Math.min(22, counts.medium * 2) +
    Math.min(8, counts.info * 0.75);
  const score = Math.max(0, Math.round(100 - deduction));
  return { issues, score };
}

function visibleProjects() {
  const search = state.filters.search.toLowerCase();
  return state.projects.filter(project => {
    if (state.filters.hideEmpty && isEmptyProject(project)) return false;
    if (state.filters.unit !== "All" && project.businessUnit !== state.filters.unit) return false;
    if (state.filters.status !== "All" && project.status !== state.filters.status) return false;
    if (search) {
      const haystack = [project.projectName, project.projectCode, project.businessUnit, project.status].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (state.filters.issueOnly && projectIssues(project).filter(issue => issue.severity !== "info").length === 0) return false;
    return true;
  });
}

function renderFilterOptions() {
  const units = [...new Set(state.projects.map(project => project.businessUnit))].sort();
  $("unitFilter").innerHTML = [`<option value="All">All units</option>`, ...units.map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`)].join("");
  $("statusFilter").innerHTML = [`<option value="All">All status</option>`, ...statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)].join("");
}

function renderFilterSummary(rows) {
  const labels = [];
  if (state.filters.search) labels.push(`Search: ${state.filters.search}`);
  if (state.filters.unit !== "All") labels.push(`Unit: ${state.filters.unit}`);
  if (state.filters.status !== "All") labels.push(`Status: ${state.filters.status}`);
  if (state.filters.hideEmpty) labels.push("Hide blank rows");
  if (state.filters.issueOnly) labels.push("Issue-only");
  $("filterSummary").textContent = `${rows.length} visible projects`;
  $("filterChips").innerHTML = (labels.length ? labels : ["All projects"]).map(label => `<span class="chip">${escapeHtml(label)}</span>`).join("");
}

function renderHealth(rows, validation) {
  const t = totals(rows);
  const cards = [
    ["Revenue actual", money.format(t.revenueActual), `${formatPct(t.revenueProgress)} ของแผน`, t.revenueProgress >= 0.9 ? "good" : t.revenueProgress >= 0.7 ? "warn" : "bad", "revenue"],
    ["Revenue gap", money.format(Math.abs(t.revenueGap)), t.revenueGap >= 0 ? "เกินแผน" : "ต่ำกว่าแผน", t.revenueGap >= 0 ? "good" : "bad", "gap"],
    ["Cash received", money.format(t.cashReceived), `${formatPct(t.cashCoverage)} ของ actual`, t.cashCoverage >= 0.9 ? "good" : t.cashCoverage >= 0.7 ? "warn" : "bad", "cash"],
    ["Reported profit", money.format(t.profitActual), `margin ${formatPct(t.reportedMargin)}`, Math.abs(t.profitGap) <= 1 ? "good" : "bad", "profit"],
    ["Data quality", `${validation.score}/100`, `${validation.issues.length} issues`, validation.score >= 85 ? "good" : validation.score >= 65 ? "warn" : "bad", "quality"]
  ];
  $("healthGrid").innerHTML = cards.map(([label, value, detail, tone, accent]) => `
    <article class="health-card accent-${accent}">
      <label>${label}</label>
      <strong>${value}</strong>
      <span class="delta ${tone}">${detail}</span>
    </article>
  `).join("");
}

function renderGoalFocus(rows) {
  const t = totals(rows);
  const progress = Math.max(0, Math.min(1.2, t.revenueProgress));
  const gap = Math.max(0, t.revenuePlan - t.revenueActual);
  const over = Math.max(0, t.revenueActual - t.revenuePlan);
  const remainingPct = Math.max(0, 1 - Math.min(1, t.revenueProgress));
  const gapProjects = [...rows]
    .map(project => ({
      ...project,
      gap: Math.max(0, (project.revenuePlan || 0) - (project.revenueActual || 0))
    }))
    .filter(project => project.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 6);
  const maxGap = Math.max(...gapProjects.map(project => project.gap), 1);
  const units = [...rows.reduce((map, project) => {
    const item = map.get(project.businessUnit) || { name: project.businessUnit, plan: 0, actual: 0 };
    item.plan += project.revenuePlan || 0;
    item.actual += project.revenueActual || 0;
    map.set(project.businessUnit, item);
    return map;
  }, new Map()).values()].sort((a, b) => (b.plan - b.actual) - (a.plan - a.actual)).slice(0, 4);
  const unitMax = Math.max(...units.map(unit => Math.max(unit.plan, unit.actual)), 1);

  $("goalGapBadge").className = `pill ${gap ? "bad" : "good"}`;
  $("goalGapBadge").textContent = gap ? `ต้องเติม ${money.format(gap)}` : `เกินเป้า ${money.format(over)}`;
  $("goalFocus").innerHTML = `
    <div class="goal-layout">
      <div class="goal-hero">
        <div class="goal-ring" style="--goal-progress:${Math.min(100, progress * 100)}%">
          <div>
            <strong>${formatPct(t.revenueProgress)}</strong>
            <span>ของเป้ารายได้</span>
          </div>
        </div>
        <div class="goal-copy">
          <span class="goal-kicker">Revenue Goal</span>
          <h3>${money.format(t.revenuePlan)}</h3>
          <p>ทำได้แล้ว <b>${money.format(t.revenueActual)}</b> เหลืออีก <b>${money.format(gap)}</b> หรือ ${formatPct(remainingPct)} ของเป้า</p>
          <div class="goal-meter">
            <span class="actual" style="width:${safeWidth(Math.min(1, t.revenueProgress))}"></span>
            <span class="gap" style="width:${safeWidth(remainingPct)}"></span>
          </div>
          <div class="goal-scale">
            <span>Actual ${compact.format(t.revenueActual)}</span>
            <span>Goal ${compact.format(t.revenuePlan)}</span>
          </div>
        </div>
      </div>

      <div class="goal-side">
        <div>
          <h3>ต้องเติมจากตรงไหนก่อน</h3>
          <p class="muted">เรียงจาก gap ระหว่าง planned revenue กับ actual revenue</p>
        </div>
        <div class="gap-list">
          ${gapProjects.map(project => `
            <div class="gap-row">
              <div class="gap-name">
                <b>${escapeHtml(project.projectName)}</b>
                <span>${escapeHtml(project.businessUnit)} · ${escapeHtml(project.status)}</span>
              </div>
              <div class="gap-track">
                <span style="width:${safeWidth(project.gap / maxGap)}"></span>
              </div>
              <strong>${compact.format(project.gap)}</strong>
            </div>
          `).join("") || `<div class="empty">ไม่มี revenue gap ใน filter นี้</div>`}
        </div>
      </div>
    </div>

    <div class="unit-goal-grid">
      ${units.map(unit => {
        const unitGap = Math.max(0, unit.plan - unit.actual);
        return `
          <div class="unit-goal-card">
            <div>
              <b>${escapeHtml(unit.name)}</b>
              <span>${formatPct(pct(unit.actual, unit.plan))} ของเป้า</span>
            </div>
            <div class="unit-bars">
              <div class="unit-bar plan"><span style="width:${safeWidth(unit.plan / unitMax)}"></span></div>
              <div class="unit-bar actual"><span style="width:${safeWidth(unit.actual / unitMax)}"></span></div>
            </div>
            <strong>${unitGap ? `เติม ${compact.format(unitGap)}` : "ถึงเป้าแล้ว"}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderWaterfall(rows) {
  const t = totals(rows);
  const width = 820;
  const height = 310;
  const base = 228;
  const max = Math.max(t.revenuePlan, t.revenueActual, t.cashReceived, t.profitActual, 1);
  const barHeight = value => Math.max(4, Math.round((Math.max(0, value) / max) * 160));
  const bars = [
    ["Planned", t.revenuePlan, 46, "#9aa8bf", "แผนรายได้"],
    ["Actual", t.revenueActual, 246, "#2364aa", formatPct(t.revenueProgress)],
    ["Cash", t.cashReceived, 446, "#0f766e", formatPct(t.cashCoverage)],
    ["Profit", t.profitActual, 646, "#13795b", `${formatPct(t.reportedMargin)} margin`]
  ];
  const barMarkup = bars.map(([label, value, x, color, note]) => {
    const h = barHeight(value);
    return `
      <rect x="${x}" y="${base - h}" width="112" height="${h}" rx="8" fill="${color}"></rect>
      <text x="${x + 56}" y="${base + 25}" text-anchor="middle" class="chart-label">${label}</text>
      <text x="${x + 56}" y="${base - h - 12}" text-anchor="middle" class="chart-label">${compact.format(value)}</text>
      <text x="${x + 56}" y="${base + 43}" text-anchor="middle" class="chart-note">${note}</text>
    `;
  }).join("");
  $("waterfallChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Money journey waterfall">
      <line x1="28" y1="${base}" x2="790" y2="${base}" stroke="#cbd3df"></line>
      <path d="M158 ${base - barHeight(t.revenuePlan)} C204 ${base - barHeight(t.revenuePlan)} 204 ${base - barHeight(t.revenueActual)} 246 ${base - barHeight(t.revenueActual)}" fill="none" stroke="#cbd3df" stroke-width="2" stroke-dasharray="6 6"></path>
      <path d="M358 ${base - barHeight(t.revenueActual)} C404 ${base - barHeight(t.revenueActual)} 404 ${base - barHeight(t.cashReceived)} 446 ${base - barHeight(t.cashReceived)}" fill="none" stroke="#cbd3df" stroke-width="2" stroke-dasharray="6 6"></path>
      ${barMarkup}
      <g>
        <rect x="178" y="34" width="142" height="54" rx="8" fill="#ffe2e6"></rect>
        <text x="249" y="55" text-anchor="middle" class="chart-label" fill="#bb2d3b">ขาดจากแผน</text>
        <text x="249" y="76" text-anchor="middle" class="chart-label" fill="#bb2d3b">${money.format(Math.max(0, -t.revenueGap))}</text>
      </g>
      <g>
        <rect x="378" y="34" width="142" height="54" rx="8" fill="#fff2cf"></rect>
        <text x="449" y="55" text-anchor="middle" class="chart-label" fill="#b7791f">เงินยังไม่เข้า</text>
        <text x="449" y="76" text-anchor="middle" class="chart-label" fill="#b7791f">${money.format(Math.max(0, -t.collectionGap))}</text>
      </g>
    </svg>
  `;
  const trust = Math.abs(t.profitGap) <= 1;
  $("profitTrustBadge").className = `pill ${trust ? "good" : "bad"}`;
  $("profitTrustBadge").textContent = trust ? "Profit reconciles" : "Profit needs review";
  $("storyCards").innerHTML = [
    [`${formatPct(t.revenueProgress)}`, "รายได้จริงเทียบแผน"],
    [`${formatPct(t.cashCoverage)}`, "เงินเข้าเทียบ actual revenue"],
    [money.format(Math.max(0, -t.collectionGap)), "เงินที่ยังไม่เข้า"],
    [money.format(Math.abs(t.profitGap)), "ส่วนต่าง reported vs recomputed profit"]
  ].map(([value, label]) => `<div class="story-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderMix(rows) {
  const grouped = Map.groupBy ? Map.groupBy(rows, row => row.businessUnit) : rows.reduce((map, row) => {
    const list = map.get(row.businessUnit) || [];
    list.push(row);
    map.set(row.businessUnit, list);
    return map;
  }, new Map());
  const data = [...grouped.entries()].map(([name, items], index) => ({
    name,
    value: sum(items, "revenueActual"),
    color: palette[index % palette.length]
  })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((acc, item) => acc + item.value, 0);
  let cursor = 0;
  const gradient = data.length ? data.map(item => {
    const start = cursor;
    const end = cursor + pct(item.value, total) * 100;
    cursor = end;
    return `${item.color} ${start}% ${end}%`;
  }).join(", ") : "#dce2eb 0% 100%";
  $("mixDonut").style.background = `conic-gradient(${gradient})`;
  $("mixCenter").innerHTML = data[0]
    ? `<strong>${formatPct(pct(data[0].value, total))}</strong><span>${escapeHtml(data[0].name)}</span>`
    : `<strong>0%</strong><span>No revenue</span>`;
  $("mixLegend").innerHTML = data.map(item => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${item.color}"></span>
      <span class="legend-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span class="legend-value">${formatPct(pct(item.value, total))} · ${compact.format(item.value)}</span>
    </div>
  `).join("") || `<div class="empty">ยังไม่มี actual revenue ใน filter นี้</div>`;
}

function renderFunnel(rows) {
  const t = totals(rows);
  const max = Math.max(t.revenuePlan, t.revenueActual, t.cashReceived, t.profitActual, 1);
  const stages = [
    ["Planned", t.revenuePlan, "#7d8797", "เป้ารายได้"],
    ["Actual", t.revenueActual, "#2364aa", "เกิดรายได้แล้ว"],
    ["Cash", t.cashReceived, "#0f766e", "เงินเข้าจริง"],
    ["Profit", t.profitActual, "#13795b", "กำไรที่รายงาน"]
  ];
  $("funnelChart").innerHTML = stages.map(([label, value, color, note]) => {
    const inset = Math.round((1 - Math.min(1, value / max)) * 52);
    return `
      <div class="funnel-stage" style="--inset:${inset}px; --tone:${color}">
        <div><strong>${label}</strong><span>${note}</span></div>
        <b>${compact.format(value)}</b>
      </div>
    `;
  }).join("");
}

function renderBubble(rows) {
  const data = rows.filter(project => project.revenuePlan > 0 || project.revenueActual > 0);
  const width = 820;
  const height = 330;
  const left = 60;
  const top = 28;
  const right = 24;
  const bottom = 52;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const maxValue = Math.max(...data.map(project => Math.max(project.revenuePlan, project.revenueActual)), 1);
  const xFor = project => left + Math.min(1.2, Math.max(0, project.revenuePlan ? project.revenueActual / project.revenuePlan : 1.2)) / 1.2 * plotW;
  const yFor = project => top + (1 - Math.min(1.15, Math.max(0, project.revenueActual ? project.cashReceived / project.revenueActual : 0)) / 1.15) * plotH;
  const circles = data.map(project => {
    const value = Math.max(project.revenuePlan, project.revenueActual);
    const radius = 5 + Math.sqrt(value / maxValue) * 24;
    const label = `${project.projectName}: actual ${money.format(project.revenueActual)}, cash ${money.format(project.cashReceived)}`;
    return `
      <circle cx="${xFor(project).toFixed(1)}" cy="${yFor(project).toFixed(1)}" r="${radius.toFixed(1)}" fill="${statusColors[project.status] || "#667085"}" fill-opacity="0.68" stroke="#fff" stroke-width="2">
        <title>${escapeHtml(label)}</title>
      </circle>
    `;
  }).join("");
  const labels = [...data].sort((a, b) => Math.max(b.revenuePlan, b.revenueActual) - Math.max(a.revenuePlan, a.revenueActual)).slice(0, 5).map(project => `
    <text x="${xFor(project).toFixed(1)}" y="${(yFor(project) - 14).toFixed(1)}" text-anchor="middle" class="chart-note">${escapeHtml(project.projectName).slice(0, 18)}</text>
  `).join("");
  $("bubbleChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Project risk map">
      <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" rx="8" fill="#f2f5fa"></rect>
      <line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#bac4d3"></line>
      <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#bac4d3"></line>
      <line x1="${left + plotW * (1 / 1.2)}" y1="${top}" x2="${left + plotW * (1 / 1.2)}" y2="${top + plotH}" stroke="#13795b" stroke-dasharray="5 5"></line>
      <line x1="${left}" y1="${top + plotH * (1 - 1 / 1.15)}" x2="${left + plotW}" y2="${top + plotH * (1 - 1 / 1.15)}" stroke="#13795b" stroke-dasharray="5 5"></line>
      ${[0, 0.5, 1, 1.2].map(value => `<text x="${left + (value / 1.2) * plotW}" y="${height - 20}" text-anchor="middle" class="axis-label">${Math.round(value * 100)}%</text>`).join("")}
      ${[0, 0.5, 1].map(value => `<text x="46" y="${top + (1 - value / 1.15) * plotH + 4}" text-anchor="end" class="axis-label">${Math.round(value * 100)}%</text>`).join("")}
      <text x="${left + plotW / 2}" y="${height - 3}" text-anchor="middle" class="chart-note">Actual revenue / planned revenue</text>
      <text x="15" y="${top + plotH / 2}" text-anchor="middle" class="chart-note" transform="rotate(-90 15 ${top + plotH / 2})">Cash / actual revenue</text>
      ${circles}
      ${labels}
    </svg>
    <div class="legend-list">
      <div class="legend-row">${statuses.map(status => `<span><span class="legend-dot" style="background:${statusColors[status]}"></span> ${status}</span>`).join(" ")}</div>
    </div>
  `;
}

function renderValidation(rows, validation) {
  $("qualityScore").className = `score ${validation.score >= 85 ? "good" : validation.score >= 65 ? "warn" : "bad"}`;
  $("qualityScore").textContent = validation.score;
  const t = totals(rows);
  const critical = validation.issues.filter(issue => issue.severity === "critical").length;
  const high = validation.issues.filter(issue => issue.severity === "high").length;
  $("validationSummary").innerHTML = [
    [`${critical} critical`, "สูตรหรือตัวเลขที่ทำให้ profit/cash อ่านผิดได้"],
    [`${high} high`, "ประเด็นที่ควรถูกคุยก่อนใช้ตัวเลขใน meeting"],
    [money.format(t.profitGap), "reported profit ต่างจาก recomputed profit"],
    [`${rows.length} rows`, "จำนวนรายการที่อยู่ใน filter ปัจจุบัน"]
  ].map(([title, detail]) => `<div class="summary-item"><span class="severity ${critical ? "critical" : "info"}">${escapeHtml(title)}</span><div><b>${escapeHtml(detail)}</b><span>อัปเดตตาม filter และ input/edit ทันที</span></div></div>`).join("");
  const grouped = new Map();
  validation.issues.forEach(issue => {
    const project = issue.project;
    const key = `${project.sourceRow || "global"}|${project.projectCode || ""}|${project.projectName}`;
    if (!grouped.has(key)) {
      grouped.set(key, { project, issues: [] });
    }
    grouped.get(key).issues.push(issue);
  });
  const cards = [...grouped.values()]
    .sort((a, b) => severityRank[issueTone(b.issues)] - severityRank[issueTone(a.issues)] || b.issues.length - a.issues.length)
    .slice(0, 24)
    .map(group => {
      const project = group.project;
      const topSeverity = issueTone(group.issues);
      const impact = group.issues.reduce((total, issue) => total + Math.abs(issue.impact || 0), 0);
      const status = project.status || "System";
      const issueRows = group.issues.slice(0, 8).map(issue => `
        <div class="validation-issue">
          <span class="severity ${issue.severity}">${severityLabel[issue.severity]}</span>
          <div>
            <b>${escapeHtml(issue.title)}</b>
            <p>${escapeHtml(issue.detail)}</p>
          </div>
          <strong>${issue.impact ? money.format(issue.impact) : "-"}</strong>
        </div>
      `).join("");
      return `
        <article class="validation-project severity-card-${topSeverity}">
          <header class="validation-project-head">
            <div>
              <div class="project-title">${escapeHtml(project.projectName)}</div>
              <div class="project-sub">${escapeHtml(project.businessUnit || "Global")} ${project.projectCode ? `· ${escapeHtml(project.projectCode)}` : ""} ${project.sourceRow ? `· row ${project.sourceRow}` : ""}</div>
            </div>
            <div class="validation-badges">
              <span class="status-badge status-${statusClass(status)}">${escapeHtml(status)}</span>
              <span class="severity ${topSeverity}">${group.issues.length} issues</span>
              <span class="impact-badge">${impact ? money.format(impact) : "Formula"}</span>
            </div>
          </header>
          <div class="validation-issue-list">${issueRows}</div>
        </article>
      `;
    }).join("");
  $("validationProjectGroups").innerHTML = cards || `<div class="empty">ไม่พบ validation issue ใน filter นี้</div>`;
}

function renderWatchlist(validation) {
  const cards = validation.issues
    .filter(issue => issue.severity !== "info")
    .slice(0, 8)
    .map(issue => `
      <article class="watch-card">
        <div class="watch-meta">
          <span class="severity ${issue.severity}">${severityLabel[issue.severity]}</span>
          <span class="status-badge status-${statusClass(issue.project.status || "System")}">${escapeHtml(issue.project.status || "System")}</span>
          <span>${issue.impact ? money.format(issue.impact) : "Formula"}</span>
        </div>
        <div>
          <b>${escapeHtml(issue.project.projectName)}</b>
          <span>${escapeHtml(issue.title)} · ${escapeHtml(issue.detail)}</span>
        </div>
      </article>
    `).join("");
  $("watchCards").innerHTML = cards || `<div class="empty">ไม่มีรายการสำคัญใน filter นี้</div>`;
}

function renderInput(rows) {
  $("visibleCount").textContent = `${rows.length} rows`;
  $("inputRows").innerHTML = rows.map(project => {
    const index = state.projects.indexOf(project);
    const issueCount = projectIssues(project).filter(issue => issue.severity !== "info").length;
    return `
      <tr>
        <td>${escapeHtml(project.businessUnit)}</td>
        <td>${escapeHtml(project.projectCode || "-")}</td>
        <td><input value="${escapeHtml(project.projectName)}" data-index="${index}" data-field="projectName"></td>
        <td>
          <select data-index="${index}" data-field="status">
            ${statuses.map(status => `<option value="${escapeHtml(status)}" ${project.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
          </select>
          <div class="input-status"><span class="status-badge status-${statusClass(project.status)}">${escapeHtml(project.status)}</span></div>
        </td>
        <td><input type="number" step="1000" value="${project.revenuePlan}" data-index="${index}" data-field="revenuePlan"></td>
        <td><input type="number" step="1000" value="${project.revenueActual}" data-index="${index}" data-field="revenueActual"></td>
        <td><input type="number" step="1000" value="${project.cashReceived}" data-index="${index}" data-field="cashReceived"></td>
        <td><input type="number" step="1000" value="${project.costActual}" data-index="${index}" data-field="costActual"></td>
        <td><input type="number" step="1000" value="${project.profitActual}" data-index="${index}" data-field="profitActual"></td>
        <td><span class="severity ${issueCount ? "high" : "low"}">${issueCount ? `${issueCount} issues` : "OK"}</span></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="10"><div class="empty">ไม่มีรายการใน filter นี้</div></td></tr>`;
}

function renderAll() {
  const rows = visibleProjects();
  const validation = validationPackage(rows);
  renderFilterSummary(rows);
  renderGoalFocus(rows);
  renderHealth(rows, validation);
  renderWaterfall(rows);
  renderMix(rows);
  renderFunnel(rows);
  renderBubble(rows);
  renderValidation(rows, validation);
  renderWatchlist(validation);
  renderInput(rows);
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab-btn").forEach(button => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

function updateSourceUi(label) {
  state.sourceLabel = label;
  $("sourceLabel").textContent = label;
  $("lastUpdated").textContent = `อัปเดตล่าสุด ${new Date().toLocaleString("th-TH")}`;
}

async function loadLocalData() {
  const response = await fetch("./data/projects.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load local data (${response.status})`);
  const payload = await response.json();
  state.projects = cloneProjects(payload.projects);
  state.baseProjects = cloneProjects(payload.projects);
  renderFilterOptions();
  updateSourceUi("Local project data");
  renderAll();
}

async function loadCsvUrl() {
  const url = $("sheetUrl").value.trim();
  if (!url) return;
  $("lastUpdated").textContent = "กำลัง sync CSV...";
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`);
  if (!response.ok) throw new Error(`Cannot load CSV (${response.status})`);
  const csvText = await response.text();
  const projects = normalizeReportCsv(csvText);
  state.projects = cloneProjects(projects);
  state.baseProjects = cloneProjects(projects);
  renderFilterOptions();
  updateSourceUi("Google Sheet CSV");
  renderAll();
}

function setAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  if ($("autoRefresh").checked) {
    state.refreshTimer = setInterval(() => {
      loadCsvUrl().catch(error => {
        $("lastUpdated").textContent = `Auto refresh error: ${error.message}`;
      });
    }, 60000);
  }
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    sourceLabel: state.sourceLabel,
    projects: state.projects
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-dashboard-projects.json";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  document.querySelectorAll(".collapse-btn").forEach(button => {
    button.addEventListener("click", () => {
      const target = $(button.dataset.collapseTarget);
      if (!target) return;
      target.classList.toggle("collapsed");
      const expanded = !target.classList.contains("collapsed");
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = expanded ? "Minimize" : "Expand";
    });
  });
  $("toggleFilters").addEventListener("click", () => {
    $("filterShell").classList.toggle("compact");
    const expanded = !$("filterShell").classList.contains("compact");
    $("toggleFilters").setAttribute("aria-expanded", String(expanded));
    $("toggleFilters").textContent = expanded ? "Minimize" : "Expand";
  });
  $("searchBox").addEventListener("input", event => {
    state.filters.search = event.target.value;
    renderAll();
  });
  $("unitFilter").addEventListener("change", event => {
    state.filters.unit = event.target.value;
    renderAll();
  });
  $("statusFilter").addEventListener("change", event => {
    state.filters.status = event.target.value;
    renderAll();
  });
  $("hideEmpty").addEventListener("change", event => {
    state.filters.hideEmpty = event.target.checked;
    renderAll();
  });
  $("issueOnly").addEventListener("change", event => {
    state.filters.issueOnly = event.target.checked;
    renderAll();
  });
  $("inputRows").addEventListener("input", event => {
    const target = event.target;
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    if (!field || Number.isNaN(index) || !state.projects[index]) return;
    const numericFields = new Set(["revenuePlan", "revenueActual", "cashReceived", "costActual", "profitActual"]);
    state.projects[index][field] = numericFields.has(field) ? Number(target.value || 0) : target.value;
    state.projects[index].isPlaceholder = isEmptyProject(state.projects[index]);
    renderAll();
  });
  $("inputRows").addEventListener("change", event => {
    const target = event.target;
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    if (!field || Number.isNaN(index) || !state.projects[index]) return;
    state.projects[index][field] = target.value;
    renderAll();
  });
  $("jumpInput").addEventListener("click", () => {
    switchTab("projects");
    $("inputSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("jumpValidation").addEventListener("click", () => {
    switchTab("validation");
    $("validationSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("resetData").addEventListener("click", () => {
    state.projects = cloneProjects(state.baseProjects);
    renderAll();
  });
  $("loadSheet").addEventListener("click", () => {
    loadCsvUrl().catch(error => {
      $("lastUpdated").textContent = `Sync error: ${error.message}`;
    });
  });
  $("autoRefresh").addEventListener("change", setAutoRefresh);
  $("exportJson").addEventListener("click", exportJson);
}

bindEvents();
switchTab("overview");
loadLocalData().catch(error => {
  $("lastUpdated").textContent = error.message;
});
