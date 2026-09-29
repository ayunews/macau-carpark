export const VEHICLES = {
  light: {
    label: "輕型汽車",
    shortLabel: "輕型車",
    icon: "car-front",
    tariffKey: "light",
  },
  motorcycle: {
    label: "電單車",
    shortLabel: "電單車",
    icon: "bike",
    tariffKey: "motorcycle",
  },
  electricCar: {
    label: "電動汽車",
    shortLabel: "電動車",
    icon: "car",
    tariffKey: "light",
  },
  electricMotorcycle: {
    label: "電動電單車",
    shortLabel: "電動電單車",
    icon: "zap",
    tariffKey: "motorcycle",
  },
  heavy: {
    label: "重型車輛",
    shortLabel: "重型車",
    icon: "truck",
    tariffKey: "heavy",
  },
};

const HEAVY_KEYS = [
  "heavyUnder7m",
  "heavyOver7m",
  "heavyUnder8m",
  "heavyOver8m",
];

const MINUTE = 60 * 1000;
const DAY_START = 8 * 60;
const NIGHT_START = 20 * 60;

function clean(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function scopeFromText(value = "") {
  if (/夜間|晚上|20:00/.test(value)) return "night";
  if (/日間|上午|08:00/.test(value)) return "day";
  return "all";
}

function unitFromText(value = "", fallback = 60) {
  if (/半小時/.test(value)) return 30;
  if (/每小時|一小時/.test(value)) return 60;
  return fallback;
}

function defaultUnitFromHeading(heading = "") {
  if (/半小時/.test(heading)) return 30;
  return 60;
}

function cloneRule(rule) {
  return {
    scope: rule.scope || "all",
    unitMinutes: rule.unitMinutes || 60,
    rate: Number(rule.rate),
    firstMinutes: rule.firstMinutes || null,
    firstRate:
      rule.firstRate === undefined || rule.firstRate === null
        ? null
        : Number(rule.firstRate),
  };
}

function parseRuleLine(line, defaultUnit, fallbackScope = "all") {
  const scope = scopeFromText(line) === "all" ? fallbackScope : scopeFromText(line);
  const firstHour = line.match(
    /首(?:一)?小時(?:或不足一小時)?\s*MOP\s*\$?(\d+(?:\.\d+)?)[，,\s]*(?:隨後)?每(半小時|小時)(?:或不足[^M]*)?\s*MOP\s*\$?(\d+(?:\.\d+)?)/,
  );

  if (firstHour) {
    return cloneRule({
      scope,
      unitMinutes: firstHour[2] === "半小時" ? 30 : 60,
      rate: firstHour[3],
      firstMinutes: 60,
      firstRate: firstHour[1],
    });
  }

  const unitRate = line.match(
    /每(半小時|小時)(?:或不足(?:半小時|一小時))?[^\n]*?MOP\s*\$?(\d+(?:\.\d+)?)/,
  );
  if (unitRate) {
    return cloneRule({
      scope,
      unitMinutes: unitRate[1] === "半小時" ? 30 : 60,
      rate: unitRate[2],
    });
  }

  const scopedRate = line.match(
    /MOP\s*\$?(\d+(?:\.\d+)?)\s*[（(](日間|夜間)[）)]/,
  );
  if (scopedRate) {
    return cloneRule({
      scope: scopedRate[2] === "夜間" ? "night" : "day",
      unitMinutes: defaultUnit,
      rate: scopedRate[1],
    });
  }

  const prefixedRate = line.match(
    /^[（(](日間|夜間)[）)]\s*MOP\s*\$?(\d+(?:\.\d+)?)/,
  );
  if (prefixedRate) {
    return cloneRule({
      scope: prefixedRate[1] === "夜間" ? "night" : "day",
      unitMinutes: defaultUnit,
      rate: prefixedRate[2],
    });
  }

  const bareRate = line.match(/^MOP\s*\$?(\d+(?:\.\d+)?)$/);
  if (bareRate) {
    return cloneRule({
      scope,
      unitMinutes: defaultUnit,
      rate: bareRate[1],
    });
  }

  return null;
}

function parseCaps(lines, notes) {
  const caps = {
    dayCap: null,
    nightCap: null,
    cap24h: null,
  };
  const joined = `${lines.join("\n")}\n${notes || ""}`;

  const dayCap = joined.match(/日間封頂\s*MOP\s*\$?(\d+(?:\.\d+)?)/);
  const nightCap = joined.match(/夜間封頂\s*MOP\s*\$?(\d+(?:\.\d+)?)/);
  const cap24 = joined.match(/(?:24小時|二十四小時)封頂\s*MOP\s*\$?(\d+(?:\.\d+)?)/);

  if (dayCap) caps.dayCap = Number(dayCap[1]);
  if (nightCap) caps.nightCap = Number(nightCap[1]);
  if (cap24) caps.cap24h = Number(cap24[1]);

  return caps;
}

function parseGraceMinutes(notes = "") {
  if (!notes) return null;
  if (/十五分鐘內(?:離場|出場)/.test(notes)) return 15;
  const numeric = notes.match(/(\d+)\s*分鐘內(?:離場|出場)/);
  return numeric ? Number(numeric[1]) : null;
}

function parsePackage(lines, defaultUnit) {
  const joined = lines.join("\n");
  const match = joined.match(
    /每連續\s*(\d+)\s*-\s*(\d+)\s*小時\s*MOP\s*\$?(\d+(?:\.\d+)?)/,
  );
  if (!match) return null;

  const fromMinutes = Number(match[1]) * 60;
  const toMinutes = Number(match[2]) * 60;
  const amount = Number(match[3]);
  const baseLine = lines.find(
    (line) =>
      !/每連續/.test(line) &&
      /MOP\s*\$?\d+(?:\.\d+)?/.test(line) &&
      !/封頂/.test(line),
  );
  const baseRule = baseLine
    ? parseRuleLine(baseLine, defaultUnit, "all")
    : null;

  return {
    fromMinutes,
    toMinutes,
    amount,
    baseRule: baseRule || {
      scope: "all",
      unitMinutes: defaultUnit,
      rate: amount / (fromMinutes / defaultUnit),
    },
  };
}

function parseVariantLabel(notes, number) {
  if (!notes) return `方案 ${number}`;
  const pattern = new RegExp(`[（(]?註${number}[）)]?\\s*[：:]\\s*([^。\\n]+)`);
  const match = notes.match(pattern);
  return match ? clean(match[1]) : `方案 ${number}`;
}

function splitMarkedVariants(text, notes) {
  const markerMatches = [...text.matchAll(/[（(]註(\d+)[）)]/g)];
  if (markerMatches.length < 2) return null;

  const variants = [];
  let cursor = 0;
  markerMatches.forEach((marker, index) => {
    const part = text.slice(cursor, marker.index);
    if (part.trim()) {
      variants.push({
        label: parseVariantLabel(notes, marker[1]),
        lines: part
          .split("\n")
          .map(clean)
          .filter(Boolean),
        id: `note-${marker[1]}`,
      });
    }
    cursor = marker.index + marker[0].length;
    if (index === markerMatches.length - 1) {
      const tail = text.slice(cursor);
      if (tail.trim()) {
        variants.push({
          label: parseVariantLabel(notes, marker[1]),
          lines: tail
            .split("\n")
            .map(clean)
            .filter(Boolean),
          id: `note-${marker[1]}`,
        });
      }
    }
  });
  return variants.length >= 2 ? variants : null;
}

function splitHeadingVariants(text) {
  const lines = text
    .split("\n")
    .map(clean)
    .filter(Boolean);
  const groups = [];
  let current = { id: "standard", label: "標準", lines: [] };

  for (const line of lines) {
    const isVariantHeading =
      /^(?:長度|高度|車長)/.test(line) && !/MOP\s*\$?\d/.test(line);
    if (isVariantHeading) {
      if (current.lines.length) groups.push(current);
      current = {
        id: `variant-${groups.length + 1}`,
        label: line,
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length || !groups.length) groups.push(current);
  return groups;
}

function noteCapForVehicle(vehicleKey, notes = "") {
  if (!notes) return {};

  const result = {};
  const isLight = ["light", "electricCar"].includes(vehicleKey);
  const isMotorcycle = ["motorcycle", "electricMotorcycle"].includes(vehicleKey);
  const isHeavy = vehicleKey === "heavy";

  if (isLight) {
    const cap24 = notes.match(
      /輕型汽車在每連續二十四小時內[^。]*上限為澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    const nightCap = notes.match(
      /輕型汽車在每連續夜間普通票[^。]*上限為澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    if (cap24) result.cap24h = Number(cap24[1]);
    if (nightCap) result.nightCap = Number(nightCap[1]);
  }

  if (isMotorcycle) {
    const cap24 = notes.match(
      /重型及輕型摩托車在每連續二十四小時內[^。]*上限為澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    const splitCaps = notes.match(
      /重型及輕型摩托車[^。]*上限分別為澳門元\s*(\d+(?:\.\d+)?)\s*元及澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    const nightCap = notes.match(
      /重型及輕型摩托車在每連續夜間普通票[^。]*上限為澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    if (cap24) result.cap24h = Number(cap24[1]);
    if (splitCaps) {
      result.dayCap = Number(splitCaps[1]);
      result.nightCap = Number(splitCaps[2]);
    }
    if (nightCap) result.nightCap = Number(nightCap[1]);
  }

  if (isHeavy) {
    const cap24 = notes.match(
      /重型(?:汽車|貨車|客車)在每連續二十四小時內[^。]*上限為澳門元\s*(\d+(?:\.\d+)?)\s*元/,
    );
    if (cap24) result.cap24h = Number(cap24[1]);
  }

  return result;
}

function buildOption({ id, label, lines, heading, notes }) {
  const defaultUnit = defaultUnitFromHeading(heading);
  const rules = [];
  let activeScope = "all";

  for (const line of lines) {
    const lineScope = scopeFromText(line);
    if (lineScope !== "all") activeScope = lineScope;
    const rule = parseRuleLine(line, defaultUnit, activeScope);
    if (rule) rules.push(rule);
  }

  const caps = {
    ...parseCaps(lines, notes),
    ...noteCapForVehicle("", notes),
  };
  const packageRule = parsePackage(lines, defaultUnit);
  const supported = rules.length > 0 || Boolean(packageRule);

  return {
    id,
    label: label || "標準",
    supported,
    rules,
    packageRule,
    dayCap: caps.dayCap,
    nightCap: caps.nightCap,
    cap24h: caps.cap24h,
    graceMinutes: parseGraceMinutes(notes),
    source: clean(lines.join("\n")),
  };
}

function noteCapsForOption(option, vehicleKey, notes) {
  const caps = noteCapForVehicle(vehicleKey, notes);
  return {
    ...option,
    dayCap: option.dayCap ?? caps.dayCap ?? null,
    nightCap: option.nightCap ?? caps.nightCap ?? null,
    cap24h: option.cap24h ?? caps.cap24h ?? null,
  };
}

export function parseVehicleTariff(park, vehicleKey) {
  const vehicle = VEHICLES[vehicleKey] || VEHICLES.light;
  const source = park?.tariffs?.[vehicle.tariffKey] || "";
  const notes = park?.tariffs?.notes || "";
  const heading = park?.feeHeading || "";

  if (!source || source === "-" || clean(source) === "—") {
    return {
      supported: false,
      heading,
      source,
      notes,
      options: [],
    };
  }

  const markedVariants = splitMarkedVariants(source, notes);
  const variants = markedVariants || splitHeadingVariants(source);
  const options = variants
    .map((variant) =>
      buildOption({
        id: variant.id,
        label: variant.label,
        lines: variant.lines,
        heading,
        notes,
      }),
    )
    .map((option) => noteCapsForOption(option, vehicleKey, notes));

  return {
    supported: options.some((option) => option.supported),
    heading,
    source,
    notes,
    options,
  };
}

function getPeriodScope(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= DAY_START && minutes < NIGHT_START ? "day" : "night";
}

function getNextBoundary(date) {
  const next = new Date(date);
  const scope = getPeriodScope(date);

  if (scope === "day") {
    next.setHours(20, 0, 0, 0);
    return next;
  }

  if (date.getHours() < 8) {
    next.setHours(8, 0, 0, 0);
    return next;
  }

  next.setDate(next.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next;
}

function makeSegments(entry, exit, option) {
  const hasScopedRules = option.rules.some((rule) => rule.scope !== "all");
  if (!hasScopedRules) {
    return [
      {
        scope: "all",
        start: entry,
        end: exit,
        minutes: (exit - entry) / MINUTE,
      },
    ];
  }

  const segments = [];
  let cursor = new Date(entry);
  while (cursor < exit) {
    const scope = getPeriodScope(cursor);
    const boundary = getNextBoundary(cursor);
    const end = boundary < exit ? boundary : exit;
    segments.push({
      scope,
      start: new Date(cursor),
      end: new Date(end),
      minutes: (end - cursor) / MINUTE,
    });
    cursor = end;
  }
  return segments;
}

function chargeRule(rule, minutes) {
  if (!rule || minutes <= 0) return 0;
  if (rule.firstMinutes && rule.firstRate !== null) {
    const remaining = Math.max(0, minutes - rule.firstMinutes);
    return (
      rule.firstRate +
      Math.ceil(remaining / rule.unitMinutes) * rule.rate
    );
  }
  return Math.ceil(minutes / rule.unitMinutes) * rule.rate;
}

function ruleLabel(rule) {
  const scope =
    rule.scope === "day" ? "日間" : rule.scope === "night" ? "夜間" : "全日";
  const unit = rule.unitMinutes === 30 ? "半小時" : "小時";
  if (rule.firstMinutes && rule.firstRate !== null) {
    return `${scope}首小時 MOP $${rule.firstRate}，其後每${unit} MOP $${rule.rate}`;
  }
  return `${scope}每${unit} MOP $${rule.rate}`;
}

function capRecords(records, cap, predicate = () => true) {
  const groups = new Map();
  records.forEach((record, index) => {
    if (!predicate(record)) return;
    const key = record.capKey || String(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  for (const group of groups.values()) {
    const total = group.reduce((sum, record) => sum + record.charge, 0);
    if (total <= cap) continue;
    const ratio = cap / total;
    for (const record of group) {
      record.originalCharge = record.charge;
      record.charge *= ratio;
      record.capped = true;
    }
  }
}

function applyCaps(records, option) {
  if (option.dayCap !== null) {
    capRecords(records, option.dayCap, (record) => record.scope === "day");
  }
  if (option.nightCap !== null) {
    capRecords(records, option.nightCap, (record) => record.scope === "night");
  }
  if (option.cap24h !== null) {
    capRecords(records, option.cap24h);
  }
}

function calculatePackage(option, durationMinutes) {
  const pricing = option.packageRule;
  if (!pricing) return null;

  const records = [];
  if (durationMinutes <= pricing.fromMinutes) {
    const charge = chargeRule(pricing.baseRule, durationMinutes);
    records.push({
      scope: "all",
      minutes: durationMinutes,
      charge,
      label: `${ruleLabel(pricing.baseRule)}，12 小時內按錶計費`,
    });
    return { amount: charge, records };
  }

  const packageCount = Math.ceil(durationMinutes / pricing.toMinutes);
  const amount = packageCount * pricing.amount;
  records.push({
    scope: "all",
    minutes: durationMinutes,
    charge: amount,
    label: `每連續 ${pricing.fromMinutes / 60}-${pricing.toMinutes / 60} 小時 MOP $${pricing.amount}`,
  });
  return { amount, records };
}

function calculateOption(option, entry, exit, entryDate) {
  const durationMinutes = Math.max(0, (exit - entry) / MINUTE);
  if (durationMinutes === 0) {
    return { amount: 0, records: [], message: "入場與離場時間相同。" };
  }

  if (option.graceMinutes && durationMinutes <= option.graceMinutes) {
    return {
      amount: 0,
      records: [
        {
          scope: "all",
          minutes: durationMinutes,
          charge: 0,
          label: `${option.graceMinutes} 分鐘內離場免費`,
        },
      ],
    };
  }

  const packageResult = calculatePackage(option, durationMinutes);
  if (packageResult) return packageResult;

  if (!option.rules.length) {
    return {
      amount: null,
      records: [],
      message: "官方收費文字未能可靠拆解。",
    };
  }

  const segments = makeSegments(entry, exit, option);
  const records = [];

  for (const segment of segments) {
    const rule =
      option.rules.find((candidate) => candidate.scope === segment.scope) ||
      option.rules.find((candidate) => candidate.scope === "all");

    if (!rule) {
      return {
        amount: null,
        records: [],
        message: `官方規則未包含${
          segment.scope === "day" ? "日間" : "夜間"
        }收費。`,
      };
    }

    records.push({
      ...segment,
      charge: chargeRule(rule, segment.minutes),
      capKey:
        segment.scope === "all"
          ? String(Math.floor((segment.start - entryDate) / (24 * 60 * MINUTE)))
          : `${dateKey(segment.start)}-${segment.scope}`,
      label: ruleLabel(rule),
    });
  }

  applyCaps(records, option);
  const amount = records.reduce((sum, record) => sum + record.charge, 0);
  return { amount: roundMoney(amount), records };
}

export function getParkingAmount(park, vehicleKey) {
  if (vehicleKey === "heavy") {
    const values = HEAVY_KEYS.map((key) => park?.live?.[key]).filter(Boolean);
    if (!values.length) return null;
    const total = values.reduce((sum, value) => sum + (value.total || 0), 0);
    const available = values.reduce(
      (sum, value) => sum + (value.available || 0),
      0,
    );
    return {
      available,
      total,
      maintenance: Boolean(park?.maintenance),
    };
  }
  const value = park?.live?.[vehicleKey];
  return value
    ? {
        ...value,
        maintenance: Boolean(park?.maintenance || value.maintenance),
      }
    : null;
}

export function getVehicleChoices(park) {
  const choices = [];
  for (const [key, vehicle] of Object.entries(VEHICLES)) {
    const availability = getParkingAmount(park, key);
    const tariff = parseVehicleTariff(park, key);
    if (
      (availability && availability.total !== null) ||
      tariff.supported ||
      (key === "heavy" &&
        Object.prototype.hasOwnProperty.call(park?.tariffs || {}, "heavy") &&
        park.tariffs.heavy !== "-")
    ) {
      choices.push(key);
    }
  }
  return choices.length ? choices : ["light"];
}

export function calculateParkingCost({
  park,
  vehicleKey,
  entry,
  exit,
  optionId,
}) {
  const entryDate = entry instanceof Date ? entry : new Date(entry);
  const exitDate = exit instanceof Date ? exit : new Date(exit);

  if (
    Number.isNaN(entryDate.getTime()) ||
    Number.isNaN(exitDate.getTime()) ||
    exitDate <= entryDate
  ) {
    return {
      supported: false,
      amount: null,
      message: "離場時間必須晚於入場時間。",
      breakdown: [],
      source: "",
    };
  }

  const parsed = parseVehicleTariff(park, vehicleKey);
  if (!parsed.supported) {
    return {
      supported: false,
      amount: null,
      message: "此車種的官方收費資料未能自動計算，請查看官方原文。",
      breakdown: [],
      source: parsed.source,
    };
  }

  const option =
    parsed.options.find((candidate) => candidate.id === optionId) ||
    parsed.options.find((candidate) => candidate.supported);

  if (!option?.supported) {
    return {
      supported: false,
      amount: null,
      message: "此車種的官方收費資料未能自動計算，請查看官方原文。",
      breakdown: [],
      source: parsed.source,
      option,
    };
  }

  const result = calculateOption(option, entryDate, exitDate, entryDate);
  const durationMinutes = (exitDate - entryDate) / MINUTE;

  return {
    supported: result.amount !== null,
    amount: result.amount,
    message: result.message || null,
    durationMinutes,
    option,
    options: parsed.options,
    source: parsed.source,
    heading: parsed.heading,
    breakdown: result.records,
  };
}

export function summarizeTariff(park, vehicleKey) {
  const parsed = parseVehicleTariff(park, vehicleKey);
  if (!parsed.supported) return "收費請查看官方原文";

  if (parsed.options.length > 1) {
    return `${parsed.options.length} 種車長收費方案`;
  }

  const option = parsed.options[0];
  const labels = option.rules.map((rule) => {
    const unit = rule.unitMinutes === 30 ? "半小時" : "小時";
    const scope =
      rule.scope === "day" ? "日" : rule.scope === "night" ? "夜" : "";
    if (rule.firstMinutes && rule.firstRate !== null) {
      return `${scope}首小時 $${rule.firstRate}，其後 $${rule.rate}/${unit}`;
    }
    return `${scope} $${rule.rate}/${unit}`;
  });
  if (option.cap24h) labels.push(`24 小時上限 $${option.cap24h}`);
  return labels.join(" · ");
}

export function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  return number % 1 === 0 ? `MOP $${number}` : `MOP $${number.toFixed(2).replace(/0$/, "")}`;
}

export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  if (!hours) return `${remaining} 分鐘`;
  if (!remaining) return `${hours} 小時`;
  return `${hours} 小時 ${remaining} 分鐘`;
}
