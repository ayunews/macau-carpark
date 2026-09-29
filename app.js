import {
  VEHICLES,
  calculateParkingCost,
  formatDuration,
  formatMoney,
  getParkingAmount,
  getVehicleChoices,
  parseVehicleTariff,
  summarizeTariff,
} from "./billing.js";

const DATA_URL = "./data/carparks.json";
const MACAU_CENTER = { lat: 22.1987, lng: 113.5439 };
const REFRESH_INTERVAL = 60 * 1000;
const EMBEDDED_DATA = window.__CARPARK_DATA__ || null;

const CATEGORY_META = {
  light: { label: "輕型汽車", icon: "car-front" },
  motorcycle: { label: "電單車", icon: "bike" },
  electricCar: { label: "電動汽車", icon: "car" },
  electricMotorcycle: { label: "電動電單車", icon: "zap" },
  accessible: { label: "傷健車位", icon: "accessibility" },
  heavyUnder7m: { label: "7 米或以下重型車", icon: "truck" },
  heavyOver7m: { label: "7 米以上重型車", icon: "truck" },
  heavyUnder8m: { label: "8 米或以下重型車", icon: "truck" },
  heavyOver8m: { label: "8 米以上重型車", icon: "truck" },
};

const state = {
  data: null,
  mode: "nearby",
  vehicle: "light",
  search: "",
  region: "all",
  onlyAvailable: false,
  sort: "distance",
  userLocation: null,
  locationAccuracy: null,
  locationStatus: "idle",
  map: null,
  markerLayer: null,
  userLayer: null,
  mapKey: "",
  mapLocationKey: "",
  markerByPark: new Map(),
  mapCandidates: [],
  mapVisibleParkIds: null,
  mapMoveTimer: null,
  selectedParkId: null,
  comparison: {
    enabled: true,
    entry: null,
    exit: null,
  },
  simulator: {
    parkId: null,
    vehicle: "light",
    optionId: null,
    entry: null,
    exit: null,
  },
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  simulatorButton: document.querySelector("#simulatorButton"),
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  regionFilter: document.querySelector("#regionFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  onlyAvailable: document.querySelector("#onlyAvailable"),
  compareEnabled: document.querySelector("#compareEnabled"),
  compareEntry: document.querySelector("#compareEntry"),
  compareExit: document.querySelector("#compareExit"),
  compareSummary: document.querySelector("#compareSummary"),
  vehicleSwitch: document.querySelector("#vehicleSwitch"),
  viewSwitch: document.querySelector("#viewSwitch"),
  metricAvailable: document.querySelector("#metricAvailable"),
  metricParks: document.querySelector("#metricParks"),
  metricFull: document.querySelector("#metricFull"),
  metricDistance: document.querySelector("#metricDistance"),
  sourceStatus: document.querySelector("#sourceStatus"),
  nearbyPanel: document.querySelector("#nearbyPanel"),
  nearbyResults: document.querySelector("#nearbyResults"),
  nearbyContext: document.querySelector("#nearbyContext"),
  listPanel: document.querySelector("#listPanel"),
  listSummary: document.querySelector("#listSummary"),
  listResults: document.querySelector("#listResults"),
  mapPanel: document.querySelector("#mapPanel"),
  map: document.querySelector("#map"),
  mapFallback: document.querySelector("#mapFallback"),
  mapEmpty: document.querySelector("#mapEmpty"),
  mapLocationContext: document.querySelector("#mapLocationContext"),
  mapSummary: document.querySelector("#mapSummary"),
  mapResults: document.querySelector("#mapResults"),
  detailDrawer: document.querySelector("#detailDrawer"),
  detailContent: document.querySelector("#detailContent"),
  simulatorDialog: document.querySelector("#simulatorDialog"),
  simulatorForm: document.querySelector("#simulatorForm"),
  simulatorPark: document.querySelector("#simulatorPark"),
  simulatorVehicle: document.querySelector("#simulatorVehicle"),
  simulatorVariant: document.querySelector("#simulatorVariant"),
  simulatorVariantField: document.querySelector("#simulatorVariantField"),
  simulatorEntry: document.querySelector("#simulatorEntry"),
  simulatorExit: document.querySelector("#simulatorExit"),
  simulatorParkContext: document.querySelector("#simulatorParkContext"),
  simulatorAmount: document.querySelector("#simulatorAmount"),
  simulatorDuration: document.querySelector("#simulatorDuration"),
  simulatorMessage: document.querySelector("#simulatorMessage"),
  simulatorBreakdown: document.querySelector("#simulatorBreakdown"),
  simulatorSource: document.querySelector("#simulatorSource"),
  closeSimulator: document.querySelector("#closeSimulator"),
  applyComparison: document.querySelector("#applyComparison"),
  toast: document.querySelector("#toast"),
};

const numberFormatter = new Intl.NumberFormat("zh-HK");
const dateTimeFormatter = new Intl.DateTimeFormat("zh-HK", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function icon(name, className = "") {
  return `<i data-lucide="${escapeHtml(name)}"${className ? ` class="${className}"` : ""} aria-hidden="true"></i>`;
}

function renderIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function showToast(message, tone = "default") {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3600);
}

function parseSourceDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : parseSourceDate(value);
  return date ? dateTimeFormatter.format(date) : "未提供";
}

