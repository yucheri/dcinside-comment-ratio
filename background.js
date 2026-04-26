importScripts("src/comment-ratio.js");

const FETCH_CONCURRENCY = 1;
const MAX_UIDS_PER_REQUEST = 80;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const {
  classifyCommentRatio,
  COMMENT_RATIO_CACHE_META_KEY,
  COMMENT_RATIO_SETTINGS_KEY,
  getCommentRatioCachePruneKeys,
  getCommentRatioCacheKey,
  getCommentPostRatio,
  isCommentRatioCacheKey,
  mapWithConcurrency,
  normalizeCommentRatioSettings,
  parseGallogCounts,
  splitCachedCommentRatioResults,
} = self.DCInsideCommentRatio;

const inFlightByUid = new Map();
let fetchQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !isCommentRatioMessage(message.type)) {
    return false;
  }

  handleMessage(message)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

function isCommentRatioMessage(type) {
  return [
    "DC_COMMENT_RATIO_GET_CACHED_COLORS",
    "DC_COMMENT_RATIO_FETCH_COLOR",
    "DC_COMMENT_RATIO_GET_COLORS",
  ].includes(type);
}

async function handleMessage(message) {
  if (message.type === "DC_COMMENT_RATIO_GET_CACHED_COLORS") {
    return handleCachedCommentRatioRequest(message.uids);
  }

  if (message.type === "DC_COMMENT_RATIO_FETCH_COLOR") {
    return handleSingleCommentRatioRequest(message.uid);
  }

  return handleCommentRatioRequest(message.uids);
}

async function handleCachedCommentRatioRequest(rawUids) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { disabled: true, results: {}, misses: [] };
  }

  const uids = normalizeUids(rawUids);
  return getCachedCommentRatios(uids, settings);
}

async function handleSingleCommentRatioRequest(rawUid) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { uid: "", result: null };
  }

  const [uid] = normalizeUids([rawUid]);
  if (!uid) {
    return { uid: "", result: null };
  }

  return {
    uid,
    result: await getCommentRatioForUid(uid, settings),
  };
}

async function handleCommentRatioRequest(rawUids) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return {};
  }

  const uids = normalizeUids(rawUids);

  const pairs = await mapWithConcurrency(
    uids,
    FETCH_CONCURRENCY,
    async (uid) => [uid, await getCommentRatioForUid(uid, settings)]
  );

  return Object.fromEntries(pairs);
}

async function getCommentRatioForUid(uid, settings) {
  const cached = await getCachedCommentRatio(uid, settings);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightByUid.get(uid);
  if (inFlight) {
    return inFlight;
  }

  const request = queueFetchCommentRatioForUid(uid, settings).finally(() => {
    inFlightByUid.delete(uid);
  });
  inFlightByUid.set(uid, request);
  return request;
}

function queueFetchCommentRatioForUid(uid, settings) {
  const request = fetchQueue.then(
    () => fetchCommentRatioForUid(uid, settings),
    () => fetchCommentRatioForUid(uid, settings)
  );
  fetchQueue = request.catch(() => {});
  return request;
}

