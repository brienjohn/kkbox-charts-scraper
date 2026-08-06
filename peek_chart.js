// 診斷版：印出完整原始資料，找出榜單對應的實際期間；同時比較英美金曲榜 vs 西洋單曲日榜
import "dotenv/config";

const CLIENT_ID = process.env.KKBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;

const CHARTS_TO_PEEK = {
  "英美金曲榜": "Ot9b9neLPHGat4LYK-",
  "西洋單曲日榜": "T_aWWgso0IEq-d4-hH",
  "錢櫃國語點播榜": "__u6jEV61Qgdt4Tci1",
};

async function getAccessToken() {
  const res = await fetch("https://account.kkbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
  });
  if (!res.ok) throw new Error(`拿 token 失敗：${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const token = await getAccessToken();

  // 先看 /v1.1/charts 列表裡，這三個榜單本身有沒有帶日期/期間欄位
  console.log("===== 榜單本身的 metadata（找期間欄位）=====");
  const listRes = await fetch(`https://api.kkbox.com/v1.1/charts?territory=TW&offset=0&limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  for (const item of listData.data) {
    if (Object.values(CHARTS_TO_PEEK).includes(item.id)) {
      console.log(JSON.stringify(item, null, 2));
    }
  }

  // 再看每個榜單第一首歌的完整原始欄位，找有沒有期間資訊藏在這裡
  for (const [label, chartId] of Object.entries(CHARTS_TO_PEEK)) {
    console.log(`\n===== ${label} (${chartId})：前 10 名 + 第一筆完整原始資料 =====`);
    const url = `https://api.kkbox.com/v1.1/charts/${chartId}/tracks?territory=TW&offset=0&limit=10`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`失敗：${res.status} ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    console.log("--- paging/summary 欄位 ---");
    console.log(JSON.stringify({ paging: data.paging, summary: data.summary }, null, 2));

    (data.data || []).forEach((item, i) => {
      const track = item.track || item;
      const artistName = track.album?.artist?.name || track.artist?.name || "";
      console.log(`${i + 1}. ${track.name} — ${artistName}`);
    });

    console.log("--- 第一筆完整原始 JSON ---");
    console.log(JSON.stringify(data.data?.[0], null, 2));
  }
}

main().catch((e) => {
  console.error("執行失敗：", e.message);
  process.exit(1);
});