function relativeMinutes(value) {
  const date = parseSourceDate(value);
  if (!date) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function toLocalInput(date) {
  const value = new Date(date);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function haversineKm(a, b) {
  const radius = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function distanceFor(park) {
  if (!state.userLocation || !park.coordinate) return null;
  return haversineKm(state.userLocation, park.coordinate);
}

function formatDistance(value) {
  if (value === null || value === undefined) return "距離未提供";
  if (value < 1) return `${Math.round(value * 1000)} 米`;
  return `${value.toFixed(value < 10 ? 1 : 0)} 公里`;
}

function comparisonResult(park) {
  if (
    !state.comparison.enabled ||
    !state.comparison.entry ||
    !state.comparison.exit
  ) {
    return null;
  }
  return calculateParkingCost({
    park,
    vehicleKey: state.vehicle,
    entry: state.comparison.entry,
    exit: state.comparison.exit,
  });
}

function comparisonSortValue(result) {
  if (!result?.supported || result.amount === null) return Number.POSITIVE_INFINITY;
  return result.amount;
}

function comparisonPeriodLabel() {
  if (!state.comparison.entry || !state.comparison.exit) return "—";
  const minutes = Math.max(
    0,
    (new Date(state.comparison.exit) - new Date(state.comparison.entry)) / 60000,
  );
  return Number.isFinite(minutes) ? formatDuration(minutes) : "—";
}

function regionFor(park) {
  if (park.locality) {
    if (/氹仔/.test(park.locality)) return "氹仔";
    if (/路環/.test(park.locality)) return "路環";
    return "澳門";
  }
  if (park.coordinate?.locality) return park.coordinate.locality;
  const text = `${park.name || ""} ${park.location || ""}`;
  if (/路環|路环|石排灣|石排湾|九澳|黑沙/.test(text)) return "路環";
  if (/氹仔|氹仔|taipa|北安|碼頭|码头/.test(text)) return "氹仔";
  return "澳門";
}

function availabilityState(availability) {
  if (!availability || availability.available === null) {
    if (availability?.maintenance) {
      return { className: "maintenance", label: "維護中" };
    }
    return { className: "unknown", label: "暫無數據" };
  }
  if (availability.total !== null && availability.available === 0) {
    return { className: "full", label: "已滿" };
  }
  if (
    availability.total !== null &&
    availability.total > 0 &&
    availability.available / availability.total <= 0.1
  ) {
    return { className: "low", label: "緊張" };
  }
  if (
    availability.total !== null &&
    availability.total > 0 &&
    availability.available / availability.total <= 0.3
  ) {
    return { className: "limited", label: "有限" };
  }
  return { className: "open", label: "充足" };
}

function getParkById(id) {
  return state.data?.carparks.find((park) => park.id === Number(id)) || null;
}

function filteredParks() {
  if (!state.data) return [];
  const query = state.search.trim().toLowerCase();
  const parks = state.data.carparks.filter((park) => {
    const searchText = `${park.name} ${park.location || ""} ${park.entrance || ""}`.toLowerCase();
    if (query && !searchText.includes(query)) return false;
    if (state.region !== "all" && regionFor(park) !== state.region) return false;
    if (state.onlyAvailable) {
      const amount = getParkingAmount(park, state.vehicle);
      if (!amount || !amount.available) return false;
    }
    return true;
  });

  let sortMode =
    state.sort === "distance" && !state.userLocation ? "availability" : state.sort;
  if (sortMode === "fee" && !state.comparison.enabled) {
    sortMode = "availability";
  }

  return parks.sort((a, b) => {
    if (sortMode === "distance") {
      const aDistance = distanceFor(a);
      const bDistance = distanceFor(b);
      if (aDistance !== null && bDistance === null) return -1;
      if (aDistance === null && bDistance !== null) return 1;
      if (aDistance !== null && bDistance !== null && aDistance !== bDistance) {
        return aDistance - bDistance;
      }
    }

    if (sortMode === "availability") {
      const aAvailable = getParkingAmount(a, state.vehicle)?.available ?? -1;
      const bAvailable = getParkingAmount(b, state.vehicle)?.available ?? -1;
      if (aAvailable !== bAvailable) return bAvailable - aAvailable;
    }

    if (sortMode === "fee") {
      const aFee = comparisonSortValue(comparisonResult(a));
      const bFee = comparisonSortValue(comparisonResult(b));
      if (aFee !== bFee) return aFee - bFee;
    }

    return a.name.localeCompare(b.name, "zh-HK");
  });
}

function renderSourceStatus() {
  const generatedMinutes = relativeMinutes(state.data?.meta?.generatedAt);
  const sourceMinutes = relativeMinutes(state.data?.meta?.sourceUpdatedAt);
  const isStale = generatedMinutes !== null && generatedMinutes > 45;
  const label = state.data
    ? `資料同步：${formatDateTime(state.data.meta.generatedAt)}`
    : "正在載入資料";

  elements.sourceStatus.dataset.state = isStale ? "warning" : "ready";
  elements.sourceStatus.innerHTML = `
    <span class="status-dot" aria-hidden="true"></span>
    <span>${escapeHtml(label)}</span>
    ${
      sourceMinutes !== null
        ? `<span class="source-age">${sourceMinutes < 1 ? "即時" : `${sourceMinutes} 分鐘前`}</span>`
        : ""
    }
  `;
}

function renderVehicleSwitch() {
  const parks = state.data?.carparks || [];
  elements.vehicleSwitch.innerHTML = Object.entries(VEHICLES)
    .filter(([key]) => key !== "heavy" || parks.some((park) => getVehicleChoices(park).includes("heavy")))
    .map(([key, vehicle]) => {
      const available = parks.reduce((sum, park) => {
        const amount = getParkingAmount(park, key);
        return sum + (amount?.available || 0);
      }, 0);
      return `
        <button
          class="vehicle-option${state.vehicle === key ? " is-active" : ""}"
          type="button"
          role="tab"
          aria-selected="${state.vehicle === key}"
          data-action="vehicle"
          data-vehicle="${escapeHtml(key)}"
          title="${escapeHtml(vehicle.label)}"
        >
          ${icon(vehicle.icon)}
          <span>${escapeHtml(vehicle.label)}</span>
          <small>${numberFormatter.format(available)}</small>
        </button>
      `;
    })
    .join("");
}

function renderModeSwitch() {
  elements.viewSwitch.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  elements.nearbyPanel.hidden = state.mode !== "nearby";
  elements.listPanel.hidden = state.mode !== "list";
  elements.mapPanel.hidden = state.mode !== "map";
}

function renderMetrics(parks) {
  const known = parks.filter((park) => {
    const amount = getParkingAmount(park, state.vehicle);
    return amount && amount.available !== null;
  });
  const available = known.reduce(
    (sum, park) => sum + (getParkingAmount(park, state.vehicle)?.available || 0),
    0,
  );
  const full = known.filter(
    (park) => getParkingAmount(park, state.vehicle)?.available === 0,
  ).length;
  const nearest = state.userLocation
    ? parks
        .map((park) => distanceFor(park))
        .filter((distance) => distance !== null)
        .sort((a, b) => a - b)[0]
    : null;

  elements.metricAvailable.textContent = numberFormatter.format(available);
  elements.metricParks.textContent = numberFormatter.format(parks.length);
  elements.metricFull.textContent = numberFormatter.format(full);
  elements.metricDistance.textContent =
    nearest === null || nearest === undefined ? "—" : formatDistance(nearest);
}

function renderComparisonControls(parks) {
  elements.compareEnabled.checked = state.comparison.enabled;
  elements.compareEntry.disabled = !state.comparison.enabled;
  elements.compareExit.disabled = !state.comparison.enabled;

  if (
    state.comparison.entry &&
    document.activeElement !== elements.compareEntry
  ) {
    elements.compareEntry.value = toLocalInput(state.comparison.entry);
  }
  if (
    state.comparison.exit &&
    document.activeElement !== elements.compareExit
  ) {
    elements.compareExit.value = toLocalInput(state.comparison.exit);
  }

  if (!state.comparison.enabled) {
    elements.compareSummary.textContent = "計費比較已隱藏";
    return;
  }

  const results = parks
    .map((park) => comparisonResult(park))
    .filter((result) => result?.supported && result.amount !== null);
  const lowest = results.length
    ? Math.min(...results.map((result) => result.amount))
    : null;

  elements.compareSummary.textContent = `${comparisonPeriodLabel()} · ${
    results.length
  } 個可估算${
    lowest === null ? "" : ` · 最低 ${formatMoney(lowest)}`
  }`;
}

function renderLocationContext() {
  if (state.locationStatus === "loading") {
    return `
      <div class="location-strip is-loading">
        ${icon("loader-circle", "spin")}
        <span>正在取得目前位置</span>
      </div>
    `;
  }

  if (!state.userLocation) {
    const denied = state.locationStatus === "denied";
    return `
      <div class="location-strip">
        <span class="location-icon">${icon("navigation")}</span>
        <div>
          <strong>${denied ? "未能取得目前位置" : "按距離尋找最近停車場"}</strong>
          <span>${denied ? "可在瀏覽器設定重新允許位置存取" : "位置只會在此裝置上計算"}</span>
        </div>
        <button class="secondary-button" type="button" data-action="locate">
          ${icon("locate-fixed")}
          <span>使用目前位置</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="location-strip is-ready">
      <span class="location-icon">${icon("circle-check")}</span>
      <div>
        <strong>已按目前位置排列</strong>
        <span>顯示最接近的停車場及直線距離</span>
      </div>
      <button class="icon-button" type="button" data-action="locate" title="更新目前位置" aria-label="更新目前位置">
        ${icon("refresh-cw")}
      </button>
    </div>
  `;
}

function sortParksForMap(parks) {
  const sorted = [...parks];
  if (state.userLocation) {
    sorted.sort((a, b) => {
      const aDistance = distanceFor(a);
      const bDistance = distanceFor(b);
      if (aDistance !== null && bDistance === null) return -1;
      if (aDistance === null && bDistance !== null) return 1;
      if (aDistance !== null && bDistance !== null && aDistance !== bDistance) {
        return aDistance - bDistance;
      }
      return (
        (getParkingAmount(b, state.vehicle)?.available ?? -1) -
        (getParkingAmount(a, state.vehicle)?.available ?? -1)
      );
    });
    return sorted;
  }

  return sorted.sort(
    (a, b) =>
      (getParkingAmount(b, state.vehicle)?.available ?? -1) -
      (getParkingAmount(a, state.vehicle)?.available ?? -1),
  );
}

function renderMapLocationContext() {
  if (state.locationStatus === "loading") {
    return `
      <div class="map-location-strip is-loading">
        ${icon("loader-circle", "spin")}
        <span>正在取得目前位置</span>
      </div>
    `;
  }

  if (!state.userLocation) {
    const denied = state.locationStatus === "denied";
    return `
      <div class="map-location-strip">
        <span>${denied ? "未能取得目前位置，列表暫按空位排列" : "以目前位置為中心搜尋最近停車場"}</span>
        <button class="secondary-button" type="button" data-action="locate">
          ${icon("locate-fixed")}
          <span>${denied ? "重新定位" : "使用目前位置"}</span>
        </button>
      </div>
    `;
  }

  const accuracy = state.locationAccuracy
    ? `定位範圍約 ±${Math.round(state.locationAccuracy)} 米`
    : "已使用目前位置";
  return `
    <div class="map-location-strip is-ready">
      <span>${icon("circle-check")} ${escapeHtml(accuracy)}</span>
      <button class="icon-button" type="button" data-action="locate" title="更新目前位置" aria-label="更新目前位置">
        ${icon("refresh-cw")}
      </button>
    </div>
  `;
}

function renderParkCard(park, { compact = false, mapMode = false } = {}) {
  const availability = getParkingAmount(park, state.vehicle);
  const status = availabilityState(availability);
  const distance = distanceFor(park);
  const tariff = summarizeTariff(park, state.vehicle);
  const estimate = comparisonResult(park);
  const availableValue =
    availability?.available === null || availability?.available === undefined
      ? "—"
      : numberFormatter.format(availability.available);
  const totalValue =
    availability?.total === null || availability?.total === undefined
      ? "—"
      : numberFormatter.format(availability.total);
  const height =
    park.heightLimit &&
    !/^(-|—|--|待定|不適用)$/.test(park.heightLimit)
      ? `限高 ${park.heightLimit} 米`
      : null;
  const estimateMarkup = state.comparison.enabled
    ? `
      <div class="estimate-block${estimate?.supported ? "" : " is-unsupported"}">
        <span>估算費用</span>
        <strong>${estimate?.supported ? escapeHtml(formatMoney(estimate.amount)) : "待公布"}</strong>
        <small>${escapeHtml(comparisonPeriodLabel())}</small>
      </div>
    `
    : "";

  return `
    <article class="park-card ${compact ? "is-compact" : ""}${state.comparison.enabled ? " has-estimate" : ""}" data-park-card="${park.id}">
      <div class="availability-block status-${status.className}">
        <strong>${availableValue}</strong>
        <span>空位 / ${totalValue}</span>
        <em>${escapeHtml(status.label)}</em>
      </div>
      <div class="park-card-body">
        <div class="park-title-row">
          <h3>
            <button type="button" data-action="${mapMode ? "focus-map" : "open-detail"}" data-park-id="${park.id}">
              ${escapeHtml(park.name)}
            </button>
          </h3>
          <span class="park-labels">
            ${park.isNew ? `<span class="new-label">新加入</span>` : ""}
            <span class="region-label">${escapeHtml(regionFor(park))}</span>
          </span>
        </div>
        <p class="park-location">${escapeHtml(park.location || "位置詳情請參閱官方資料")}</p>
        <div class="park-meta">
          <span>${icon(VEHICLES[state.vehicle].icon)} ${escapeHtml(VEHICLES[state.vehicle].shortLabel)} ${availableValue}/${totalValue}</span>
          ${distance !== null ? `<span>${icon("route")} ${escapeHtml(formatDistance(distance))}</span>` : ""}
          ${height ? `<span>${icon("between-vertical-start")} ${escapeHtml(height)}</span>` : ""}
          <span>${icon("clock-3")} 更新 ${escapeHtml(formatDateTime(park.liveUpdatedAt))}</span>
        </div>
        <div class="park-fee">
          ${icon("circle-dollar-sign")}
          <span>${escapeHtml(tariff)}</span>
        </div>
      </div>
      ${estimateMarkup}
      <div class="park-card-actions">
        ${
          mapMode
            ? `<button
                class="icon-button"
                type="button"
                data-action="focus-map"
                data-park-id="${park.id}"
                title="在地圖定位"
                aria-label="在地圖定位 ${escapeHtml(park.name)}"
              >
                ${icon("locate-fixed")}
              </button>`
            : ""
        }
        <button
          class="icon-button"
          type="button"
          data-action="simulate"
          data-park-id="${park.id}"
          title="模擬停車費用"
          aria-label="模擬 ${escapeHtml(park.name)} 的停車費用"
        >
          ${icon("calculator")}
        </button>
        <button class="secondary-button" type="button" data-action="open-detail" data-park-id="${park.id}">
          <span>詳情</span>
          ${icon("chevron-right")}
        </button>
      </div>
    </article>
  `;
}

function emptyState(message = "找不到符合條件的停車場") {
  return `
    <div class="empty-state">
      ${icon("circle-off")}
      <strong>${escapeHtml(message)}</strong>
      <span>可清除搜尋或切換車種後再試</span>
    </div>
  `;
}

function renderMapResults(candidates = state.mapCandidates) {
  const visibleCandidates = state.mapVisibleParkIds
    ? candidates.filter((park) => state.mapVisibleParkIds.has(park.id))
    : candidates;
  const mapParks = sortParksForMap(visibleCandidates);
  elements.mapResults.innerHTML = mapParks.length
    ? mapParks
        .map((park) => renderParkCard(park, { compact: true, mapMode: true }))
        .join("")
    : emptyState("目前地圖範圍沒有停車場");
  elements.mapSummary.textContent = `${numberFormatter.format(
    mapParks.filter((park) => park.coordinate).length,
  )} / ${numberFormatter.format(
    candidates.filter((park) => park.coordinate).length,
  )} 個地圖位置`;
  renderIcons();
}

function updateMapVisibleResults() {
  if (!state.map) return;
  const bounds = state.map.getBounds();
  const visible = state.mapCandidates.filter(
    (park) =>
      park.coordinate &&
      bounds.contains([park.coordinate.lat, park.coordinate.lng]),
  );
  state.mapVisibleParkIds = new Set(visible.map((park) => park.id));
  renderMapResults();
}

function renderLists(parks) {
  state.mapCandidates = parks;
  if (state.mode !== "map" || !state.mapVisibleParkIds) {
    state.mapVisibleParkIds = new Set(
      parks.filter((park) => park.coordinate).map((park) => park.id),
    );
  }
  const markup = parks.length
    ? parks.map((park) => renderParkCard(park)).join("")
    : emptyState();

  elements.nearbyContext.innerHTML = renderLocationContext();
  elements.nearbyResults.innerHTML = markup;
  elements.listResults.innerHTML = markup;
  elements.mapLocationContext.innerHTML = renderMapLocationContext();
  elements.listSummary.textContent = `${numberFormatter.format(parks.length)} 個停車場`;
  renderMapResults(parks);
}

function popupMarkup(park) {
  const availability = getParkingAmount(park, state.vehicle);
  const status = availabilityState(availability);
  const estimate = comparisonResult(park);
  return `
    <div class="map-popup">
      <span class="map-popup-region">${escapeHtml(regionFor(park))}</span>
      <strong>${escapeHtml(park.name)}</strong>
      <div class="map-popup-availability status-${status.className}">
        <b>${availability?.available ?? "—"}</b>
        <span>空位 / ${availability?.total ?? "—"}</span>
      </div>
      ${
        state.comparison.enabled
          ? `<div class="map-popup-estimate"><span>估算費用</span><b>${estimate?.supported ? escapeHtml(formatMoney(estimate.amount)) : "待公布"}</b></div>`
          : ""
      }
      <p>${escapeHtml(summarizeTariff(park, state.vehicle))}</p>
      <button class="secondary-button" type="button" data-action="open-detail" data-park-id="${park.id}">
        詳情
        ${icon("chevron-right")}
      </button>
    </div>
  `;
}

function ensureMap() {
  if (state.map || !window.L) return state.map;

  state.map = window.L.map(elements.map, {
    zoomControl: false,
    attributionControl: true,
  }).setView([MACAU_CENTER.lat, MACAU_CENTER.lng], 12);

  window.L.control.zoom({ position: "bottomright" }).addTo(state.map);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.markerLayer = window.L.markerClusterGroup
    ? window.L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 46,
        iconCreateFunction(cluster) {
          return window.L.divIcon({
            html: `<span>${cluster.getChildCount()}</span>`,
            className: "map-cluster",
            iconSize: [38, 38],
          });
        },
      })
    : window.L.layerGroup();
  state.markerLayer.addTo(state.map);
  state.userLayer = window.L.layerGroup().addTo(state.map);
  state.map.on("popupopen", renderIcons);
  state.map.on("moveend zoomend", () => {
    window.clearTimeout(state.mapMoveTimer);
    state.mapMoveTimer = window.setTimeout(updateMapVisibleResults, 80);
  });

  return state.map;
}

function renderMap(parks) {
  if (!window.L) {
    elements.mapFallback.hidden = false;
    elements.map.hidden = true;
    return;
  }

  elements.mapFallback.hidden = true;
  elements.map.hidden = false;
  state.mapCandidates = parks;
  const map = ensureMap();
  if (!map) return;

  state.markerLayer.clearLayers();
  state.userLayer.clearLayers();
  state.markerByPark.clear();

  const withCoordinates = parks.filter((park) => park.coordinate);
  withCoordinates.forEach((park) => {
    const availability = getParkingAmount(park, state.vehicle);
    const status = availabilityState(availability);
    const marker = window.L.marker([park.coordinate.lat, park.coordinate.lng], {
      icon: window.L.divIcon({
        className: `map-marker status-${status.className}`,
        html: `<span>${availability?.available ?? "—"}</span>`,
        iconSize: [42, 34],
        iconAnchor: [21, 34],
        popupAnchor: [0, -34],
      }),
    }).bindPopup(popupMarkup(park));
    state.markerLayer.addLayer(marker);
    state.markerByPark.set(park.id, marker);
  });

  if (state.userLocation) {
    const radius = Math.max(40, state.locationAccuracy || 250);
    window.L.circle(
      [state.userLocation.lat, state.userLocation.lng],
      {
        radius,
        color: "#0b6b65",
        weight: 1.5,
        fillColor: "#0b6b65",
        fillOpacity: 0.1,
      },
    )
      .bindTooltip(`目前位置範圍約 ±${Math.round(radius)} 米`)
      .addTo(state.userLayer);

    window.L.circleMarker(
      [state.userLocation.lat, state.userLocation.lng],
      {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#0b6b65",
        fillOpacity: 1,
      },
    )
      .bindTooltip("目前位置")
      .addTo(state.userLayer);
  }

  elements.mapEmpty.hidden = withCoordinates.length > 0;

  const mapKey = withCoordinates
    .map((park) => park.id)
    .sort()
    .join(",");
  if (state.userLocation) {
    const locationKey = [
      state.userLocation.lat,
      state.userLocation.lng,
      state.locationAccuracy || 0,
    ].join(",");
    if (locationKey !== state.mapLocationKey) {
      const bounds = window.L.latLng(
        state.userLocation.lat,
        state.userLocation.lng,
      ).toBounds(Math.max(80, (state.locationAccuracy || 250) * 2));
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 });
      state.mapLocationKey = locationKey;
    }
    state.mapKey = mapKey;
  } else if (mapKey && mapKey !== state.mapKey && withCoordinates.length) {
    const bounds = window.L.latLngBounds(
      withCoordinates.map((park) => [park.coordinate.lat, park.coordinate.lng]),
    );
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14 });
    state.mapKey = mapKey;
    state.mapLocationKey = "";
  }

  updateMapVisibleResults();
  window.setTimeout(() => map.invalidateSize(), 60);
}

