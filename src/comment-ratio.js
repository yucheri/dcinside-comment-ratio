(function initCommentRatioModule(root) {
  "use strict";

  const COMMENT_RATIO_COLORS = [
    { id: "red", label: "빨간색" },
    { id: "orange", label: "주황색" },
    { id: "yellow", label: "노란색" },
    { id: "lime", label: "연두색" },
    { id: "green", label: "초록색" },
  ];
  const COMMENT_RATIO_CACHE_PREFIX = "comment-ratio:";
  const COMMENT_RATIO_CACHE_META_KEY = "comment-ratio:cache-meta";
  const COMMENT_RATIO_SETTINGS_KEY = "comment-ratio:settings";
  const DEFAULT_COMMENT_RATIO_SETTINGS = {
    enabled: true,
    cacheTtlHours: 72,
    failureCacheTtlMinutes: 15,
    maxCacheItems: 5000,
    lowActivity: {
      enabled: true,
      maxTotal: 200,
      color: "#884dff",
    },
    colors: {
      red: "#e33232",
      orange: "#e66a1f",
      yellow: "#d6a600",
      lime: "#7fbf00",
      green: "#008f5a",
    },
    ranges: {
      red: { min: 0, max: 1 },
      orange: { min: 1, max: 2 },
      yellow: { min: 2, max: 3 },
      lime: { min: 3, max: 4 },
      green: { min: 4, max: null },
    },
  };
  const LEGACY_DEFAULT_RANGE_SETS = [
    {
      red: { min: 0, max: 2 },
      orange: { min: 2, max: 3 },
      yellow: { min: 3, max: 4 },
      lime: { min: 4, max: 5 },
      green: { min: 5, max: null },
    },
    {
      red: { min: 0, max: 1 },
      orange: { min: 1, max: 3 },
      yellow: { min: 3, max: 4 },
      lime: { min: 4, max: 5 },
      green: { min: 5, max: null },
    },
  ];
  const LEGACY_DEFAULT_COLORS = {
    red: "#e33232",
    orange: "#e66a1f",
    yellow: "#d6a600",
    lime: "#62b51f",
    green: "#0f9a3d",
  };

  function parseCount(rawValue) {
    const digits = String(rawValue || "").replace(/[^\d]/g, "");
    return digits ? Number.parseInt(digits, 10) : 0;
  }

  function getCommentPostRatio(postCount, commentCount) {
    const posts = Math.max(0, Number(postCount) || 0);
    const comments = Math.max(0, Number(commentCount) || 0);

    if (posts === 0) {
      return comments > 0 ? Infinity : 0;
    }

    return comments / posts;
  }

  function classifyCommentRatio(postCount, commentCount, rawSettings) {
    const settings = normalizeCommentRatioSettings(rawSettings);
    const lowActivityResult = classifyLowActivity(postCount, commentCount, settings);
    if (lowActivityResult) {
      return lowActivityResult;
    }

    const ratio = getCommentPostRatio(postCount, commentCount);

    for (const color of COMMENT_RATIO_COLORS) {
      const range = settings.ranges[color.id];
      if (isRatioInRange(ratio, color.id, range)) {
        return buildColorResult(color, settings);
      }
    }

    return buildColorResult(
      ratio < settings.ranges.red.min ? COMMENT_RATIO_COLORS[0] : COMMENT_RATIO_COLORS[4],
      settings
    );
  }

  function isRatioInRange(ratio, colorId, range) {
    if (ratio < range.min) {
      return false;
    }

    if (range.max === null) {
      return true;
    }

    return colorId === COMMENT_RATIO_COLORS[0].id
      ? ratio <= range.max
      : ratio < range.max;
  }

  function classifyLowActivity(postCount, commentCount, settings) {
    const lowActivity = settings.lowActivity;
    const total = getTotalActivity(postCount, commentCount);

    if (!lowActivity.enabled || total > lowActivity.maxTotal) {
      return null;
    }

    return {
      id: "purple",
      label: "보라색",
      hex: lowActivity.color,
      total,
      maxTotal: lowActivity.maxTotal,
    };
  }

  function getTotalActivity(postCount, commentCount) {
    return Math.max(0, Number(postCount) || 0)
      + Math.max(0, Number(commentCount) || 0);
  }

  function parseGallogUserLayerCounts(rawValue) {
    const parts = String(rawValue || "").split(",");
    if (parts.length < 2 || !hasDigit(parts[0]) || !hasDigit(parts[1])) {
      return null;
    }

    return {
      postCount: parseCount(parts[0]),
      commentCount: parseCount(parts[1]),
    };
  }

  function normalizeDcinsideRequestToken(rawValue) {
    const token = String(rawValue || "").trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(token) ? token : "";
  }

  function hasDigit(value) {
    return /\d/.test(String(value || ""));
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const source = Array.isArray(items) ? items : [];
    const concurrency = Math.max(1, Number(limit) || 1);
    const results = new Array(source.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < source.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(source[currentIndex], currentIndex);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, source.length) },
      worker
    );

    await Promise.all(workers);
    return results;
  }

  function getCommentRatioCacheKey(uid) {
    return `${COMMENT_RATIO_CACHE_PREFIX}${uid}`;
  }

  function isCommentRatioCacheKey(key) {
    return String(key || "").startsWith(COMMENT_RATIO_CACHE_PREFIX)
      && key !== COMMENT_RATIO_CACHE_META_KEY
      && key !== COMMENT_RATIO_SETTINGS_KEY;
  }

  function normalizeCommentRatioSettings(rawSettings) {
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const migratedSource = migrateCommentRatioSettings(source);
    const settings = cloneSettings(DEFAULT_COMMENT_RATIO_SETTINGS);

    settings.enabled = migratedSource.enabled !== false;
    settings.cacheTtlHours = normalizeCacheTtlHours(
      migratedSource.cacheTtlHours,
      DEFAULT_COMMENT_RATIO_SETTINGS.cacheTtlHours
    );
    settings.failureCacheTtlMinutes = normalizePositiveNumber(
      migratedSource.failureCacheTtlMinutes,
      DEFAULT_COMMENT_RATIO_SETTINGS.failureCacheTtlMinutes
    );
    settings.maxCacheItems = normalizePositiveInteger(
      migratedSource.maxCacheItems,
      DEFAULT_COMMENT_RATIO_SETTINGS.maxCacheItems
    );
    settings.lowActivity = normalizeLowActivitySettings(
      migratedSource.lowActivity,
      DEFAULT_COMMENT_RATIO_SETTINGS.lowActivity
    );

    for (const color of COMMENT_RATIO_COLORS) {
      settings.colors[color.id] = normalizeHexColor(
        getMigratedColorValue(migratedSource.colors, color.id),
        DEFAULT_COMMENT_RATIO_SETTINGS.colors[color.id]
      );
      settings.ranges[color.id] = normalizeRange(
        migratedSource.ranges && migratedSource.ranges[color.id],
        DEFAULT_COMMENT_RATIO_SETTINGS.ranges[color.id]
      );
    }

    return settings;
  }

  function migrateCommentRatioSettings(source) {
    if (!LEGACY_DEFAULT_RANGE_SETS.some((ranges) => rangesMatch(source.ranges, ranges))) {
      return source;
    }

    return {
      ...source,
      ranges: cloneSettings(DEFAULT_COMMENT_RATIO_SETTINGS.ranges),
    };
  }

  function getMigratedColorValue(sourceColors, colorId) {
    if (!sourceColors || typeof sourceColors !== "object") {
      return undefined;
    }

    const value = normalizeHexColor(sourceColors[colorId], "");
    if (value && value === LEGACY_DEFAULT_COLORS[colorId]) {
      return DEFAULT_COMMENT_RATIO_SETTINGS.colors[colorId];
    }

    return sourceColors[colorId];
  }

  function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
  }

  function normalizeHexColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function normalizePositiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function normalizeCacheTtlHours(value, fallback) {
    const number = normalizePositiveNumber(value, fallback);
    return number === 24 ? fallback : number;
  }

  function normalizeLowActivitySettings(value, fallback) {
    const source = value && typeof value === "object" ? value : {};

    return {
      enabled: source.enabled !== false,
      maxTotal: normalizeNonNegativeInteger(source.maxTotal, fallback.maxTotal),
      color: normalizeHexColor(source.color, fallback.color),
    };
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function normalizeNonNegativeInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }

  function normalizeRange(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    const min = normalizeNonNegativeNumber(source.min, fallback.min);
    const max = source.max === null || source.max === ""
      ? null
      : normalizeNonNegativeNumber(source.max, fallback.max);

    if (max !== null && max <= min) {
      return { min: fallback.min, max: fallback.max };
    }

    return { min, max };
  }

  function rangesMatch(sourceRanges, expectedRanges) {
    if (!sourceRanges || typeof sourceRanges !== "object") {
      return false;
    }

    return COMMENT_RATIO_COLORS.every((color) => {
      const sourceRange = sourceRanges[color.id];
      const expectedRange = expectedRanges[color.id];

      return sourceRange
        && Number(sourceRange.min) === expectedRange.min
        && normalizeNullableNumber(sourceRange.max) === expectedRange.max;
    });
  }

  function normalizeNullableNumber(value) {
    return value === null || value === "" ? null : Number(value);
  }

  function normalizeNonNegativeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function buildColorResult(color, settings) {
    const range = settings.ranges[color.id];
    return {
      id: color.id,
      label: color.label,
      hex: settings.colors[color.id],
      min: range.min,
      max: range.max,
    };
  }

  function splitCachedCommentRatioResults(uids, storedItems, options) {
    const source = Array.isArray(uids) ? uids : [];
    const stored = storedItems || {};
    const now = Number(options && options.now) || Date.now();
    const cacheTtlMs = Number(options && options.cacheTtlMs) || 0;
    const failureCacheTtlMs = Number(options && options.failureCacheTtlMs) || 0;
    const results = {};
    const misses = [];

    for (const uid of source) {
      const item = stored[getCommentRatioCacheKey(uid)];

      if (isFreshCacheItem(item, now, cacheTtlMs, failureCacheTtlMs)) {
        results[uid] = item;
      } else {
        misses.push(uid);
      }
    }

    return { results, misses };
  }

  function getCommentRatioCachePruneKeys(storedItems, options) {
    const stored = storedItems || {};
    const now = Number(options && options.now) || Date.now();
    const cacheTtlMs = Number(options && options.cacheTtlMs) || 0;
    const failureCacheTtlMs = Number(options && options.failureCacheTtlMs) || 0;
    const maxItems = normalizePositiveInteger(
      options && options.maxItems,
      DEFAULT_COMMENT_RATIO_SETTINGS.maxCacheItems
    );
    const entries = Object.entries(stored)
      .filter(([key]) => isCommentRatioCacheKey(key));

    if (entries.length <= maxItems) {
      return [];
    }

    const staleKeys = entries
      .filter(([, item]) => !isFreshCacheItem(item, now, cacheTtlMs, failureCacheTtlMs))
      .map(([key]) => key);

    if (staleKeys.length > 0) {
      return staleKeys;
    }

    return entries
      .sort(([, left], [, right]) => getCacheItemFetchedAt(left) - getCacheItemFetchedAt(right))
      .slice(0, entries.length - maxItems)
      .map(([key]) => key);
  }

  function getCacheItemFetchedAt(item) {
    const fetchedAt = item && Number(item.fetchedAt);
    return Number.isFinite(fetchedAt) ? fetchedAt : 0;
  }

  function isFreshCacheItem(item, now, cacheTtlMs, failureCacheTtlMs) {
    if (!item || typeof item !== "object") {
      return false;
    }

    const fetchedAt = Number(item.fetchedAt);
    if (!Number.isFinite(fetchedAt)) {
      return false;
    }

    const age = Math.max(0, now - fetchedAt);
    return item.ok ? age <= cacheTtlMs : age <= failureCacheTtlMs;
  }

  const api = {
    COMMENT_RATIO_COLORS,
    COMMENT_RATIO_CACHE_META_KEY,
    COMMENT_RATIO_CACHE_PREFIX,
    COMMENT_RATIO_SETTINGS_KEY,
    DEFAULT_COMMENT_RATIO_SETTINGS,
    classifyCommentRatio,
    getCommentRatioCachePruneKeys,
    getCommentRatioCacheKey,
    getCommentPostRatio,
    isCommentRatioCacheKey,
    mapWithConcurrency,
    normalizeDcinsideRequestToken,
    normalizeCommentRatioSettings,
    parseGallogUserLayerCounts,
    splitCachedCommentRatioResults,
  };

  root.DCInsideCommentRatio = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
