importScripts("src/comment-ratio.js");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_CONCURRENCY = 1;
const MAX_UIDS_PER_REQUEST = 80;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const {
  classifyCommentRatio,
  getCommentRatioCacheKey,
  getCommentPostRatio,
  mapWithConcurrency,
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
  const uids = normalizeUids(rawUids);
  return getCachedCommentRatios(uids);
}

async function handleSingleCommentRatioRequest(rawUid) {
  const [uid] = normalizeUids([rawUid]);
  if (!uid) {
    return { uid: "", result: null };
  }

  return {
    uid,
    result: await getCommentRatioForUid(uid),
  };
}

async function handleCommentRatioRequest(rawUids) {
  const uids = normalizeUids(rawUids);

  const pairs = await mapWithConcurrency(
    uids,
    FETCH_CONCURRENCY,
    async (uid) => [uid, await getCommentRatioForUid(uid)]
  );

  return Object.fromEntries(pairs);
}

async function getCommentRatioForUid(uid) {
  const cached = await getCachedCommentRatio(uid);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightByUid.get(uid);
  if (inFlight) {
    return inFlight;
  }

  const request = queueFetchCommentRatioForUid(uid).finally(() => {
    inFlightByUid.delete(uid);
  });
  inFlightByUid.set(uid, request);
  return request;
}

function queueFetchCommentRatioForUid(uid) {
  const request = fetchQueue.then(
    () => fetchCommentRatioForUid(uid),
    () => fetchCommentRatioForUid(uid)
  );
  fetchQueue = request.catch(() => {});
  return request;
}

async function fetchCommentRatioForUid(uid) {
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
    const color = classifyCommentRatio(counts.postCount, counts.commentCount);
    const ratio = getCommentPostRatio(counts.postCount, counts.commentCount);
    const result = {
      ok: true,
      uid,
      color: color.id,
      label: color.label,
      postCount: counts.postCount,
      commentCount: counts.commentCount,
      ratio,
      fetchedAt: Date.now(),
    };

    await setCachedCommentRatio(uid, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      uid,
      error: error.message,
      fetchedAt: Date.now(),
    };

    await setCachedCommentRatio(uid, result);
    return result;
  }
}

async function getCachedCommentRatio(uid) {
  const { results } = await getCachedCommentRatios([uid]);
  return results[uid] || null;
}

async function getCachedCommentRatios(uids) {
  if (uids.length === 0) {
    return { results: {}, misses: [] };
  }

  const keys = uids.map(getCommentRatioCacheKey);
  const stored = await chrome.storage.local.get(keys);
  return splitCachedCommentRatioResults(uids, stored, {
    now: Date.now(),
    cacheTtlMs: CACHE_TTL_MS,
    failureCacheTtlMs: FAILURE_CACHE_TTL_MS,
  });
}

async function setCachedCommentRatio(uid, result) {
  await chrome.storage.local.set({
    [getCommentRatioCacheKey(uid)]: result,
  });
}

function normalizeUids(rawUids) {
  return [...new Set(Array.isArray(rawUids) ? rawUids : [])]
    .map((uid) => String(uid || "").trim())
    .filter((uid) => UID_PATTERN.test(uid))
    .slice(0, MAX_UIDS_PER_REQUEST);
}