function renderAll() {
  if (!state.data) return;
  const parks = filteredParks();
  renderSourceStatus();
  renderVehicleSwitch();
  renderMetrics(parks);
  renderComparisonControls(parks);
  renderLists(parks);
  renderModeSwitch();
  if (state.mode === "map") {
    renderMap(parks);
  }
  renderIcons();
}

async function loadData({ silent = false } = {}) {
  if (!silent) {
    elements.refreshButton.classList.add("is-loading");
    elements.sourceStatus.dataset.state = "loading";
  }

  if (EMBEDDED_DATA) {
    state.data = EMBEDDED_DATA;
    renderAll();
    if (!silent) {
      showToast("已載入單檔版本內的停車場資料", "success");
    }
    elements.refreshButton.classList.remove("is-loading");
    return;
  }

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.carparks) || data.carparks.length === 0) {
      throw new Error("資料集為空");
    }
    state.data = data;
    renderAll();
    if (!silent) {
      showToast("已更新官方停車場資料", "success");
    }
  } catch (error) {
    console.error(error);
    elements.sourceStatus.dataset.state = "error";
    elements.sourceStatus.innerHTML = `
      <span class="status-dot" aria-hidden="true"></span>
      <span>資料暫時無法載入</span>
    `;
    showToast("未能載入停車場資料，請檢查網絡後重試", "error");
  } finally {
    elements.refreshButton.classList.remove("is-loading");
  }
}

