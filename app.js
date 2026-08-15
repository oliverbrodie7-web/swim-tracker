/* Swim tracker. Plain JavaScript, no build step. */
"use strict";

/* ---------- Config ---------- */

const SUPABASE_URL = "https://wifuhcqpmvixipxejanb.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpZnVoY3FwbXZpeGlweGVqYW5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MjY4ODcsImV4cCI6MjA5NTQwMjg4N30.J_tn3C8N5VBXaqrpvhRDy4R_xnDWPiDQs02Tlj5IOV8";
const REST = SUPABASE_URL + "/rest/v1/swims";

const GOAL_METRES = 100000;
const PLAN_START = "2026-08-01";

/* Week end date, target metres, label. Weeks end on the Sunday. */
const PLAN = [
  ["2026-08-09", 3775, ""],
  ["2026-08-16", 3000, ""],
  ["2026-08-23", 3000, ""],
  ["2026-08-30", 3000, ""],
  ["2026-09-06", 3000, ""],
  ["2026-09-13", 3000, ""],
  ["2026-09-20", 3000, ""],
  ["2026-09-27", 3000, ""],
  ["2026-10-04", 10000, "BIG"],
  ["2026-10-11", 2000, "easy"],
  ["2026-10-18", 3000, ""],
  ["2026-10-25", 3000, ""],
  ["2026-11-01", 3000, ""],
  ["2026-11-08", 3000, ""],
  ["2026-11-15", 3000, ""],
  ["2026-11-22", 10000, "BIG"],
  ["2026-11-29", 3000, ""],
  ["2026-12-06", 0, "reserve"],
  ["2026-12-13", 0, "reserve"],
  ["2026-12-20", 0, "reserve"],
  ["2026-12-27", 0, "reserve"],
  ["2026-12-31", 0, "reserve"]
];

const CACHE_KEY = "swim-cache-v1";
const QUEUE_KEY = "swim-queue-v1";

/* ---------- State ---------- */

let swims = [];
let queue = [];
let flushing = false;
let editingId = null;
let selectedRpe = null;
let expandedId = null;
let confirmingDeleteId = null;
let chartsDirty = true;
const chartObjs = {};

/* ---------- Date helpers. swim_date stays a plain YYYY-MM-DD string, never UTC parsed. ---------- */

function pad2(n) { return String(n).padStart(2, "0"); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function parseLocal(s) {
  const p = s.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function dateToStr(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function addDays(s, n) {
  const d = parseLocal(s);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

function daysBetween(a, b) {
  return Math.round((parseLocal(b) - parseLocal(a)) / 86400000);
}

/* Week ending Sunday for any date */
function sundayFor(s) {
  const d = parseLocal(s);
  const dow = d.getDay();
  if (dow !== 0) d.setDate(d.getDate() + (7 - dow));
  return dateToStr(d);
}

function fmtDateShort(s) {
  const d = parseLocal(s);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + " " + months[d.getMonth()];
}

function fmtDateLong(s) {
  const d = parseLocal(s);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[d.getDay()] + " " + fmtDateShort(s) + " " + d.getFullYear();
}

function fmtDateFull(s) {
  const d = parseLocal(s);
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
}

/* ---------- Formatting ---------- */

function fmtKm(m, dp) {
  if (dp === undefined) dp = 1;
  return (m / 1000).toFixed(dp);
}

function fmtMetres(m) {
  return m.toLocaleString("en-AU");
}

function fmtPace(secPer100) {
  if (!isFinite(secPer100) || secPer100 <= 0) return "";
  const s = Math.round(secPer100);
  return Math.floor(s / 60) + ":" + pad2(s % 60);
}

function fmtDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + ":" + pad2(m) + ":" + pad2(s);
  return m + ":" + pad2(s);
}

/* Time entry works on digits alone so the numeric keypad is enough.
   Read right to left: last two digits are seconds, next two are minutes,
   anything left over is hours. A typed colon is accepted and ignored. */

function timeDigits(str) {
  return String(str == null ? "" : str).replace(/\D/g, "").slice(0, 6);
}

function digitsToParts(digits) {
  if (!digits) return null;
  return {
    s: parseInt(digits.slice(-2), 10),
    m: digits.length > 2 ? parseInt(digits.slice(-4, -2), 10) : 0,
    h: digits.length > 4 ? parseInt(digits.slice(0, -4), 10) : 0
  };
}

function partsToSeconds(p) {
  return p.h * 3600 + p.m * 60 + p.s;
}

/* Minutes and seconds each have to sit under 60 */
function partsValid(p) {
  return !!p && p.s <= 59 && p.m <= 59 && partsToSeconds(p) > 0;
}

/* Drop the leading zero on minutes when there is no hours part */
function formatParts(p) {
  if (!p) return "";
  if (p.h > 0) return p.h + ":" + pad2(p.m) + ":" + pad2(p.s);
  return p.m + ":" + pad2(p.s);
}

/* null for empty, NaN for an impossible time, otherwise seconds */
function parseTimeInput(str) {
  const digits = timeDigits(str);
  if (!digits) return null;
  const p = digitsToParts(digits);
  if (!partsValid(p)) return NaN;
  return partsToSeconds(p);
}

/* ---------- Storage ---------- */

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) swims = JSON.parse(raw);
  } catch (e) { swims = []; }
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) queue = JSON.parse(raw);
  } catch (e) { queue = []; }
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(swims)); } catch (e) {}
}

