// KKBOX 榜單爬蟲：5 曲風 × 單曲/新歌 × 日榜，共 10 個榜
// 官方 Open API，OAuth client credentials，不需要瀏覽器
import "dotenv/config";
import fs from "fs";
import path from "path";

const CLIENT_ID = process.env.KKBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;

const CHARTS = {
  "華語單曲日榜": { id: "L_jEL1FoZyv3IGeE5F", genre: "mandarin", type: "single" },
  "西洋單曲日榜": { id: "T_aWWgso0IEq-d4-hH", genre: "western", type: "single" },
  "韓語單曲日榜": { id: "8sjfleJb8xOOgU1DSv", genre: "korean", type: "single" },
  "日語單曲日榜": { id: "CnHP-F-rvvrnBeDfOJ", genre: "japanese", type: "single" },
  "台語單曲日榜": { id: "Crgsu0VTBQ3cV7QdMb", genre: "taiwanese", type: "single" },
  "華語新歌日榜": { id: "8nO9eJnbFBkckLODpN", genre: "mandarin", type: "newrelease" },
  "西洋新歌日榜": { id: "5-QQ2SlW5_mo-maKF3", genre: "western", type: "newrelease" },
  "韓語新歌日榜": { id: "KoNfcnv-60uHLEPLcz", genre: "korean", type: "newrelease" },
  "日語新歌日榜": { id: "_Z6P53uvztVJzqRpy0", genre: "japanese", type: "newrelease" },
  "台語新歌日榜": { id: "P-GxYpTyJkzqrHfoXa", genre: "taiwanese", type: "newrelease" },
};

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

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

async function getAccessToken() {
  const res = await fetch("https://account.kkbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
  });
  if (!res.ok) throw new Error(`拿 token 失敗：${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function fetchAllTracks(chartId, token) {
  const tracks = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const url = `https://api.kkbox.com/v1.1/charts/${chartId}/tracks?territory=TW&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`抓曲目失敗：${res.status} ${await res.text()}`);
    const data = await res.json();
    tracks.push(...(data.data || []));
    const total = data.summary?.total ?? tracks.length;
    offset += limit;
    if (offset >= total) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return tracks;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("找不到 KKBOX_CLIENT_ID / KKBOX_CLIENT_SECRET。");
    process.exit(1);
  }

  const token = await getAccessToken();

  for (const [label, { id, genre, type }] of Object.entries(CHARTS)) {
    const tracks = await fetchAllTracks(id, token);

    const rows = tracks.map((item, i) => {
      const track = item.track || item;
      const artist = track.album?.artist || track.artist || {};
      return {
        captured_date: today,
        chart_name: label,
        genre,
        chart_type: type,
        rank: i + 1,
        track_name: track.name || "",
        track_id: track.id || "",
        isrc: track.isrc || "",
        artist_name: artist.name || "",
        artist_id: artist.id || "",
        album_name: track.album?.name || "",
        album_id: track.album?.id || "",
        release_date: track.album?.release_date || "",
        image_url: track.album?.images?.[0]?.url || "",
      };
    });

    writeCsvWithBom(`data/kkbox_${genre}_${type}_daily_${today}.csv`, rows);
    console.log(`[${label}] 寫入 ${rows.length} 筆`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

main().catch((e) => {
  console.error("執行失敗：", e.message);
  process.exit(1);
});
