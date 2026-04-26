(() => {
  "use strict";

  const {
    COMMENT_RATIO_CACHE_META_KEY,
    COMMENT_RATIO_COLORS,
    COMMENT_RATIO_SETTINGS_KEY,
    DEFAULT_COMMENT_RATIO_SETTINGS,
    isCommentRatioCacheKey,
    normalizeCommentRatioSettings,
  } = globalThis.DCInsideCommentRatio;

  const enabledInput = document.querySelector("#enabled");
  const popup = document.querySelector(".popup");
  const rangeRows = document.querySelector("#rangeRows");
  const lowActivityEnabled = document.querySelector("#lowActivityEnabled");
  const lowActivityColor = document.querySelector("#lowActivityColor");
  const lowActivitySwatch = document.querySelector("#lowActivitySwatch");
  const lowActivityMaxTotal = document.querySelector("#lowActivityMaxTotal");
  const cacheTtlHours = document.querySelector("#cacheTtlHours");
  const saveButton = document.querySelector("#saveButton");
  const clearCacheButton = document.querySelector("#clearCacheButton");
  const resetButton = document.querySelector("#resetButton");
  const status = document.querySelector("#status");

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    renderRows();
    await loadSettings();
    enabledInput.addEventListener("change", updateEnabledState);
    lowActivitySwatch.addEventListener("click", () => lowActivityColor.click());
    lowActivityColor.addEventListener("input", updateLowActivitySwatch);
    saveButton.addEventListener("click", saveSettings);
    clearCacheButton.addEventListener("click", clearCache);
    resetButton.addEventListener("click", resetPlugin);
  }

  function renderRows() {
    rangeRows.textContent = "";

    COMMENT_RATIO_COLORS.forEach((color, index) => {
      const isLast = index === COMMENT_RATIO_COLORS.length - 1;
      const row = document.createElement("div");
      row.className = "range-row";
      row.dataset.colorId = color.id;
      row.innerHTML = `
        <button class="swatch" type="button" title="${color.label} 색상"></button>
        <input class="color-input" type="color" data-color="${color.id}" aria-label="${color.label} 색상">
        <span class="ratio-prefix">1 :</span>
        <span class="ratio-value" data-start="${color.id}">0</span>
        <span class="ratio-separator">~</span>
        ${isLast
          ? `<span class="ratio-value" data-end="${color.id}">∞</span>`
          : `<input type="number" min="0" step="0.1" data-boundary="${color.id}" aria-label="${color.label} 끝 비율">`}
      `;

      const swatch = row.querySelector(".swatch");
      const colorInput = row.querySelector(".color-input");
      const boundaryInput = row.querySelector("[data-boundary]");
      swatch.addEventListener("click", () => colorInput.click());
      colorInput.addEventListener("input", () => {
        swatch.style.backgroundColor = colorInput.value;
      });
      if (boundaryInput) {
        boundaryInput.addEventListener("input", updateRangeStarts);
      }

      rangeRows.append(row);
    });
  }

  async function loadSettings() {
    const stored = await storageGet(COMMENT_RATIO_SETTINGS_KEY);
    applySettingsToForm(normalizeCommentRatioSettings(stored[COMMENT_RATIO_SETTINGS_KEY]));
  }

  function applySettingsToForm(settings) {
    enabledInput.checked = settings.enabled;
    updateEnabledState();
    cacheTtlHours.value = String(settings.cacheTtlHours);
    lowActivityEnabled.checked = settings.lowActivity.enabled;
    lowActivityColor.value = settings.lowActivity.color;
    lowActivityMaxTotal.value = String(settings.lowActivity.maxTotal);
    updateLowActivitySwatch();

    for (const color of COMMENT_RATIO_COLORS) {
      const colorInput = document.querySelector(`[data-color="${color.id}"]`);
      const boundaryInput = document.querySelector(`[data-boundary="${color.id}"]`);
      const swatch = colorInput.closest(".range-row").querySelector(".swatch");
      const range = settings.ranges[color.id];

      colorInput.value = settings.colors[color.id];
      swatch.style.backgroundColor = settings.colors[color.id];
      if (boundaryInput) {
        boundaryInput.value = range.max === null ? "" : formatRatioValue(range.max);
      }
    }

    updateRangeStarts();
  }

  async function saveSettings() {
    const settings = normalizeCommentRatioSettings({
      enabled: enabledInput.checked,
      cacheTtlHours: Number(cacheTtlHours.value),
      lowActivity: collectLowActivity(),
      colors: collectColors(),
      ranges: collectRanges(),
    });

    await storageSet({ [COMMENT_RATIO_SETTINGS_KEY]: settings });
    applySettingsToForm(settings);
    setStatus("저장됨. 열린 DC 페이지는 새로고침하면 확실히 반영됩니다.");
  }

  function collectColors() {
    return Object.fromEntries(
      COMMENT_RATIO_COLORS.map((color) => [
        color.id,
        document.querySelector(`[data-color="${color.id}"]`).value,
      ])
    );
  }

  function collectLowActivity() {
    return {
      enabled: lowActivityEnabled.checked,
      maxTotal: Number(lowActivityMaxTotal.value),
      color: lowActivityColor.value,
    };
  }

  function collectRanges() {
    const ranges = {};
    let previousMin = 0;

    for (const color of COMMENT_RATIO_COLORS) {
      const boundaryInput = document.querySelector(`[data-boundary="${color.id}"]`);
      const max = boundaryInput ? parseBoundaryValue(boundaryInput.value) : null;

      ranges[color.id] = {
        min: previousMin,
        max,
      };

      if (Number.isFinite(max)) {
        previousMin = max;
      }
    }

    return ranges;
  }

  async function clearCache() {
    const keys = await getCacheKeys();
    const cacheCount = keys.filter(isCommentRatioCacheKey).length;
    if (keys.length > 0) {
      await storageRemove(keys);
    }

    setStatus(`캐시 ${cacheCount}개를 삭제했습니다.`);
  }

  async function resetPlugin() {
    if (!confirm("설정과 캐시를 모두 초기화할까요?")) {
      return;
    }

    const keys = await getCacheKeys();
    keys.push(COMMENT_RATIO_SETTINGS_KEY);
    await storageRemove(keys);
    applySettingsToForm(normalizeCommentRatioSettings(DEFAULT_COMMENT_RATIO_SETTINGS));
    setStatus("플러그인을 초기화했습니다.");
  }

  async function getCacheKeys() {
    const items = await storageGet(null);
    return Object.keys(items)
      .filter((key) => isCommentRatioCacheKey(key) || key === COMMENT_RATIO_CACHE_META_KEY);
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function updateEnabledState() {
    popup.classList.toggle("is-disabled", !enabledInput.checked);
  }

  function updateLowActivitySwatch() {
    lowActivitySwatch.style.backgroundColor = lowActivityColor.value;
  }

  function updateRangeStarts() {
    let start = 0;

    for (const color of COMMENT_RATIO_COLORS) {
      const startLabel = document.querySelector(`[data-start="${color.id}"]`);
      const boundaryInput = document.querySelector(`[data-boundary="${color.id}"]`);

      startLabel.textContent = formatRatioValue(start);

      if (boundaryInput && Number.isFinite(parseBoundaryValue(boundaryInput.value))) {
        start = parseBoundaryValue(boundaryInput.value);
      }
    }
  }

  function parseBoundaryValue(value) {
    return value === "" ? NaN : Number(value);
  }

  function formatRatioValue(value) {
    return Number(value).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }
})();
