import { load } from "cheerio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "carparks.json");

const DEFAULT_APP_CODE = "09d43a591fba407fb862412970667de4";
const LIVE_API_URL = "https://dsat.apigateway.data.gov.mo/car_park_maintance";
const DETAIL_API_URL = "https://dsat.apigateway.data.gov.mo/car_park_detail";
const LIVE_DATASET = {
  id: "ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
  apiId: 5,
  url: "https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
};
const DETAIL_DATASET = {
  id: "ac55c2f1-780a-4dc8-875f-851b2203b706",
  apiId: 6,
  url: "https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706",
};

const LEGACY_DETAIL_URL = (id) =>
  `https://m.dsat.gov.mo/carpark_detail.aspx?id=${id}`;

const CATEGORY_FIELDS = {
  light: "Car_CNT",
  motorcycle: "MB_CNT",
  electricCar: "ELC_CNT",
  electricMotorcycle: "OT_A_CNT",
  accessible: "DC_CNT",
};

const CATEGORY_BY_IMAGE = {
  carpark_car: "light",
  carpark_motor: "motorcycle",
  carpark_ecar: "electricCar",
  carpark_emotor: "electricMotorcycle",
  carpark_disabled: "accessible",
  lt_7m: "heavyUnder7m",
  gt_7m: "heavyOver7m",
  lt_8m: "heavyUnder8m",
  gt_8m: "heavyOver8m",
};

function cleanText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanXmlText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/##/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanNullable(value) {
  const cleaned = cleanText(value);
  return !cleaned || /^(-|—|--|不適用|---)$/.test(cleaned) ? null : cleaned;
}