function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {}
}

/* ---------- Supabase ---------- */

function sbHeaders(extra) {
  const h = {
    apikey: ANON_KEY,
    Authorization: "Bearer " + ANON_KEY,
    "Content-Type": "application/json"
  };
  if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  return h;
}

async function fetchAllSwims() {
  const res = await fetch(REST + "?select=*&order=swim_date.desc,created_at.desc", {
    headers: sbHeaders()
  });
  if (!res.ok) throw new Error("Fetch failed with status " + res.status);
  return res.json();
}

/* Merge server rows with anything still waiting in the queue */
function applyQueueTo(rows) {
  let out = rows.slice();
  queue.forEach(function (op) {
    if (op.type === "insert") {
      if (!out.some(function (r) { return r.id === op.row.id; })) {
        out.push(Object.assign({}, op.row, { pending: true }));
      }
    } else if (op.type === "update") {
      out = out.map(function (r) {
        return r.id === op.rowId ? Object.assign({}, r, op.body, { pending: true }) : r;
      });
    } else if (op.type === "delete") {
      out = out.filter(function (r) { return r.id !== op.rowId; });
    }
  });
  out.sort(function (a, b) {
    if (a.swim_date !== b.swim_date) return a.swim_date < b.swim_date ? 1 : -1;
    return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
  });
  return out;
}

