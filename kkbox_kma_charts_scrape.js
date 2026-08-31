// KKBOX 週榜／專輯榜爬蟲（kma.kkbox.com，非官方 Open API，不需要密鑰）
// 涵蓋：5 曲風 × 3 類型（單曲/新歌/專輯）× 日/週 = 30 個榜，地區固定 tw
// 這個端點是乾淨的 JSON API，不需要 Playwright，純網路請求就好
import fs from "fs";
import path from "path";

const GENRES = {
  297: "mandarin",
  390: "western",
  314: "korean",
  304: "taiwanese",
  308: "japanese",
};

const TYPES = ["song", "newrelease", "album"];
const TIMEFRAMES = ["daily", "weekly"];
const TERRITORY = "tw";

// 回溯要抓到多早（含）為止，不用再手動調天數/週數上限
const BACKFILL_TARGET_DATE = "2026-01-01";

function taipeiDateString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addDaysUTC(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

function writeCsvWithBom(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!rows.length) return;
  fs.writeFileSync(filePath, "\uFEFF" + toCsv(rows), "utf8");
}

async function fetchChart(timeframe, category, type, date, attempt = 1) {
  const url = `https://kma.kkbox.com/charts/api/v1/${timeframe}?category=${category}&date=${date}&lang=en&limit=50&terr=${TERRITORY}&type=${type}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429 && attempt <= 3) {
    // 被限流了，等久一點（隨重試次數拉長）再試，最多重試 3 次
    const waitMs = 3000 * attempt;
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchChart(timeframe, category, type, date, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const arr = data?.data?.charts?.[type];
  if (!Array.isArray(arr)) return { returnedDate: data?.data?.date || null, rows: [] };
  return { returnedDate: data?.data?.date || null, rows: arr };
}

function mapEntry(entry, ctx) {
  const isAlbum = ctx.type === "album";
  return {
    captured_date: ctx.today,
    period_suffix: ctx.date,
    returned_date: ctx.returnedDate || "",
    timeframe: ctx.timeframe,
    genre: ctx.genreName,
    chart_type: ctx.type,
    rank_this_period: entry?.rankings?.this_period ?? "",
    rank_last_period: entry?.rankings?.last_period ?? "",
    song_id: entry?.song_id ?? "",
    song_name: entry?.song_name ?? "",
    album_id: entry?.album_id ?? "",
    album_name: entry?.album_name ?? "",
    artist_name: entry?.artist_name ?? "",
    artist_url: entry?.artist_url ?? "",
    song_url: entry?.song_url ?? "",
    album_url: entry?.album_url ?? "",
    cover_image_url: entry?.cover_image?.normal ?? "",
    release_date_unix: entry?.release_date ?? "",
    is_album_entry: isAlbum,
  };
}

async function runCombo(timeframe, category, genreName, type, date, outDir) {
  const ctx = { today: taipeiDateString(0), timeframe, genreName, type, date };
  const { returnedDate, rows } = await fetchChart(timeframe, category, type, date);
  ctx.returnedDate = returnedDate;
  // KKBOX 沒資料時不會回錯誤，而是靜默換成最近的有效期數。
  // 差距太大就印警告，避免以後把回溯目標調更早時，實際上已經超出歷史資料範圍卻沒發現
  if (returnedDate) {
    const diffDays = Math.abs((new Date(returnedDate) - new Date(date)) / 86400000);
    const threshold = timeframe === "daily" ? 3 : 10;
    if (diffDays > threshold) {
      console.warn(
        `[warn] ${timeframe}/${genreName}/${type} 要求 ${date}，KKBOX 卻回了 ${returnedDate}（差 ${Math.round(diffDays)} 天），可能已經超出歷史資料範圍`
      );
    }
  }
  const mapped = rows.map((e) => mapEntry(e, ctx));
  const fileName = `kkbox_kma_${genreName}_${type}_${timeframe}_${date}.csv`;
  writeCsvWithBom(path.join(outDir, fileName), mapped);
  return mapped.length;
}

function comboExists(type, timeframe) {
  // KKBOX 沒有「專輯日榜」這個產品，只有專輯週榜，其餘組合都存在
  return !(type === "album" && timeframe === "daily");
}

async function runCurrent(outDir) {
  // KKBOX「今天」的榜通常還沒算完，查詢用「昨天」比較穩，
  // captured_date（我們抓取的日期）另外記錄，兩者是不同概念
  const queryDate = taipeiDateString(1);
  let total = 0;
  for (const [category, genreName] of Object.entries(GENRES)) {
    for (const type of TYPES) {
      for (const timeframe of TIMEFRAMES) {
        if (!comboExists(type, timeframe)) continue;
        try {
          const n = await runCombo(timeframe, category, genreName, type, queryDate, outDir);
          console.log(`[${timeframe}/${genreName}/${type}] ${queryDate} -> ${n} 筆`);
          total += n;
        } catch (e) {
          console.warn(`[warn] ${timeframe}/${genreName}/${type}/${queryDate} 失敗：${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  console.log(`本次總計 ${total} 筆`);
}

async function runBackfill(outDir, maxTargets) {
  const targets = [];
  const today = taipeiDateString(0);
  // 安全上限，防呆用（避免日期算錯時無限迴圈）：日榜實際約需 240 步、週榜約需 35 步就會先停
  const MAX_STEPS = 400;

  for (const [category, genreName] of Object.entries(GENRES)) {
    for (const type of TYPES) {
      // 每日榜：往回跳到 BACKFILL_TARGET_DATE 為止
      if (comboExists(type, "daily")) {
        for (let d = 1; d <= MAX_STEPS; d++) {
          const date = addDaysUTC(today, -d);
          if (date < BACKFILL_TARGET_DATE) break;
          const fileName = `kkbox_kma_${genreName}_${type}_daily_${date}.csv`;
          if (fs.existsSync(path.join(outDir, fileName))) continue;
          targets.push({ timeframe: "daily", category, genreName, type, date });
        }
      }
      // 每週榜：往回跳到 BACKFILL_TARGET_DATE 為止
      for (let w = 1; w <= MAX_STEPS; w++) {
        const date = addDaysUTC(today, -7 * w);
        if (date < BACKFILL_TARGET_DATE) break;
        const fileName = `kkbox_kma_${genreName}_${type}_weekly_${date}.csv`;
        if (fs.existsSync(path.join(outDir, fileName))) continue;
        targets.push({ timeframe: "weekly", category, genreName, type, date });
      }
    }
  }

  const batch = targets.slice(0, maxTargets);
  const remaining = Math.max(0, targets.length - batch.length);
  console.log(`[backfill] 這次處理 ${batch.length} 組（還有 ${remaining} 組留到下次）`);

  for (const t of batch) {
    try {
      const n = await runCombo(t.timeframe, t.category, t.genreName, t.type, t.date, outDir);
      console.log(`[${t.timeframe}/${t.genreName}/${t.type}] ${t.date} -> ${n} 筆`);
    } catch (e) {
      console.warn(`[warn] ${t.timeframe}/${t.genreName}/${t.type}/${t.date} 失敗：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (remaining === 0) {
    console.log(`[backfill] ✅ 全部抓完了——已經回溯到 ${BACKFILL_TARGET_DATE}，之後不用再手動觸發`);
  }
}

async function main() {
  const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "current";
  const maxTargetsIdx = process.argv.indexOf("--max-targets");
  // 這支是純 JSON API 請求，沒有瀏覽器開銷，跑起來比 YouTube 那支快很多；
  // 總量抓到 2026-01-01 大概快 3000 組，預設值調高避免要手動重跑幾百次
  const maxTargets = maxTargetsIdx > -1 ? parseInt(process.argv[maxTargetsIdx + 1], 10) : 1000;
  const outDir = "data";

  if (mode === "backfill") {
    await runBackfill(outDir, maxTargets);
  } else {
    await runCurrent(outDir);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