async function fetchCommentRatioForUid(uid, settings) {
  try {
    const response = await fetch(`https://gallog.dcinside.com/${encodeURIComponent(uid)}`, {
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Gallog responded with ${response.status}`);
    }

    const html = await response.text();
    const counts = parseGallogCounts(html);
    const result = buildResult(uid, counts, settings);

    await setCachedCommentRatio(uid, result, settings);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      uid,
      error: error.message,
      fetchedAt: Date.now(),
    };

    await setCachedCommentRatio(uid, result, settings);
    return result;
  }
}

function buildResult(uid, counts, settings) {
  const color = classifyCommentRatio(counts.postCount, counts.commentCount, settings);
  const ratio = getCommentPostRatio(counts.postCount, counts.commentCount);
  return {
    ok: true,
    uid,
    color: color.id,
    label: color.label,
    hex: color.hex,
    postCount: counts.postCount,
    commentCount: counts.commentCount,
    ratio,
    fetchedAt: Date.now(),
  };
}

function refreshCachedResult(result, settings) {
  if (!result || !result.ok) {
    return result;
  }

  return {
    ...result,
    ...buildResult(result.uid, {
      postCount: result.postCount,
      commentCount: result.commentCount,
    }, settings),
    fetchedAt: result.fetchedAt,
  };
}

async function getCachedCommentRatio(uid, settings) {
  const { results } = await getCachedCommentRatios([uid], settings);
  return results[uid] || null;
}

async function getCachedCommentRatios(uids, settings) {
  if (uids.length === 0) {
    return { results: {}, misses: [] };
  }

  const keys = uids.map(getCommentRatioCacheKey);
  const stored = await chrome.storage.local.get(keys);
  const split = splitCachedCommentRatioResults(uids, stored, {
    now: Date.now(),
    cacheTtlMs: settings.cacheTtlHours * 60 * 60 * 1000,
    failureCacheTtlMs: settings.failureCacheTtlMinutes * 60 * 1000,
  });

  return {
    results: Object.fromEntries(
      Object.entries(split.results).map(([uid, result]) => [
        uid,
        refreshCachedResult(result, settings),
      ])
    ),
    misses: split.misses,
  };
}

async function setCachedCommentRatio(uid, result, settings) {
  const key = getCommentRatioCacheKey(uid);
  const stored = await chrome.storage.local.get([key, COMMENT_RATIO_CACHE_META_KEY]);
  const hadCachedItem = Boolean(stored[key]);

  await chrome.storage.local.set({ [key]: result });
  await updateCacheSizeAndPruneIfNeeded(hadCachedItem, settings);
}

async function updateCacheSizeAndPruneIfNeeded(hadCachedItem, settings) {
  const stored = await chrome.storage.local.get(COMMENT_RATIO_CACHE_META_KEY);
  const currentCount = getCacheItemCount(stored[COMMENT_RATIO_CACHE_META_KEY]);

  if (!Number.isInteger(currentCount)) {
    await pruneCommentRatioCache(settings);
    return;
  }

  const nextCount = currentCount + (hadCachedItem ? 0 : 1);
  if (nextCount > settings.maxCacheItems) {
    await pruneCommentRatioCache(settings);
    return;
  }

  await setCacheItemCount(nextCount);
}

async function pruneCommentRatioCache(settings) {
  const stored = await chrome.storage.local.get(null);
  const now = Date.now();
  const pruneKeys = getCommentRatioCachePruneKeys(stored, {
    now,
    cacheTtlMs: settings.cacheTtlHours * 60 * 60 * 1000,
    failureCacheTtlMs: settings.failureCacheTtlMinutes * 60 * 1000,
    maxItems: settings.maxCacheItems,
  });

  if (pruneKeys.length > 0) {
    await chrome.storage.local.remove(pruneKeys);
  }

  const cacheItemCount = Object.keys(stored)
    .filter(isCommentRatioCacheKey)
    .length - pruneKeys.length;

  await chrome.storage.local.set({
    [COMMENT_RATIO_CACHE_META_KEY]: {
      cacheItemCount,
      updatedAt: now,
    },
  });
}

function getCacheItemCount(meta) {
  const count = Number(meta && meta.cacheItemCount);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

async function setCacheItemCount(cacheItemCount) {
  await chrome.storage.local.set({
    [COMMENT_RATIO_CACHE_META_KEY]: {
      cacheItemCount,
      updatedAt: Date.now(),
    },
  });
}

function normalizeUids(rawUids) {
  return [...new Set(Array.isArray(rawUids) ? rawUids : [])]
    .map((uid) => String(uid || "").trim())
    .filter((uid) => UID_PATTERN.test(uid))
    .slice(0, MAX_UIDS_PER_REQUEST);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(COMMENT_RATIO_SETTINGS_KEY);
  return normalizeCommentRatioSettings(stored[COMMENT_RATIO_SETTINGS_KEY]);
}
