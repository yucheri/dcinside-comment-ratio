(() => {
  "use strict";

  const WRITER_SELECTOR = ".gall_writer.ub-writer[data-uid]";
  const COMMENT_RATIO_CLASSES = [
    "dc-comment-ratio-red",
    "dc-comment-ratio-orange",
    "dc-comment-ratio-yellow",
    "dc-comment-ratio-lime",
    "dc-comment-ratio-green",
    "dc-comment-ratio-purple",
  ];
  const PROCESSED_ATTR = "data-dc-comment-ratio-processed";
  const QUEUED_ATTR = "data-dc-comment-ratio-queued";
  const OBSERVED_ATTR = "data-dc-comment-ratio-observed";
  const DEBOUNCE_MS = 30;
  const INTERSECTION_ROOT_MARGIN = "300px 0px";

  let debounceTimer = 0;
  let animationFrame = 0;
  let flushFrame = 0;
  let fetchInProgress = false;
  const visibleQueue = new Set();
  const pendingFetchUids = [];
  const pendingFetchUidSet = new Set();
  const visibilityObserver = createVisibilityObserver();

  observeListChanges();
  queueProcessWriters();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", queueProcessWriters, { once: true });
  }

  function observeListChanges() {
    const observer = new MutationObserver(() => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(queueProcessWriters, DEBOUNCE_MS);
    });

    observer.observe(getObservationRoot(), {
      childList: true,
      subtree: true,
    });
  }

  function getObservationRoot() {
    return document.body || document.documentElement;
  }

  function queueProcessWriters() {
    if (animationFrame) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
      processWriters();
    });
  }

  function processWriters() {
    const cells = [...document.querySelectorAll(WRITER_SELECTOR)]
      .filter((cell) => !cell.hasAttribute(PROCESSED_ATTR))
      .filter((cell) => !cell.hasAttribute(QUEUED_ATTR))
      .filter((cell) => !cell.hasAttribute(OBSERVED_ATTR))
      .filter((cell) => getUid(cell));

    if (cells.length === 0) {
      return;
    }

    for (const cell of cells) {
      observeWriter(cell);
    }
  }

  function createVisibilityObserver() {
    if (!("IntersectionObserver" in window)) {
      return null;
    }

    return new IntersectionObserver((entries) => {
      const visibleCells = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => entry.target);

      if (visibleCells.length > 0) {
        enqueueVisibleWriters(visibleCells);
      }
    }, {
      rootMargin: INTERSECTION_ROOT_MARGIN,
    });
  }

  function observeWriter(cell) {
    if (!visibilityObserver) {
      enqueueVisibleWriters([cell]);
      return;
    }

    cell.setAttribute(OBSERVED_ATTR, "true");
    visibilityObserver.observe(cell);
  }

  function enqueueVisibleWriters(cells) {
    for (const cell of cells) {
      if (visibilityObserver) {
        visibilityObserver.unobserve(cell);
      }

      cell.removeAttribute(OBSERVED_ATTR);

      if (!cell.hasAttribute(PROCESSED_ATTR) && !cell.hasAttribute(QUEUED_ATTR) && getUid(cell)) {
        visibleQueue.add(cell);
      }
    }

    queueFlushVisibleWriters();
  }

  function queueFlushVisibleWriters() {
    if (flushFrame) {
      return;
    }

    flushFrame = window.requestAnimationFrame(() => {
      flushFrame = 0;
      flushVisibleWriters();
    });
  }

  function flushVisibleWriters() {
    const cells = [...visibleQueue]
      .filter((cell) => !cell.hasAttribute(PROCESSED_ATTR))
      .filter((cell) => !cell.hasAttribute(QUEUED_ATTR))
      .filter((cell) => getUid(cell));

    visibleQueue.clear();

    if (cells.length === 0) {
      return;
    }

    for (const cell of cells) {
      cell.setAttribute(QUEUED_ATTR, "true");
    }

    const uids = [...new Set(cells.map(getUid))];

    chrome.runtime.sendMessage(
      { type: "DC_COMMENT_RATIO_GET_CACHED_COLORS", uids },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          for (const cell of cells) {
            cell.removeAttribute(QUEUED_ATTR);
            cell.setAttribute(PROCESSED_ATTR, "true");
          }
          return;
        }

        const results = response.results.results || {};
        const misses = response.results.misses || [];

        if (response.results.disabled) {
          for (const cell of cells) {
            cell.removeAttribute(QUEUED_ATTR);
            cell.setAttribute(PROCESSED_ATTR, "true");
          }
          return;
        }

        for (const [uid, result] of Object.entries(results)) {
          completeWriterCells(uid, result);
        }

        for (const uid of misses) {
          queueFetchUid(uid);
        }
      }
    );
  }

  function queueFetchUid(uid) {
    if (pendingFetchUidSet.has(uid)) {
      return;
    }

    pendingFetchUidSet.add(uid);
    pendingFetchUids.push(uid);
    processFetchQueue();
  }

  function processFetchQueue() {
    if (fetchInProgress) {
      return;
    }

    const uid = pendingFetchUids.shift();
    if (!uid) {
      return;
    }

    fetchInProgress = true;
    chrome.runtime.sendMessage(
      { type: "DC_COMMENT_RATIO_FETCH_COLOR", uid, ciToken: getCookieValue("ci_c") },
      (response) => {
        pendingFetchUidSet.delete(uid);

        if (chrome.runtime.lastError || !response || !response.ok) {
          completeWriterCells(uid, null);
        } else {
          completeWriterCells(uid, response.results.result);
        }

        fetchInProgress = false;
        processFetchQueue();
      }
    );
  }

  function completeWriterCells(uid, result) {
    const cells = [...document.querySelectorAll(WRITER_SELECTOR)]
      .filter((cell) => getUid(cell) === uid)
      .filter((cell) => cell.hasAttribute(QUEUED_ATTR))
      .filter((cell) => !cell.hasAttribute(PROCESSED_ATTR));

    for (const cell of cells) {
      cell.removeAttribute(QUEUED_ATTR);
      cell.setAttribute(PROCESSED_ATTR, "true");

      if (result && result.ok) {
        applyCommentRatioStyle(cell, result);
      }
    }
  }

  function applyCommentRatioStyle(cell, result) {
    const target = cell.querySelector(".nickname") || cell.firstElementChild;
    if (!target) {
      return;
    }

    target.classList.remove(...COMMENT_RATIO_CLASSES);
    target.classList.add("dc-comment-ratio-nickname", `dc-comment-ratio-${result.color}`);
    target.style.setProperty("color", result.hex || "", "important");

    for (const child of target.querySelectorAll("em")) {
      child.style.setProperty("color", result.hex || "", "important");
    }

    target.title = buildTitle(result);
  }

  function buildTitle(result) {
    const ratio = Number.isFinite(result.ratio)
      ? result.ratio.toFixed(2)
      : "∞";

    return `${result.label} | 글 ${formatCount(result.postCount)} / 댓글 ${formatCount(result.commentCount)} | 댓글/글 ${ratio}`;
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString("ko-KR");
  }

  function getUid(cell) {
    return String(cell.dataset.uid || "").trim();
  }

  function getCookieValue(name) {
    const cookieName = `${name}=`;
    const parts = document.cookie.split("; ");

    for (const part of parts) {
      if (part.startsWith(cookieName)) {
        try {
          return decodeURIComponent(part.slice(cookieName.length));
        } catch (_error) {
          return "";
        }
      }
    }

    return "";
  }
})();