async function requestLocalSync() {
  if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
  try {
    await fetch("/api/sync", { cache: "no-store" });
  } catch {
    // The static GitHub Pages deployment has no local sync endpoint.
  }
}

async function refreshData() {
  elements.refreshButton.classList.add("is-loading");
  await requestLocalSync();
  await loadData();
}

function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = "unavailable";
    showToast("此瀏覽器不支援位置存取", "error");
    renderAll();
    return;
  }

  state.locationStatus = "loading";
  renderAll();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      state.locationAccuracy = position.coords.accuracy || null;
      state.locationStatus = "ready";
      state.sort = "distance";
      renderAll();
    },
    (error) => {
      state.locationStatus = error.code === 1 ? "denied" : "unavailable";
      state.userLocation = null;
      state.locationAccuracy = null;
      renderAll();
      showToast("未能取得目前位置，已改用可用車位排序", "error");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 120000,
    },
  );
}

function occupancyRows(park) {
  return Object.entries(CATEGORY_META)
    .map(([key, meta]) => {
      const item = park.live?.[key];
      if (!item || (item.available === null && item.total === null)) return "";
      const available = item.available ?? "—";
      const total = item.total ?? "—";
      const status = availabilityState(item);
      return `
        <div class="occupancy-row">
          <span class="occupancy-label">${icon(meta.icon)} ${escapeHtml(meta.label)}</span>
          <span class="occupancy-value status-${status.className}">
            <b>${available}</b>
            <span>/ ${total}</span>
          </span>
        </div>
      `;
    })
    .filter(Boolean)
    .join("");
}

