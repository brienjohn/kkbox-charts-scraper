// KKBOX 榜單探勘：把 tw 地區目前所有可用的榜單名稱印出來，用來確認要抓哪 30 個
import "dotenv/config";

const CLIENT_ID = process.env.KKBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;

async function getAccessToken() {
  const res = await fetch("https://account.kkbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
  });
  if (!res.ok) throw new Error(`拿 token 失敗：${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("找不到 KKBOX_CLIENT_ID / KKBOX_CLIENT_SECRET，先確認 .env 有填好。");
    process.exit(1);
  }

  const token = await getAccessToken();
  console.log("拿到 access token，開始列出 tw 地區的榜單...\n");

  let offset = 0;
  const limit = 50;
  let total = null;
  const all = [];

  while (total === null || offset < total) {
    const url = `https://api.kkbox.com/v1.1/charts?territory=TW&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`查榜單清單失敗：${res.status} ${await res.text()}`);
    const data = await res.json();

    for (const item of data.data) {
      all.push({ id: item.id, title: item.title, description: item.description || "" });
    }

    total = data.paging?.total ?? data.data.length;
    offset += limit;
  }

  console.log(`共 ${all.length} 個榜單：\n`);
  all.forEach((c, i) => {
    console.log(`${i + 1}. [${c.id}] ${c.title}${c.description ? " — " + c.description : ""}`);
  });
}

main().catch((e) => {
  console.error("執行失敗：", e.message);
  process.exit(1);
});
