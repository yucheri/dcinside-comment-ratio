(() => {
  "use strict";

  const WRITER_SELECTOR = ".gall_writer.ub-writer[data-uid]";
  const COMMENT_RATIO_CLASSES = [
    "dc-comment-ratio-red",
    "dc-comment-ratio-orange",
    "dc-comment-ratio-yellow",
    "dc-comment-ratio-lime",
    "dc-comment-ratio-green",
  ];
  const PROCESSED_ATTR = "data-dc-comment-ratio-processed";
  const QUEUED_ATTR = "data-dc-comment-ratio-queued";
  const DEBOUNCE_MS = 30;

  let debounceTimer = 0;
  let animationFrame = 0;

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
      .filter((cell) => getUid(cell));

    if (cells.length === 0) {
      return;
    }

    for (const cell of cells) {
      cell.setAttribute(QUEUED_ATTR, "true");
    }

    const uids = [...new Set(cells.map(getUid))];

    chrome.runtime.sendMessage(
      { type: "DC_COMMENT_RATIO_GET_COLORS", uids },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          for (const cell of cells) {
            cell.removeAttribute(QUEUED_ATTR);
          }
          return;
        }

        for (const cell of cells) {
          const uid = getUid(cell);
          const result = response.results[uid];
          cell.removeAttribute(QUEUED_ATTR);
          cell.setAttribute(PROCESSED_ATTR, "true");

          if (result && result.ok) {
            applyCommentRatioStyle(cell, result);
          }
        }
      }
    );
  }

  function applyCommentRatioStyle(cell, result) {
    const target = cell.querySelector(".nickname") || cell.firstElementChild;
    if (!target) {
      return;
    }

    target.classList.remove(...COMMENT_RATIO_CLASSES);
    target.classList.add("dc-comment-ratio-nickname", `dc-comment-ratio-${result.color}`);
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
})();