function tariffBlock(label, value) {
  if (!value) return "";
  return `
    <div class="tariff-block">
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(value).replace(/\n/g, "<br />")}</p>
    </div>
  `;
}

function openDetail(parkId) {
  const park = getParkById(parkId);
  if (!park) return;
  state.selectedParkId = park.id;
  const distance = distanceFor(park);
  const availability = getParkingAmount(park, state.vehicle);
  const status = availabilityState(availability);
  const estimate = comparisonResult(park);
  const mapsUrl = park.coordinate
    ? `https://www.google.com/maps/dir/?api=1&destination=${park.coordinate.lat},${park.coordinate.lng}`
    : null;

  elements.detailContent.innerHTML = `
    <header class="drawer-header">
      <div>
        <span class="eyebrow">${park.isNew ? "新加入 · " : ""}${escapeHtml(regionFor(park))} · ${escapeHtml(VEHICLES[state.vehicle].label)}</span>
        <h2>${escapeHtml(park.name)}</h2>
      </div>
      <button class="icon-button" type="button" data-action="close-detail" title="關閉" aria-label="關閉詳情">
        ${icon("x")}
      </button>
    </header>

    <div class="drawer-hero status-${status.className}">
      <div>
        <strong>${availability?.available ?? "—"}</strong>
        <span>目前空位</span>
      </div>
      <div>
        <strong>${availability?.total ?? "—"}</strong>
        <span>車位總數</span>
      </div>
      <div>
        <strong>${distance === null ? "—" : formatDistance(distance)}</strong>
        <span>直線距離</span>
      </div>
      ${
        state.comparison.enabled
          ? `<div>
              <strong>${estimate?.supported ? escapeHtml(formatMoney(estimate.amount)) : "待公布"}</strong>
              <span>${escapeHtml(comparisonPeriodLabel())}估算</span>
            </div>`
          : ""
      }
    </div>

    <section class="drawer-section">
      <div class="section-heading">
        <h3>即時車位</h3>
        <span>${escapeHtml(formatDateTime(park.liveUpdatedAt))}</span>
      </div>
      <div class="occupancy-list">
        ${occupancyRows(park) || `<p class="muted-text">此停車場未提供分類車位數據。</p>`}
      </div>
    </section>

    <section class="drawer-section">
      <div class="section-heading">
        <h3>位置與限制</h3>
      </div>
      <dl class="detail-list">
        <div><dt>位置</dt><dd>${escapeHtml(park.location || "未提供")}</dd></div>
        <div><dt>出入口</dt><dd>${escapeHtml(park.entrance || "未提供")}</dd></div>
        <div><dt>限高</dt><dd>${escapeHtml(park.heightLimit || "未提供")}${park.heightLimit && !/^(-|—|--)$/.test(park.heightLimit) ? " 米" : ""}</dd></div>
        <div><dt>電話</dt><dd>${escapeHtml(park.phone || "未提供")}</dd></div>
      </dl>
    </section>

    <section class="drawer-section">
      <div class="section-heading">
        <h3>官方收費</h3>
        <span>${escapeHtml(park.feeHeading || "")}</span>
      </div>
      <div class="tariff-grid">
        ${tariffBlock("輕型車輛", park.tariffs?.light)}
        ${tariffBlock("重型車輛", park.tariffs?.heavy)}
        ${tariffBlock("電單車", park.tariffs?.motorcycle)}
      </div>
      ${
        park.tariffs?.notes
          ? `<details class="source-disclosure"><summary>完整備註</summary><p>${escapeHtml(park.tariffs.notes).replace(/\n/g, "<br />")}</p></details>`
          : ""
      }
    </section>

    <footer class="drawer-actions">
      <button class="primary-button" type="button" data-action="simulate" data-park-id="${park.id}">
        ${icon("calculator")}
        <span>模擬計費</span>
      </button>
      ${
        mapsUrl
          ? `<a class="secondary-button" href="${mapsUrl}" target="_blank" rel="noreferrer">${icon("navigation")}<span>導航</span></a>`
          : ""
      }
      <a class="secondary-button" href="${escapeHtml(park.officialUrl)}" target="_blank" rel="noreferrer">
        ${icon("external-link")}
        <span>官方</span>
      </a>
    </footer>
  `;

  elements.detailDrawer.showModal();
  renderIcons();
}