function parseCount(value) {
  const cleaned = cleanText(value);
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

function parseCountPair(value) {
  const match = cleanText(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return { available: Number(match[1]), total: Number(match[2]) };
}

function normalizeDsatTime(value) {
  const match = cleanText(value).match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i,
  );
  if (!match) return cleanText(value) || null;

  let hour = Number(match[4]);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  return [
    match[3],
    String(match[1]).padStart(2, "0"),
    String(match[2]).padStart(2, "0"),
  ].join("-") +
    ` ${String(hour).padStart(2, "0")}:${match[5]}:${match[6]}`;
}

function inferFeeHeading(...values) {
  const text = values.filter(Boolean).join("\n");
  if (/首小時/.test(text)) {
    return "每小時或不足一小時之收費(MOP$)";
  }
  if (/每半小時/.test(text)) {
    return "每半小時或不足半小時之收費 (MOP$)";
  }
  if (/每小時|首小時/.test(text)) {
    return "每小時或不足一小時之收費(MOP$)";
  }
  return "每小時或不足一小時之收費(MOP$)";
}

async function fetchText(url, attempts = 3, headers = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "macau-carpark-pages/1.0 (+https://github.com/; scheduled public-data sync)",
          Accept: "application/xml,application/json,text/html;q=0.9,*/*;q=0.8",
          ...headers,
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || "unknown error"}`);
}

function resolveOfficialApis() {
  return {
    appCode: process.env.DATA_GOV_APPCODE || DEFAULT_APP_CODE,
    liveUrl: process.env.DATA_GOV_LIVE_API_URL || LIVE_API_URL,
    detailUrl: process.env.DATA_GOV_DETAIL_API_URL || DETAIL_API_URL,
  };
}

function parseOfficialLive(xml) {
  const $ = load(xml, { xmlMode: true });
  const parks = new Map();

  $("Car_park_info").each((_, element) => {
    const attributes = element.attribs || {};
    const id = Number(attributes.ID);
    if (!id) return;

    const maintenance = attributes.maintenance === "1";
    const live = {};
    for (const [key, field] of Object.entries(CATEGORY_FIELDS)) {
      live[key] = {
        available: maintenance ? null : parseCount(attributes[field]),
        total: null,
        maintenance,
      };
    }

    parks.set(id, {
      id,
      name: cleanText(attributes.name),
      englishName: cleanNullable(attributes.CP_EName),
      portugueseName: cleanNullable(attributes.CP_PName),
      liveUpdatedAt: normalizeDsatTime(attributes.Time),
      maintenance,
      live,
    });
  });

  return parks;
}

function parseOfficialDetails(xml) {
  const $ = load(xml, { xmlMode: true });
  const parks = new Map();

  $("Car_park_info").each((_, element) => {
    const attributes = element.attribs || {};
    const id = Number(attributes.CP_ID);
    if (!id) return;

    const tariffs = {
      light: cleanXmlText(attributes.Lcar_price_C) || null,
      heavy: cleanXmlText(attributes.Hcar_price_C) || null,
      motorcycle: cleanXmlText(attributes.moto_price_C) || null,
      notes: cleanXmlText(attributes.remark_price_C) || null,
    };
    const lat = Number(attributes.X_coords);
    const lng = Number(attributes.Y_coords);

    parks.set(id, {
      id,
      officialName: cleanText(attributes.NameC),
      englishName: cleanNullable(attributes.NameE),
      portugueseName: cleanNullable(attributes.NameP),
      location: cleanNullable(attributes.LocationC),
      entrance: cleanNullable(attributes.CarParkEntryC),
      phone: cleanNullable(attributes.ContactNo),
      heightLimit: cleanNullable(attributes.height),
      locality: cleanNullable(attributes.zone_C),
      district: cleanNullable(attributes.subdistrict_C),
      feeHeading: inferFeeHeading(
        tariffs.light,
        tariffs.heavy,
        tariffs.motorcycle,
      ),
      tariffs,
      coordinate:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng, source: "data.gov.mo" }
          : null,
    });
  });

  return parks;
}

function parseLegacyLiveCategories($, root) {
  const categories = {};
  $(root)
    .find('div[style*="inline-block"]')
    .each((_, element) => {
      const image = $(element).find("img").first();
      const src = image.attr("src") || "";
      const file = src.split("/").pop().split("?")[0].replace(/\.png$/i, "");
      const key = CATEGORY_BY_IMAGE[file];
      if (!key) return;

      const clone = $(element).clone();
      const badge = clone.find('img[class*="fee_badge"]').attr("alt") || "";
      clone.find("img").remove();
      const value = cleanText(clone.text());
      const pair = parseCountPair(value);
      categories[key] = {
        available: pair ? pair.available : parseCount(value),
        total: pair ? pair.total : null,
        feeBadge: cleanText(badge) || null,
      };
    });
  return categories;
}

function parseLegacyDetail(html) {
  const $ = load(html);
  const fields = {};

  $("table.table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const label = cleanText($(cells[0]).text()).replace(/[：:]\s*$/, "");
    if (!label) return;
    fields[label] = cleanText($(cells[1]).text());
  });

  const heading =
    cleanText($('td[colspan="2"] .style1').first().text()) ||
    cleanText($('td[colspan="2"]').first().text());

  return {
    live: parseLegacyLiveCategories($, $("#carpark_data")),
    feeHeading: cleanNullable(heading),
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readPreviousData() {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch {
    return null;
  }
}

function needsLegacyDetail(officialPark, previousPark) {
  if (!previousPark) return true;
  if (/重型|客車/.test(officialPark.name)) return true;
  if (
    Object.keys(previousPark.live || {}).some((key) =>
      key.startsWith("heavy"),
    )
  ) {
    return true;
  }
  return Object.entries(officialPark.live).some(([key, value]) => {
    if (key.startsWith("heavy")) return false;
    return value.available !== null && previousPark.live?.[key]?.total == null;
  });
}

function mergeLiveCategories(officialPark, previousPark, legacyDetail) {
  const merged = {};

  for (const [key, officialValue] of Object.entries(officialPark.live)) {
    const previousValue = previousPark?.live?.[key];
    const legacyValue = legacyDetail?.live?.[key];
    merged[key] = {
      available: officialValue.available,
      total: legacyValue?.total ?? previousValue?.total ?? null,
      feeBadge:
        previousValue?.feeBadge ?? legacyValue?.feeBadge ?? null,
      maintenance: officialPark.maintenance,
    };
  }

  for (const key of Object.keys(CATEGORY_BY_IMAGE)
    .map((imageKey) => CATEGORY_BY_IMAGE[imageKey])
    .filter((key) => key.startsWith("heavy"))) {
    const legacyValue = legacyDetail?.live?.[key];
    if (!legacyValue) continue;
    merged[key] = {
      ...legacyValue,
      maintenance: officialPark.maintenance,
    };
  }

  return merged;
}

function buildPark(officialPark, officialDetail, previousPark, legacyDetail) {
  return {
    id: officialPark.id,
    name:
      officialPark.name ||
      officialDetail?.officialName ||
      previousPark?.name ||
      `停車場 ${officialPark.id}`,
    officialName:
      officialDetail?.officialName ||
      previousPark?.officialName ||
      officialPark.name ||
      null,
    englishName:
      officialDetail?.englishName ||
      officialPark.englishName ||
      previousPark?.englishName ||
      null,
    portugueseName:
      officialDetail?.portugueseName ||
      officialPark.portugueseName ||
      previousPark?.portugueseName ||
      null,
    isNew: !previousPark,
    liveUpdatedAt: officialPark.liveUpdatedAt,
    maintenance: officialPark.maintenance,
    live: mergeLiveCategories(officialPark, previousPark, legacyDetail),
    location: officialDetail?.location || previousPark?.location || null,
    entrance: officialDetail?.entrance || previousPark?.entrance || null,
    phone: officialDetail?.phone || previousPark?.phone || null,
    heightLimit:
      officialDetail?.heightLimit || previousPark?.heightLimit || null,
    locality: officialDetail?.locality || previousPark?.locality || null,
    district: officialDetail?.district || previousPark?.district || null,
    feeHeading:
      legacyDetail?.feeHeading ||
      officialDetail?.feeHeading ||
      previousPark?.feeHeading ||
      "收費待公布",
    tariffs:
      officialDetail?.tariffs ||
      previousPark?.tariffs || {
        light: null,
        heavy: null,
        motorcycle: null,
        notes: null,
      },
    coordinate: officialDetail?.coordinate || previousPark?.coordinate || null,
    officialUrl: LEGACY_DETAIL_URL(officialPark.id),
  };
}

async function main() {
  console.log("Resolving public data platform APIs...");
  const api = resolveOfficialApis();

  console.log("Fetching official live vehicle counts and carpark details...");
  const authorization = { Authorization: `APPCODE ${api.appCode}` };
  const [liveXml, detailXml] = await Promise.all([
    fetchText(api.liveUrl, 3, authorization),
    fetchText(api.detailUrl, 3, authorization),
  ]);

  const liveParks = parseOfficialLive(liveXml);
  const detailParks = parseOfficialDetails(detailXml);
  if (liveParks.size < 50 || detailParks.size < 50) {
    throw new Error(
      `Official APIs returned too few records: ${liveParks.size} live, ${detailParks.size} detail.`,
    );
  }

  const previousData = await readPreviousData();
  const previousById = new Map(
    (previousData?.carparks || []).map((park) => [park.id, park]),
  );
  const legacyIds = [...liveParks.values()]
    .filter((park) => needsLegacyDetail(park, previousById.get(park.id)))
    .map((park) => park.id);

  let legacyDetails = new Map();
  if (legacyIds.length) {
    console.log(
      `Fetching ${legacyIds.length} DSAT detail page(s) for capacity totals...`,
    );
    const parsed = await mapLimit(legacyIds, 5, async (id) => {
      try {
        const html = await fetchText(LEGACY_DETAIL_URL(id), 2);
        return [id, parseLegacyDetail(html)];
      } catch (error) {
        console.warn(`Capacity detail unavailable for ${id}: ${error.message}`);
        return [id, null];
      }
    });
    legacyDetails = new Map(parsed);
  }

  const carparks = [...liveParks.values()]
    .map((park) =>
      buildPark(
        park,
        detailParks.get(park.id),
        previousById.get(park.id),
        legacyDetails.get(park.id),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "zh-HK"));

  const matchedCoordinates = carparks.filter((park) => park.coordinate).length;
  const sourceUpdatedAt =
    carparks
      .map((park) => park.liveUpdatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt,
      sourceName: "澳門特別行政區政府數據開放平台",
      sourceUrl: LIVE_DATASET.url,
      liveApiUrl: api.liveUrl,
      detailApiUrl: api.detailUrl,
      liveDatasetId: LIVE_DATASET.id,
      detailDatasetId: DETAIL_DATASET.id,
      legacyCapacitySourceUrl: "https://m.dsat.gov.mo/carpark_detail.aspx",
      totalCarparks: carparks.length,
      matchedCoordinates,
      newCarparks: carparks.filter((park) => park.isNew).length,
      schemaVersion: 2,
    },
    carparks,
  };

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${carparks.length} carparks with ${matchedCoordinates} coordinates to ${path.relative(
      ROOT,
      DATA_FILE,
    )}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
