importScripts("src/comment-ratio.js");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_CONCURRENCY = 4;
const MAX_UIDS_PER_REQUEST = 80;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const {
  classifyCommentRatio,
  getCommentPostRatio,
  mapWithConcurrency,
  parseGallogCounts,
} = self.DCInsideCommentRatio;

const inFlightByUid = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "DC_COMMENT_RATIO_GET_COLORS") {
    return false;
  }

  handleCommentRatioRequest(message.uids)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleCommentRatioRequest(rawUids) {
  const uids = [...new Set(Array.isArray(rawUids) ? rawUids : [])]
    .map((uid) => String(uid || "").trim())
    .filter((uid) => UID_PATTERN.test(uid))
    .slice(0, MAX_UIDS_PER_REQUEST);

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

  const request = fetchCommentRatioForUid(uid).finally(() => {
    inFlightByUid.delete(uid);
  });
  inFlightByUid.set(uid, request);
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
  const key = cacheKey(uid);
  const stored = await chrome.storage.local.get(key);
  const item = stored[key];

  if (!item) {
    return null;
  }

  const age = Date.now() - item.fetchedAt;
  if (item.ok && age <= CACHE_TTL_MS) {
    return item;
  }

  if (!item.ok && age <= FAILURE_CACHE_TTL_MS) {
    return item;
  }

  return null;
}

async function setCachedCommentRatio(uid, result) {
  await chrome.storage.local.set({
    [cacheKey(uid)]: result,
  });
}

function cacheKey(uid) {
  return `comment-ratio:${uid}`;
}