function closeDetail() {
  elements.detailDrawer.close();
}

function defaultSimulationTimes() {
  const entry = new Date();
  entry.setMinutes(Math.floor(entry.getMinutes() / 5) * 5, 0, 0);
  entry.setMinutes(entry.getMinutes() + 5);
  const exit = new Date(entry.getTime() + 60 * 60000);
  return { entry, exit };
}

function fillSimulatorParkSelect(selectedId) {
  const parks = [...state.data.carparks].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-HK"),
  );
  elements.simulatorPark.innerHTML = parks
    .map(
      (park) =>
        `<option value="${park.id}"${park.id === selectedId ? " selected" : ""}>${escapeHtml(park.name)}</option>`,
    )
    .join("");
}

function syncSimulatorVehicles(preferredVehicle = state.simulator.vehicle) {
  const park = getParkById(state.simulator.parkId);
  if (!park) return;
  const choices = getVehicleChoices(park);
  const selected = choices.includes(preferredVehicle) ? preferredVehicle : choices[0];
  state.simulator.vehicle = selected;
  elements.simulatorVehicle.innerHTML = choices
    .map(
      (key) =>
        `<option value="${key}"${key === selected ? " selected" : ""}>${escapeHtml(VEHICLES[key].label)}</option>`,
    )
    .join("");
  syncSimulatorVariants();
}

