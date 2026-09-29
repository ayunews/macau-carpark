# 泊車澳門

澳門公共停車場即時空位、附近搜尋、清單、地圖及停車費用模擬網站。專案是純靜態網站，可直接部署到 GitHub Pages，不需要伺服器或資料庫。

## 功能

- 以目前位置按直線距離排列停車場
- 按名稱、街道、出入口及區域搜尋
- 依輕型汽車、電單車、電動車及重型車輛切換即時空位
- 地圖標記、群組及停車場快速預覽
- 地圖模式會以目前位置及定位精度範圍為中心，右側列表按距離由近至遠排列；點擊列表會飛到對應標記並開啟資料氣泡
- 顯示即時與總車位、位置、出入口、限高、電話及原始收費資料
- 在清單內直接顯示所選時段的估算費用，並按最低費用排序
- 根據官方文字規則模擬跨日夜、首小時、分段車長、15 分鐘免費及各類封頂費用
- 每 5 分鐘在瀏覽器重新讀取同網域快照
- GitHub Actions 每 5 分鐘抓取最新官方資料並重新部署

## 資料來源

- 即時車位：[停車場車位資訊](https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4)，官方更新頻率 10 秒
- 位置、地址及收費：[停車場資料](https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706)
- 車位總數：DSAT 停車場詳情頁，只會在需要補充或更新總數時抓取
- 地圖底圖：[OpenStreetMap](https://www.openstreetmap.org/copyright)

兩個正式 API 需要資料平台頁面公開顯示的 `APPCODE`，而且回應沒有允許跨網域的 CORS 標頭，因此 GitHub Pages 不能直接在瀏覽器抓取。本專案由 GitHub Actions 定時同步公開資料，網站讀取部署內的 `data/carparks.json`。這代表實際更新時間會受 GitHub Actions 排程及 Pages 部署時間影響，通常不是逐秒即時。

如果平台日後更換公開 `APPCODE` 或 API 網址，可以在 GitHub Actions 設定 `DATA_GOV_APPCODE`、`DATA_GOV_LIVE_API_URL` 及 `DATA_GOV_DETAIL_API_URL` repository variables/secrets。

`data/carparks.json` 的 `meta.generatedAt` 是同步時間，`meta.sourceUpdatedAt` 是 DSAT 頁面上的車位更新時間。

目前正式 API 的 92 個即時場站全部都有座標。

官方日後新增停車場時，只要即時車位 API 先出現新站，網站就會自動加入。若詳細資料或收費稍後才發布，該站會先顯示即時車位及「待公布」，下一輪同步再自動補齊，不會因單一新站而令整個同步失敗。

## 本機執行

需求：Node.js 20 或以上。

```powershell
npm install
npm run sync
npm test
npm run build
npm run serve
```

`npm run sync` 會即時抓取澳門開放資料平台的正式 API，並覆寫 `data/carparks.json`。`npm run build` 會把網站輸出到 `dist`，同時產生可直接開啟的 `standalone.html`。

如果只修改前端，可直接執行：

```powershell
npm run serve
```

`npm run serve` 會在啟動時同步一次官方 API，之後每 5 分鐘自動同步；網站的「重新整理」亦會要求本機伺服器立即同步。請使用 `http://127.0.0.1:4173`，不要直接開啟 `index.html`，因為瀏覽器會阻止 `file://` 下的 ES module 和資料請求。

如果不想執行伺服器，可直接雙擊 `standalone.html`。這個單檔版本內嵌最新建置時的資料、CSS 和 JavaScript；地圖及圖示仍需要網絡載入 CDN 資源。

## GitHub Pages

1. 把專案推送到 GitHub 的 `main` 分支。
2. 在 repository 的 `Settings > Pages`，把 `Source` 設為 `GitHub Actions`。
3. 開啟 `Actions`，手動執行一次 `Sync official data and deploy Pages`。
4. 之後 workflow 會在每次推送及每 5 分鐘執行。

Workflow 不會把每次即時資料 commit 回 repository；它會在 runner 上重新抓取資料、跑測試、建立 `dist`，再把 `dist` 部署為 Pages artifact。

如果這個資料夾尚未是 Git repository：

```powershell
git init -b main
git add .
git commit -m "Create Macau carpark website"
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

## 計費準確度

計費器會解析 DSAT 詳情頁的收費文字，支援目前資料中常見的規則：

- 每半小時或每小時收費
- 日間與夜間分段
- 首小時及後續費率
- 不同車長的收費方案
- 電單車日夜封頂
- 連續 24 小時封頂
- 15 分鐘內離場免費

其他優惠、推廣期、連續泊車超過時限後加倍收費等特殊條款，網站不會自行推測。遇到未能可靠拆解的規則，介面會顯示「—」並提供官方原文，實際金額一律以現場及官方公布為準。

## 專案結構

```text
index.html                     網站版面
styles.css                     介面樣式
app.js                         搜尋、地圖、詳情及模擬器介面
billing.js                     收費規則解析與計算
data/carparks.json             最新同步快照
scripts/sync-dsat.mjs          DSAT 及地圖資料同步
scripts/build-site.mjs         GitHub Pages 靜態輸出
tests/billing.test.js          計費核心測試
.github/workflows/             定時同步及 Pages 部署
```

## 私隱

目前位置只在瀏覽器內用於計算直線距離，不會傳送或儲存。網站沒有帳戶、追蹤像素或後端資料庫。

## 免責聲明

本專案是非官方工具，與澳門特別行政區交通事務局無關。車位、位置、收費及營運時間可能隨時變動，使用前請以 DSAT、現場指示及營運單位公布為準。