async function runOp(op) {
  if (op.type === "insert") {
    const body = Object.assign({}, op.row);
    delete body.pending;
    delete body.created_at;
    const res = await fetch(REST, {
      method: "POST",
      headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("Insert failed " + res.status);
  } else if (op.type === "update") {
    const res = await fetch(REST + "?id=eq." + op.rowId, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(op.body)
    });
    if (!res.ok) throw new Error("Update failed " + res.status);
  } else if (op.type === "delete") {
    const res = await fetch(REST + "?id=eq." + op.rowId, {
      method: "DELETE",
      headers: sbHeaders()
    });
    if (!res.ok) throw new Error("Delete failed " + res.status);
  }
}

async function flushQueue() {
  if (flushing || queue.length === 0 || !navigator.onLine) { updateSyncStatus(); return; }
  flushing = true;
  updateSyncStatus();
  while (queue.length > 0) {
    try {
      await runOp(queue[0]);
      queue.shift();
      saveQueue();
    } catch (e) {
      break;
    }
  }
  flushing = false;
  if (queue.length === 0) {
    try {
      const rows = await fetchAllSwims();
      swims = rows;
      saveCache();
      chartsDirty = true;
      renderAll();
    } catch (e) {}
  }
  updateSyncStatus();
}

function enqueue(op) {
  queue.push(op);
  saveQueue();
  swims = applyQueueTo(swims.filter(function (r) { return !r.pending; }));
  saveCache();
  chartsDirty = true;
  renderAll();
  flushQueue();
}

async function refreshFromServer(showToastMsg) {
  const btn = document.getElementById("refreshBtn");
  btn.classList.add("spinning");
  try {
    const rows = await fetchAllSwims();
    swims = applyQueueTo(rows);
    saveCache();
    chartsDirty = true;
    renderAll();
    if (showToastMsg) showToast("Up to date", true);
  } catch (e) {
    if (showToastMsg) showToast("Could not reach the server, showing saved data");
  }
  btn.classList.remove("spinning");
  updateSyncStatus();
  flushQueue();
}

/* ---------- Sync status ---------- */

function updateSyncStatus() {
  const el = document.getElementById("syncStatus");
  el.classList.remove("sync-saved", "sync-queued", "sync-syncing");
  if (flushing) {
    el.textContent = "Syncing";
    el.classList.add("sync-syncing");
  } else if (queue.length > 0) {
    el.textContent = "Queued";
    el.classList.add("sync-queued");
  } else {
    el.textContent = "Saved";
    el.classList.add("sync-saved");
  }
}

/* ---------- Maths ---------- */

function computeStats() {
  const today = todayStr();
  let total = 0, baseline = 0;
  const clean = swims;
  clean.forEach(function (s) {
    total += s.metres;
    if (s.swim_date < PLAN_START) baseline += s.metres;
  });

  /* Plan weeks with done amounts. First plan week also covers 1 and 2 August. */
  let cum = baseline;
  const weeks = PLAN.map(function (w, i) {
    const end = w[0];
    const start = i === 0 ? PLAN_START : addDays(PLAN[i - 1][0], 1);
    cum += w[1];
    let done = 0;
    clean.forEach(function (s) {
      if (s.swim_date >= start && s.swim_date <= end) done += s.metres;
    });
    return { start: start, end: end, target: w[1], label: w[2], cumTarget: cum, done: done };
  });

  const currentWeek = weeks.find(function (w) { return today >= w.start && today <= w.end; }) || null;

  /* Expected by the most recent completed week */
  let expected = baseline;
  weeks.forEach(function (w) {
    if (w.end < today) expected = w.cumTarget;
  });

  /* Interpolated expectation for the lane marker */
  let laneExpected = expected;
  if (currentWeek) {
    const dayN = daysBetween(currentWeek.start, today) + 1;
    const len = daysBetween(currentWeek.start, currentWeek.end) + 1;
    laneExpected = expected + currentWeek.target * (dayN / len);
  }

  return {
    today: today,
    total: total,
    baseline: baseline,
    weeks: weeks,
    currentWeek: currentWeek,
    expected: expected,
    laneExpected: laneExpected,
    diff: total - expected
  };
}

/* ---------- Rendering: dashboard ---------- */

function renderDashboard(st) {
  document.getElementById("totalKm").textContent = fmtKm(st.total);
  document.getElementById("statLeft").textContent = fmtKm(Math.max(0, GOAL_METRES - st.total));
  document.getElementById("statLaps").textContent = Math.round(st.total / 25).toLocaleString("en-AU");
  document.getElementById("statSwims").textContent = swims.length;

  renderLane(st);

  const badge = document.getElementById("planBadge");
  const diffKm = Math.abs(st.diff) / 1000;
  const diffTxt = diffKm.toFixed(1);
  if (st.diff >= 0) {
    badge.textContent = diffTxt + " km ahead of plan";
    badge.className = "pill pill-sage";
  } else {
    badge.textContent = diffTxt + " km behind plan";
    badge.className = "pill pill-terra";
  }

  renderWeekCard(st);
}

function renderLane(st) {
  const W = 1000, H = 130;
  const swumX = Math.min(W, (st.total / GOAL_METRES) * W);
  const planX = Math.min(W, (st.laneExpected / GOAL_METRES) * W);

  let discs = "";
  const colours = ["#C2693F", "#D38A2E", "#EFE3D3", "#EFE3D3"];
  for (let x = 10; x < W; x += 25) {
    const c = colours[Math.floor(x / 25) % colours.length];
    discs += '<circle cx="' + x + '" cy="12" r="6" fill="' + c + '"/>';
    discs += '<circle cx="' + x + '" cy="118" r="6" fill="' + c + '"/>';
  }

  let ticks = "";
  for (let i = 1; i < 10; i++) {
    const x = (W / 10) * i;
    ticks += '<line x1="' + x + '" y1="26" x2="' + x + '" y2="104" stroke="#E7DACA" stroke-width="2"/>';
    ticks += '<text x="' + x + '" y="72" text-anchor="middle" font-size="20" fill="#CBBBA4" font-family="Figtree, sans-serif" font-weight="600">' + (i * 10) + "</text>";
  }

  const fill = swumX > 4
    ? '<rect x="0" y="26" width="' + swumX + '" height="78" rx="8" fill="#C2693F" opacity="0.9"/>'
    : "";

  const marker =
    '<rect x="' + Math.max(2, planX - 2.5) + '" y="20" width="5" height="90" rx="2.5" fill="#37302B"/>';

  const svg =
    '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lane showing ' + fmtKm(st.total) + ' of 100 km swum">' +
    '<rect x="0" y="24" width="' + W + '" height="82" rx="10" fill="#FDF8F0" stroke="#E7DACA" stroke-width="2"/>' +
    ticks + fill + marker + discs +
    "</svg>";

  document.getElementById("lane").innerHTML = svg;
}

function renderWeekCard(st) {
  const card = document.getElementById("weekCard");
  const w = st.currentWeek;
  if (!w) {
    card.innerHTML = '<p class="eyebrow">This week</p><p class="muted">The plan runs from August to December 2026.</p>';
    return;
  }
  const remaining = Math.max(0, w.target - w.done);
  const pct = w.target > 0 ? Math.min(100, (w.done / w.target) * 100) : (w.done > 0 ? 100 : 0);
  const hit = w.target > 0 && w.done >= w.target;

  let tag = "";
  if (w.label === "BIG") tag = '<span class="tag tag-big">Big week</span>';
  else if (w.label === "easy") tag = '<span class="tag tag-easy">Easy week</span>';
  else if (w.label === "reserve") tag = '<span class="tag tag-reserve">Reserve</span>';

  let html =
    '<p class="eyebrow">This week</p>' +
    '<div class="week-head"><span class="week-title">Ends Sunday ' + fmtDateShort(w.end) + "</span>" + tag + "</div>" +
    '<div class="week-nums">' +
    '<div class="stat"><span class="stat-num">' + fmtMetres(w.target) + '</span><span class="stat-label">target m</span></div>' +
    '<div class="stat"><span class="stat-num">' + fmtMetres(w.done) + '</span><span class="stat-label">done m</span></div>' +
    '<div class="stat"><span class="stat-num">' + fmtMetres(remaining) + '</span><span class="stat-label">remaining m</span></div>' +
    "</div>" +
    '<div class="progress-track"><div class="progress-fill' + (hit ? " full" : "") + '" style="width:' + pct + '%"></div></div>';

  if (hit) html += '<p class="week-done-msg">Week done, nice work</p>';
  else if (w.target === 0 && w.done > 0) html += '<p class="week-done-msg">Bonus metres in a reserve week</p>';

  card.innerHTML = html;
}

/* ---------- Rendering: swim list ---------- */

function paceFor(s) {
  if (!s.time_seconds || !s.metres) return null;
  return (s.time_seconds / s.metres) * 100;
}

function renderSwimList() {
  const ul = document.getElementById("swimList");
  if (swims.length === 0) {
    ul.innerHTML = '<li class="swim-detail" style="padding:14px 8px">No swims yet. Log your first one.</li>';
    return;
  }
  ul.innerHTML = swims.map(function (s) {
    const pace = paceFor(s);
    const expanded = expandedId === s.id;
    let meta = "";
    if (s.unbroken_metres) meta += "<span>" + fmtKm(s.unbroken_metres, 2) + " km unbroken</span>";
    if (pace) meta += "<span>" + fmtPace(pace) + " /100 m</span>";
    if (s.rpe != null && s.rpe !== "") {
      const cls = Number(s.rpe) >= 8 ? "rpe-high" : "rpe-low";
      meta += '<span class="rpe-badge ' + cls + '">' + Number(s.rpe) + "</span>";
    }
    if (s.pending) meta += '<span class="pending-dot" title="Waiting to sync"></span>';

    let detail = "";
    if (expanded) {
      let bits = "<p><strong>" + fmtDateLong(s.swim_date) + "</strong></p>";
      bits += "<p>" + fmtMetres(s.metres) + " m, " + Math.round(s.metres / 25) + " laps";
      if (s.time_seconds) bits += ", " + fmtDuration(s.time_seconds) + " total";
      if (pace) bits += ", " + fmtPace(pace) + " per 100 m";
      bits += "</p>";
      if (s.unbroken_metres) bits += "<p>Longest unbroken: " + fmtMetres(s.unbroken_metres) + " m</p>";
      if (s.warm_up) bits += "<p>Warm up: " + escapeHtml(s.warm_up) + "</p>";
      if (s.notes) bits += "<p>" + escapeHtml(s.notes) + "</p>";
      const delConfirming = confirmingDeleteId === s.id;
      detail =
        '<div class="swim-detail">' + bits +
        '<div class="row-actions">' +
        '<button type="button" class="row-btn" data-edit="' + s.id + '">Edit</button>' +
        '<button type="button" class="row-btn row-btn-danger' + (delConfirming ? " confirming" : "") + '" data-del="' + s.id + '">' +
        (delConfirming ? "Tap again to delete" : "Delete") + "</button>" +
        "</div></div>";
    }

    return (
      '<li class="swim-row">' +
      '<button type="button" class="swim-row-main" data-row="' + s.id + '" aria-expanded="' + expanded + '">' +
      '<span class="swim-date">' + fmtDateShort(s.swim_date) + "</span>" +
      '<span class="swim-km">' + fmtKm(s.metres, 2) + " km</span>" +
      '<span class="swim-meta">' + meta + "</span>" +
      "</button>" + detail + "</li>"
    );
  }).join("");
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- Rendering: plan ---------- */

function renderPlan(st) {
  document.getElementById("planBaseline").textContent = fmtKm(st.baseline);
  const ul = document.getElementById("planList");
  ul.innerHTML = st.weeks.map(function (w) {
    const isCurrent = st.currentWeek && w.end === st.currentWeek.end;
    const past = w.end < st.today;
    const hit = w.target > 0 && w.done >= w.target;
    const missed = past && w.target > 0 && w.done < w.target;

    let tags = "";
    if (w.label === "BIG") tags += '<span class="tag tag-big">Big</span>';
    if (w.label === "easy") tags += '<span class="tag tag-easy">Easy</span>';
    if (w.label === "reserve") tags += '<span class="tag tag-reserve">Reserve</span>';
    if (hit) tags += '<span class="plan-tick" aria-label="Target hit">&#10003;</span>';
    if (missed) tags += '<span class="tag tag-short">Short</span>';

    return (
      '<li class="plan-row' + (isCurrent ? " current" : "") + '">' +
      '<span class="plan-date">' + fmtDateShort(w.end) + "</span>" +
      tags +
      '<span class="plan-nums">' +
      "<span>" + fmtMetres(w.target) + " m target</span>" +
      "<span>" + fmtMetres(w.done) + " m done</span>" +
      '<span class="plan-cum">' + fmtKm(w.cumTarget) + " km</span>" +
      "</span></li>"
    );
  }).join("");
}

/* ---------- Rendering: insights ---------- */

const CHART_FONT = "Figtree, sans-serif";

function chartDefaults() {
  if (typeof Chart === "undefined") return false;
  Chart.defaults.font.family = CHART_FONT;
  Chart.defaults.color = "#7A6F63";
  Chart.defaults.borderColor = "#E7DACA";
  return true;
}

function killChart(id) {
  if (chartObjs[id]) { chartObjs[id].destroy(); delete chartObjs[id]; }
}

function renderInsights(st) {
  renderProjection(st);
  renderPersonalBest();
  renderRecords(st);

  if (!chartDefaults()) {
    document.querySelectorAll(".chart-box").forEach(function (b) {
      b.innerHTML = '<p class="muted" style="padding-top:80px;text-align:center">Charts need an internet connection the first time the app loads.</p>';
    });
    return;
  }

  const asc = swims.slice().sort(function (a, b) {
    return a.swim_date < b.swim_date ? -1 : 1;
  });

  /* Cumulative actual vs plan */
  let run = 0;
  const actualPts = asc.map(function (s) {
    run += s.metres;
    return { x: s.swim_date, y: run / 1000 };
  });
  const planPts = [{ x: PLAN_START, y: st.baseline / 1000 }].concat(
    st.weeks.map(function (w) { return { x: w.end, y: w.cumTarget / 1000 }; })
  );
  const labels = [];
  killChart("chartCumulative");
  chartObjs.chartCumulative = new Chart(document.getElementById("chartCumulative"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "Swum",
          data: actualPts,
          borderColor: "#C2693F",
          backgroundColor: "rgba(194,105,63,0.12)",
          fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2.5
        },
        {
          label: "Plan",
          data: planPts,
          borderColor: "#37302B",
          borderDash: [6, 5],
          fill: false, tension: 0, pointRadius: 0, borderWidth: 1.8
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: "category", labels: buildDateAxis(actualPts, planPts), ticks: { maxTicksLimit: 6, callback: axisDateTick } },
        y: { title: { display: true, text: "km" }, beginAtZero: true, max: 105 }
      },
      parsing: { xAxisKey: "x", yAxisKey: "y" },
      plugins: { legend: { labels: { boxWidth: 14 } } }
    }
  });

  /* Pace trend */
  const paced = asc.filter(function (s) { return paceFor(s); });
  killChart("chartPace");
  chartObjs.chartPace = new Chart(document.getElementById("chartPace"), {
    type: "line",
    data: {
      labels: paced.map(function (s) { return s.swim_date; }),
      datasets: [{
        label: "Pace per 100 m",
        data: paced.map(function (s) { return paceFor(s); }),
        borderColor: "#D38A2E",
        backgroundColor: "#D38A2E",
        tension: 0.25, pointRadius: 3, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 6, callback: axisDateTick } },
        y: { ticks: { callback: function (v) { return fmtPace(v); } } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function (c) { return fmtPace(c.parsed.y) + " per 100 m"; } } }
      }
    }
  });

  /* Unbroken trend */
  const unb = asc.filter(function (s) { return s.unbroken_metres; });
  killChart("chartUnbroken");
  chartObjs.chartUnbroken = new Chart(document.getElementById("chartUnbroken"), {
    type: "line",
    data: {
      labels: unb.map(function (s) { return s.swim_date; }),
      datasets: [{
        label: "Longest unbroken m",
        data: unb.map(function (s) { return s.unbroken_metres; }),
        borderColor: "#6F8F5E",
        backgroundColor: "rgba(111,143,94,0.15)",
        fill: true, tension: 0.25, pointRadius: 3, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 6, callback: axisDateTick } },
        y: { beginAtZero: true, title: { display: true, text: "metres" } }
      },
      plugins: { legend: { display: false } }
    }
  });

  /* Weekly volume, last 12 weeks */
  const weekTotals = {};
  swims.forEach(function (s) {
    const wk = sundayFor(s.swim_date);
    weekTotals[wk] = (weekTotals[wk] || 0) + s.metres;
  });
  const thisSunday = sundayFor(st.today);
  const weekLabels = [], weekVals = [];
  for (let i = 11; i >= 0; i--) {
    const wk = addDays(thisSunday, -7 * i);
    weekLabels.push(fmtDateShort(wk));
    weekVals.push((weekTotals[wk] || 0) / 1000);
  }
  killChart("chartWeekly");
  chartObjs.chartWeekly = new Chart(document.getElementById("chartWeekly"), {
    type: "bar",
    data: {
      labels: weekLabels,
      datasets: [{
        label: "km",
        data: weekVals,
        backgroundColor: "#C2693F",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: true, title: { display: true, text: "km" } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function buildDateAxis(a, b) {
  const set = {};
  a.forEach(function (p) { set[p.x] = true; });
  b.forEach(function (p) { set[p.x] = true; });
  return Object.keys(set).sort();
}

function axisDateTick(value) {
  const label = this.getLabelForValue ? this.getLabelForValue(value) : value;
  return typeof label === "string" && /^\d{4}-\d{2}-\d{2}$/.test(label) ? fmtDateShort(label) : label;
}

function renderProjection(st) {
  const card = document.getElementById("projectionCard");
  const remaining = GOAL_METRES - st.total;
  if (remaining <= 0) {
    card.innerHTML = '<h2 class="card-title">Projection</h2><p class="projection-big projection-good">Goal reached, 100 km done</p>';
    return;
  }
  const cutoff = addDays(st.today, -28);
  let recent = 0;
  swims.forEach(function (s) {
    if (s.swim_date > cutoff && s.swim_date <= st.today) recent += s.metres;
  });
  const perWeek = recent / 4;
  let html = '<h2 class="card-title">Projection</h2>';
  if (perWeek < 100) {
    html += '<p class="muted">Not enough recent swimming to project a finish date yet. Log a few swims and check back.</p>';
  } else {
    const weeksLeft = remaining / perWeek;
    const finish = addDays(st.today, Math.ceil(weeksLeft * 7));
    const beats = finish <= "2026-12-31";
    html +=
      '<p class="projection-big ' + (beats ? "projection-good" : "projection-bad") + '">' + fmtDateLong(finish) + "</p>" +
      '<p class="muted">At your rolling 4 week average of ' + fmtKm(perWeek) + " km per week, you reach 100 km " +
      (beats ? "before 31 December. On track." : "after 31 December. Time to build the weeks up.") + "</p>";
  }
  card.innerHTML = html;
}

/* Fastest swim of exactly 2000 m that has a recorded time.
   Anything not exactly 2000 m, or with no time, is ignored. */
function renderPersonalBest() {
  const card = document.getElementById("pbCard");
  const title = '<h2 class="card-title">2 km personal best</h2>';
  let best = null;
  swims.forEach(function (s) {
    if (Number(s.metres) !== 2000) return;
    if (s.time_seconds == null || Number(s.time_seconds) <= 0) return;
    if (!best || Number(s.time_seconds) < Number(best.time_seconds)) best = s;
  });
  if (!best) {
    card.innerHTML = title + '<p class="muted">No 2 km swim with a recorded time yet.</p>';
    return;
  }
  const pace = (Number(best.time_seconds) / 2000) * 100;
  card.innerHTML = title +
    '<p class="pb-time">' + fmtDuration(Number(best.time_seconds)) + "</p>" +
    '<p class="pb-sub">Set on ' + fmtDateFull(best.swim_date) + "</p>" +
    '<p class="pb-sub">' + fmtPace(pace) + " per 100 m</p>";
}

function renderRecords(st) {
  const card = document.getElementById("recordsCard");
  if (swims.length === 0) {
    card.innerHTML = '<h2 class="card-title">Records</h2><p class="muted">No swims yet.</p>';
    return;
  }
  let longest = null, unbroken = null, fastest = null;
  swims.forEach(function (s) {
    if (!longest || s.metres > longest.metres) longest = s;
    if (s.unbroken_metres && (!unbroken || s.unbroken_metres > unbroken.unbroken_metres)) unbroken = s;
    const p = paceFor(s);
    if (p && (!fastest || p < paceFor(fastest))) fastest = s;
  });
  const weekTotals = {};
  swims.forEach(function (s) {
    const wk = sundayFor(s.swim_date);
    weekTotals[wk] = (weekTotals[wk] || 0) + s.metres;
  });
  let bigWeek = null;
  Object.keys(weekTotals).forEach(function (wk) {
    if (!bigWeek || weekTotals[wk] > weekTotals[bigWeek]) bigWeek = wk;
  });

  function rec(val, label, date) {
    return '<div class="record"><span class="record-val">' + val + '</span><span class="record-label">' + label +
      '</span>' + (date ? '<span class="record-date">' + fmtDateShort(date) + "</span>" : "") + "</div>";
  }

  card.innerHTML =
    '<h2 class="card-title">Records</h2><div class="records-grid">' +
    rec(fmtKm(longest.metres, 2) + " km", "Longest swim", longest.swim_date) +
    (unbroken ? rec(fmtMetres(unbroken.unbroken_metres) + " m", "Longest unbroken", unbroken.swim_date) : rec("None yet", "Longest unbroken", null)) +
    (fastest ? rec(fmtPace(paceFor(fastest)) + " /100 m", "Fastest pace", fastest.swim_date) : rec("None yet", "Fastest pace", null)) +
    (bigWeek ? rec(fmtKm(weekTotals[bigWeek]) + " km", "Biggest week", bigWeek) : "") +
    "</div>";
}

/* ---------- Render all ---------- */

function renderAll() {
  const st = computeStats();
  renderDashboard(st);
  renderSwimList();
  renderPlan(st);
  if (!document.getElementById("view-insights").hidden) {
    renderInsights(st);
    chartsDirty = false;
  }
}

/* ---------- Tabs ---------- */

function switchTab(name) {
  document.querySelectorAll(".view").forEach(function (v) {
    v.hidden = v.dataset.view !== name;
  });
  document.querySelectorAll(".tab").forEach(function (t) {
    const active = t.dataset.tab === name;
    t.classList.toggle("tab-active", active);
    if (active) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  if (name === "insights" && chartsDirty) {
    renderInsights(computeStats());
    chartsDirty = false;
  }
  window.scrollTo(0, 0);
}

/* ---------- Form ---------- */

function buildRpeChips() {
  const row = document.getElementById("rpeRow");
  let html = "";
  for (let i = 1; i <= 10; i++) {
    html += '<button type="button" class="rpe-chip" data-rpe="' + i + '" aria-pressed="false">' + i + "</button>";
  }
  row.innerHTML = html;
  row.addEventListener("click", function (e) {
    const btn = e.target.closest(".rpe-chip");
    if (!btn) return;
    const val = Number(btn.dataset.rpe);
    selectedRpe = selectedRpe === val ? null : val;
    row.querySelectorAll(".rpe-chip").forEach(function (c) {
      const on = Number(c.dataset.rpe) === selectedRpe;
      c.classList.toggle("selected", on);
      c.setAttribute("aria-pressed", String(on));
    });
  });
}

/* Rewrite the time field with its colons in place as the digits arrive */
function reformatTimeField() {
  const el = document.getElementById("fTime");
  const digits = timeDigits(el.value);
  const formatted = digits ? formatParts(digitsToParts(digits)) : "";
  if (el.value !== formatted) el.value = formatted;
  updatePaceHint();
}

function updatePaceHint() {
  const el = document.getElementById("fTime");
  const hint = document.getElementById("paceHint");
  const metres = parseInt(document.getElementById("fMetres").value, 10);
  const digits = timeDigits(el.value);

  hint.classList.remove("hint-error");
  el.removeAttribute("aria-invalid");

  if (!digits) { hint.textContent = ""; return; }

  const p = digitsToParts(digits);
  if (p.s > 59 || p.m > 59) {
    hint.textContent = p.s > 59 ? "Seconds cannot be more than 59" : "Minutes cannot be more than 59";
    hint.classList.add("hint-error");
    el.setAttribute("aria-invalid", "true");
    return;
  }

  const secs = partsToSeconds(p);
  let msg = formatParts(p);
  if (metres > 0 && secs > 0) msg += ", pace " + fmtPace((secs / metres) * 100) + " per 100 m";
  hint.textContent = msg;
}

function resetForm() {
  editingId = null;
  selectedRpe = null;
  document.getElementById("swimForm").reset();
  document.getElementById("fDate").value = todayStr();
  document.getElementById("logTitle").textContent = "Log a swim";
  document.getElementById("saveBtn").textContent = "Save swim";
  document.getElementById("cancelEditBtn").hidden = true;
  document.querySelectorAll(".rpe-chip").forEach(function (c) {
    c.classList.remove("selected");
    c.setAttribute("aria-pressed", "false");
  });
  const hint = document.getElementById("paceHint");
  hint.textContent = "";
  hint.classList.remove("hint-error");
  document.getElementById("fTime").removeAttribute("aria-invalid");
}

function startEdit(id) {
  const s = swims.find(function (r) { return r.id === id; });
  if (!s) return;
  editingId = id;
  document.getElementById("fDate").value = s.swim_date;
  document.getElementById("fMetres").value = s.metres;
  document.getElementById("fUnbroken").value = s.unbroken_metres || "";
  document.getElementById("fTime").value = s.time_seconds ? fmtDuration(s.time_seconds) : "";
  document.getElementById("fWarmup").value = s.warm_up || "";
  document.getElementById("fNotes").value = s.notes || "";
  selectedRpe = s.rpe != null && s.rpe !== "" ? Number(s.rpe) : null;
  document.querySelectorAll(".rpe-chip").forEach(function (c) {
    const on = Number(c.dataset.rpe) === selectedRpe;
    c.classList.toggle("selected", on);
    c.setAttribute("aria-pressed", String(on));
  });
  document.getElementById("logTitle").textContent = "Edit swim";
  document.getElementById("saveBtn").textContent = "Update swim";
  document.getElementById("cancelEditBtn").hidden = false;
  reformatTimeField();
  switchTab("log");
}

function handleSubmit(e) {
  e.preventDefault();
  const date = document.getElementById("fDate").value;
  const metres = parseInt(document.getElementById("fMetres").value, 10);
  if (!date || !metres || metres <= 0) {
    showToast("A date and metres are needed");
    return;
  }
  const unbrokenRaw = document.getElementById("fUnbroken").value;
  const unbroken = unbrokenRaw ? parseInt(unbrokenRaw, 10) : null;
  const timeEl = document.getElementById("fTime");
  const t = parseTimeInput(timeEl.value);
  if (timeEl.value.trim() && (t === null || isNaN(t))) {
    updatePaceHint();
    const hint = document.getElementById("paceHint");
    if (!hint.classList.contains("hint-error")) {
      hint.textContent = "That time does not look right";
      hint.classList.add("hint-error");
      timeEl.setAttribute("aria-invalid", "true");
    }
    timeEl.focus();
    return;
  }
  const warm = document.getElementById("fWarmup").value.trim() || null;
  const notes = document.getElementById("fNotes").value.trim() || null;

  const body = {
    swim_date: date,
    metres: metres,
    unbroken_metres: unbroken,
    time_seconds: t || null,
    rpe: selectedRpe,
    warm_up: warm,
    notes: notes
  };

  if (editingId) {
    enqueue({ type: "update", rowId: editingId, body: body });
    showToast("Swim updated", true);
  } else {
    const row = Object.assign({ id: crypto.randomUUID() }, body, {
      created_at: new Date().toISOString()
    });
    enqueue({ type: "insert", row: row });
    showToast("Swim saved", true);
    const btn = document.getElementById("saveBtn");
    btn.classList.add("saved-flash");
    btn.textContent = "Saved";
    setTimeout(function () {
      btn.classList.remove("saved-flash");
      btn.textContent = "Save swim";
    }, 1400);
  }
  resetForm();
  switchTab("dashboard");
}

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(msg, good) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (good ? " toast-sage" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
}

/* ---------- Events ---------- */

function wireEvents() {
  document.querySelector(".tabbar").addEventListener("click", function (e) {
    const tab = e.target.closest(".tab");
    if (tab) switchTab(tab.dataset.tab);
  });

  document.getElementById("refreshBtn").addEventListener("click", function () {
    refreshFromServer(true);
  });

  document.getElementById("swimForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", function () {
    resetForm();
    switchTab("swims");
  });

  document.getElementById("fMetres").addEventListener("input", updatePaceHint);
  document.getElementById("fTime").addEventListener("input", reformatTimeField);
  document.getElementById("fTime").addEventListener("blur", reformatTimeField);

  document.querySelector(".quick-row").addEventListener("click", function (e) {
    const btn = e.target.closest(".quick-btn");
    if (!btn) return;
    document.getElementById("fMetres").value = btn.dataset.m;
    updatePaceHint();
  });

  document.getElementById("swimList").addEventListener("click", function (e) {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) { startEdit(editBtn.dataset.edit); return; }

    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const id = delBtn.dataset.del;
      if (confirmingDeleteId === id) {
        confirmingDeleteId = null;
        expandedId = null;
        enqueue({ type: "delete", rowId: id });
        showToast("Swim deleted");
      } else {
        confirmingDeleteId = id;
        renderSwimList();
      }
      return;
    }

    const rowBtn = e.target.closest("[data-row]");
    if (rowBtn) {
      const id = rowBtn.dataset.row;
      expandedId = expandedId === id ? null : id;
      confirmingDeleteId = null;
      renderSwimList();
    }
  });

  window.addEventListener("online", function () {
    flushQueue();
  });
  window.addEventListener("offline", updateSyncStatus);
  setInterval(function () {
    if (queue.length > 0) flushQueue();
  }, 30000);
}

/* ---------- Boot ---------- */

function boot() {
  loadCache();
  buildRpeChips();
  document.getElementById("fDate").value = todayStr();
  wireEvents();
  updateSyncStatus();
  renderAll();
  refreshFromServer(false);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

boot();
