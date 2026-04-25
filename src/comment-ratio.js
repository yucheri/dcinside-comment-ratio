(function initCommentRatioModule(root) {
  "use strict";

  const COMMENT_RATIO_COLORS = [
    { id: "red", label: "빨간색" },
    { id: "orange", label: "주황색" },
    { id: "yellow", label: "노란색" },
    { id: "lime", label: "연두색" },
    { id: "green", label: "초록색" },
  ];

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

  const api = {
    COMMENT_RATIO_COLORS,
    classifyCommentRatio,
    getCommentPostRatio,
    parseGallogCounts,
  };

  root.DCInsideCommentRatio = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