function syncSimulatorVariants() {
  const park = getParkById(state.simulator.parkId);
  const parsed = parseVehicleTariff(park, state.simulator.vehicle);
  const supportedOptions = parsed.options.filter((option) => option.supported);

  if (supportedOptions.length > 1) {
    elements.simulatorVariantField.hidden = false;
    elements.simulatorVariant.innerHTML = supportedOptions
      .map(
        (option) =>
          `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`,
      )
      .join("");
    const preferred = supportedOptions.find(
      (option) => option.id === state.simulator.optionId,
    );
    state.simulator.optionId = preferred?.id || supportedOptions[0].id;
    elements.simulatorVariant.value = state.simulator.optionId;
  } else {
    elements.simulatorVariantField.hidden = true;
    elements.simulatorVariant.innerHTML = "";
    state.simulator.optionId = supportedOptions[0]?.id || null;
  }

  calculateSimulation();
}

function calculateSimulation() {
  const park = getParkById(state.simulator.parkId);
  if (!park) return;
  const entry = new Date(elements.simulatorEntry.value);
  const exit = new Date(elements.simulatorExit.value);
  const availability = getParkingAmount(park, state.simulator.vehicle);
  const status = availabilityState(availability);

  elements.simulatorParkContext.innerHTML = `
    <div>
      <strong>${escapeHtml(park.name)}</strong>
      <span>${escapeHtml(regionFor(park))} · ${escapeHtml(park.location || "位置未提供")}</span>
    </div>
    <span class="availability-pill status-${status.className}">
      ${availability?.available ?? "—"} 空位 / ${availability?.total ?? "—"}
    </span>
  `;

  const result = calculateParkingCost({
    park,
    vehicleKey: state.simulator.vehicle,
    entry,
    exit,
    optionId: state.simulator.optionId,
  });

  elements.simulatorAmount.textContent =
    result.supported && result.amount !== null ? formatMoney(result.amount) : "—";
  elements.simulatorAmount.dataset.state = result.supported ? "ready" : "unsupported";
  elements.simulatorDuration.textContent = result.durationMinutes
    ? formatDuration(result.durationMinutes)
    : "—";
  elements.simulatorMessage.textContent = result.message || "";
  elements.simulatorMessage.hidden = !result.message;

  elements.simulatorBreakdown.innerHTML = result.breakdown?.length
    ? result.breakdown
        .map(
          (item) => `
            <div class="breakdown-row">
              <div>
                <strong>${escapeHtml(item.label || "泊車時段")}</strong>
                <span>${escapeHtml(formatDuration(item.minutes))}${item.capped ? " · 已套用封頂" : ""}</span>
              </div>
              <b>${escapeHtml(formatMoney(item.charge))}</b>
            </div>
          `,
        )
        .join("")
    : "";

  elements.simulatorSource.open = false;
  elements.simulatorSource.innerHTML = `
    <summary>官方收費原文</summary>
    <div class="source-block">
      <strong>${escapeHtml(result.heading || park.feeHeading || "收費資料")}</strong>
      <pre>${escapeHtml(result.source || "未提供")}</pre>
      ${
        park.tariffs?.notes
          ? `<p>${escapeHtml(park.tariffs.notes).replace(/\n/g, "<br />")}</p>`
          : ""
      }
    </div>
  `;
  renderIcons();
}

