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

  function classifyCommentRatio(postCount, commentCount) {
    const ratio = getCommentPostRatio(postCount, commentCount);

    if (ratio >= 5) {
      return COMMENT_RATIO_COLORS[4];
    }

    if (ratio >= 4) {
      return COMMENT_RATIO_COLORS[3];
    }

    if (ratio >= 3) {
      return COMMENT_RATIO_COLORS[2];
    }

    if (ratio >= 2) {
      return COMMENT_RATIO_COLORS[1];
    }

    return COMMENT_RATIO_COLORS[0];
  }

  function extractCount(html, label) {
    const patterns = [
      new RegExp(`${label}\\s*<span[^>]*class=["'][^"']*num[^"']*["'][^>]*>\\s*\\(([\\d,]+)\\)\\s*<\\/span>`, "i"),
      new RegExp(`${label}\\s*\\(([\\d,]+)\\)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) {
        return parseCount(match[1]);
      }
    }

    return 0;
  }

  function parseGallogCounts(html) {
    const source = String(html || "");

    return {
      postCount: extractCount(source, "게시글"),
      commentCount: extractCount(source, "댓글"),
    };
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
    classifyCommentRatio,
    getCommentRatioCacheKey,
    getCommentPostRatio,
    mapWithConcurrency,
    parseGallogCounts,
    splitCachedCommentRatioResults,
  };

  root.DCInsideCommentRatio = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
