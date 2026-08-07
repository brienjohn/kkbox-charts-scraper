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

const DAILY_BACKFILL_DAYS = 5;
const WEEKLY_BACKFILL_WEEKS = 8;

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

async function fetchChart(timeframe, category, type, date) {
  const url = `https://kma.kkbox.com/charts/api/v1/${timeframe}?category=${category}&date=${date}&lang=en&limit=50&terr=${TERRITORY}&type=${type}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
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
  const mapped = rows.map((e) => mapEntry(e, ctx));
  const fileName = `kkbox_kma_${genreName}_${type}_${timeframe}_${date}.csv`;
  writeCsvWithBom(path.join(outDir, fileName), mapped);
  return mapped.length;
}

async function runCurrent(outDir) {
  const today = taipeiDateString(0);
  let total = 0;
  for (const [category, genreName] of Object.entries(GENRES)) {
    for (const type of TYPES) {
      for (const timeframe of TIMEFRAMES) {
        try {
          const n = await runCombo(timeframe, category, genreName, type, today, outDir);
          console.log(`[${timeframe}/${genreName}/${type}] ${today} -> ${n} 筆`);
          total += n;
        } catch (e) {
          console.warn(`[warn] ${timeframe}/${genreName}/${type}/${today} 失敗：${e.message}`);
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

  for (const [category, genreName] of Object.entries(GENRES)) {
    for (const type of TYPES) {
      // 每日榜：回補最近 DAILY_BACKFILL_DAYS 天
      for (let d = 1; d <= DAILY_BACKFILL_DAYS; d++) {
        const date = addDaysUTC(today, -d);
        const fileName = `kkbox_kma_${genreName}_${type}_daily_${date}.csv`;
        if (fs.existsSync(path.join(outDir, fileName))) continue;
        targets.push({ timeframe: "daily", category, genreName, type, date });
      }
      // 每週榜：回補最近 WEEKLY_BACKFILL_WEEKS 週
      for (let w = 1; w <= WEEKLY_BACKFILL_WEEKS; w++) {
        const date = addDaysUTC(today, -7 * w);
        const fileName = `kkbox_kma_${genreName}_${type}_weekly_${date}.csv`;
        if (fs.existsSync(path.join(outDir, fileName))) continue;
        targets.push({ timeframe: "weekly", category, genreName, type, date });
      }
    }
  }

  const batch = targets.slice(0, maxTargets);
  console.log(`[backfill] 這次處理 ${batch.length} 組（還有 ${Math.max(0, targets.length - batch.length)} 組留到下次）`);

  for (const t of batch) {
    try {
      const n = await runCombo(t.timeframe, t.category, t.genreName, t.type, t.date, outDir);
      console.log(`[${t.timeframe}/${t.genreName}/${t.type}] ${t.date} -> ${n} 筆`);
    } catch (e) {
      console.warn(`[warn] ${t.timeframe}/${t.genreName}/${t.type}/${t.date} 失敗：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "current";
  const maxTargetsIdx = process.argv.indexOf("--max-targets");
  const maxTargets = maxTargetsIdx > -1 ? parseInt(process.argv[maxTargetsIdx + 1], 10) : 15;
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