function openSimulator(parkId = state.selectedParkId) {
  if (!state.data) return;
  const preferred = getParkById(parkId) || filteredParks()[0] || state.data.carparks[0];
  state.simulator.parkId = preferred.id;
  fillSimulatorParkSelect(preferred.id);

  if (!state.simulator.entry || !state.simulator.exit) {
    const times = defaultSimulationTimes();
    state.simulator.entry = times.entry;
    state.simulator.exit = times.exit;
  }
  elements.simulatorEntry.value = toLocalInput(state.simulator.entry);
  elements.simulatorExit.value = toLocalInput(state.simulator.exit);

  const preferredVehicle = getVehicleChoices(preferred).includes(state.vehicle)
    ? state.vehicle
    : "light";
  syncSimulatorVehicles(preferredVehicle);

  if (!elements.simulatorDialog.open) {
    elements.simulatorDialog.showModal();
  }
  renderIcons();
}

function closeSimulator() {
  elements.simulatorDialog.close();
}

function focusMapPark(parkId) {
  const park = getParkById(parkId);
  if (!park?.coordinate || !state.map) return;
  const marker = state.markerByPark.get(park.id);
  state.map.flyTo([park.coordinate.lat, park.coordinate.lng], 16, {
    duration: 0.5,
  });
  if (marker) {
    window.setTimeout(() => marker.openPopup(), 520);
  }
}

function setMode(mode) {
  state.mode = mode;
  renderModeSwitch();
  if (mode === "map") {
    if (
      !state.userLocation &&
      !["loading", "denied", "unavailable"].includes(state.locationStatus)
    ) {
      requestLocation();
    } else {
      renderMap(filteredParks());
    }
  }
  renderIcons();
}

function setVehicle(vehicle) {
  if (!VEHICLES[vehicle]) return;
  state.vehicle = vehicle;
  state.mapKey = "";
  renderAll();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;
    const { action, parkId, vehicle, mode } = actionElement.dataset;

    if (action === "locate") requestLocation();
    if (action === "open-detail") openDetail(parkId);
    if (action === "simulate") {
      state.selectedParkId = Number(parkId);
      openSimulator(parkId);
    }
    if (action === "close-detail") closeDetail();
    if (action === "vehicle") setVehicle(vehicle);
    if (action === "mode") setMode(mode);
    if (action === "focus-map") {
      setMode("map");
      focusMapPark(parkId);
    }
  });

  elements.searchInput.addEventListener("input", () => {
    state.search = elements.searchInput.value;
    elements.clearSearch.hidden = !state.search;
    renderAll();
  });

  elements.clearSearch.addEventListener("click", () => {
    state.search = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    renderAll();
    elements.searchInput.focus();
  });

  elements.regionFilter.addEventListener("change", () => {
    state.region = elements.regionFilter.value;
    state.mapKey = "";
    renderAll();
  });

  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    if (state.sort === "fee") {
      state.comparison.enabled = true;
      elements.compareEnabled.checked = true;
    }
    renderAll();
  });

  elements.onlyAvailable.addEventListener("change", () => {
    state.onlyAvailable = elements.onlyAvailable.checked;
    state.mapKey = "";
    renderAll();
  });

  elements.compareEnabled.addEventListener("change", () => {
    state.comparison.enabled = elements.compareEnabled.checked;
    if (!state.comparison.enabled && state.sort === "fee") {
      state.sort = "availability";
      elements.sortSelect.value = "availability";
    }
    renderAll();
  });

  for (const input of [elements.compareEntry, elements.compareExit]) {
    input.addEventListener("change", () => {
      state.comparison.entry = new Date(elements.compareEntry.value);
      state.comparison.exit = new Date(elements.compareExit.value);
      renderAll();
    });
  }

  elements.refreshButton.addEventListener("click", refreshData);
  elements.simulatorButton.addEventListener("click", () => openSimulator());
  elements.closeSimulator.addEventListener("click", closeSimulator);
  elements.applyComparison.addEventListener("click", () => {
    const entry = new Date(elements.simulatorEntry.value);
    const exit = new Date(elements.simulatorExit.value);
    if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime()) || exit <= entry) {
      showToast("請先設定有效的入場及離場時間", "error");
      return;
    }
    state.comparison.enabled = true;
    state.comparison.entry = entry;
    state.comparison.exit = exit;
    state.vehicle = state.simulator.vehicle;
    closeSimulator();
    renderAll();
    showToast("已把本次計費時段套用到列表比較", "success");
  });

  elements.simulatorPark.addEventListener("change", () => {
    state.simulator.parkId = Number(elements.simulatorPark.value);
    state.simulator.optionId = null;
    syncSimulatorVehicles(state.simulator.vehicle);
  });

  elements.simulatorVehicle.addEventListener("change", () => {
    state.simulator.vehicle = elements.simulatorVehicle.value;
    state.simulator.optionId = null;
    syncSimulatorVariants();
  });

  elements.simulatorVariant.addEventListener("change", () => {
    state.simulator.optionId = elements.simulatorVariant.value;
    calculateSimulation();
  });

  for (const input of [elements.simulatorEntry, elements.simulatorExit]) {
    input.addEventListener("change", () => {
      state.simulator.entry = new Date(input.value);
      state.simulator.exit =
        input === elements.simulatorEntry
          ? new Date(elements.simulatorExit.value)
          : new Date(elements.simulatorEntry.value);
      calculateSimulation();
    });
  }

  elements.simulatorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateSimulation();
  });

  for (const dialog of [elements.detailDrawer, elements.simulatorDialog]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}

async function initialize() {
  bindEvents();
  const times = defaultSimulationTimes();
  state.comparison.entry = times.entry;
  state.comparison.exit = times.exit;
  state.simulator.entry = times.entry;
  state.simulator.exit = times.exit;
  renderIcons();
  await loadData({ silent: true });
  window.setInterval(() => loadData({ silent: true }), REFRESH_INTERVAL);
}

initialize();
