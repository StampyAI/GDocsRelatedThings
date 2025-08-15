import fetch from "node-fetch";

const pprint = (data) => console.log(JSON.stringify(data, null, 2));

const RE_TRAILING_SPACES = /[ \t]+$/gm;
const RE_3PLUS_NEWLINES = /\n{3,}/g;
const RE_BARE_QUOTE_BEFORE_QUOTED_LIST = /(^|\n)>\n(?=>\s*(?:-\s|\d+\.\s))/g;
const RE_BLANKS_BETWEEN_ANY_LIST_ITEMS =
  /((?:^|\n)(?:>\s*)*\s*(?:-\s|\d+\.\s)[\s\S]*?)\n(?:[ \t]*\n)+(?=(?:>\s*)*\s*(?:-\s|\d+\.\s))/g;
const RE_BLANKS_BETWEEN_PLAIN_DASHES =
  /(^|\n)(-\s[^\n]+)\n(?:[ \t]*\n)+(?=-\s)/g;
const RE_SPACING_BETWEEN_BULLET_LIST_AND_PARAGRAPH =
  /^(\s*-[^\n]+?\n)([^-\s])/gm;
const RE_SPACING_BETWEEN_NUMBERED_LIST_AND_PARAGRAPH =
  /^(\s*\d+\.[^\n]+?\n)([^\d\s])/gm;
const RE_SPACING_AFTER_QUOTED_BULLET_LIST = /^(>\s*-[^\n]+?\n)(?!>)([^-\s])/gm;
const RE_SPACING_AFTER_QUOTED_NUMBERED_LIST =
  /^(>\s*\d+\.[^\n]+?\n)(?!>)([^\d\s])/gm;

const normalizeMarkdownSpacing = (md) => {
  return (
    md
      // 1) Trim trailing spaces
      .replace(RE_TRAILING_SPACES, "")
      // 2) Collapse 3+ newlines → exactly 2
      .replace(RE_3PLUS_NEWLINES, "\n\n")
      // 3) Remove bare '>' line directly before a quoted list item
      .replace(RE_BARE_QUOTE_BEFORE_QUOTED_LIST, "$1")
      // 4) Remove whitespace-only blanks between any two consecutive list items
      .replace(RE_BLANKS_BETWEEN_ANY_LIST_ITEMS, "$1\n")
      // 5) Remove whitespace between plain dashes
      .replace(RE_BLANKS_BETWEEN_PLAIN_DASHES, "$1$2\n")
      // 6) Ensure proper spacing between list items and paragraphs (non-quoted)
      .replace(RE_SPACING_BETWEEN_BULLET_LIST_AND_PARAGRAPH, "$1\n$2")
      .replace(RE_SPACING_BETWEEN_NUMBERED_LIST_AND_PARAGRAPH, "$1\n$2")
      // 7) Ensure proper spacing after quoted lists before non-quote, non-list content
      .replace(RE_SPACING_AFTER_QUOTED_BULLET_LIST, "$1\n$2")
      .replace(RE_SPACING_AFTER_QUOTED_NUMBERED_LIST, "$1\n$2")
  );
};

// Some answers are HUGE and full of youtube embeds, so we sometimes need to squash them as Coda only lets us push 85KB into their API at a time. 40K of markdown seems to become 95K over the wire, so we set our limit a good few K under that.
export const compressMarkdown = (md) => {
  const beforeSize = md.length;
  let currentSize = beforeSize;
  let ret = md;

  if (beforeSize > 25000) {
    // <iframe src="https://www.youtube.com/embed/${videoID}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n\n
    ret = ret.replaceAll(
      /<iframe src="https:\/\/www.youtube.com\/embed\/(?<videoID>[A-z0-9\-_]+)" title="(?<videoTitle>.*?)" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen><\/iframe>/g,
      "\n[$<videoTitle>](https://youtu.be/$<videoID>)\n"
    );
    currentSize = ret.length;
  }

  // First step: Remove all trailing whitespace from lines
  ret = ret.replace(/[ \t]+$/gm, "");

  // Post-process with structure-aware newline normalization
  ret = normalizeMarkdownSpacing(ret);

  currentSize = ret.length;

  return ret;
};

export const sendToDiscord = (
  { content = "Missing error details", embeds = [] } = {},
  isError = false
) => {
  const url = isError
    ? process.env.DISCORD_ERROR // Goes to #stampy-error-log in Rob's Discord
    : process.env.DISCORD_FEED; // Goes to #wiki-feed in Rob's Discord

  // Don't send anything if no url found - this makes Discord webhooks optional
  if (!url) return;

  const body = {
    author: {
      name: "Stampy's answer doc parser",
    },
    content,
    ...(embeds.length
      ? {
          embeds: embeds.map((embed) => ({
            ...embed,
            fields: [...Object.entries(embed.fields)].map(([name, value]) => ({
              name,
              value,
            })),
          })),
        }
      : {}),
  };

  fetch(url, {
    method: "post",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

/**
 * Logs error to Discord channel using current pattern
 * @param {string} msg - Error message
 * @param {Object} answer - Answer context
 * @param {Error} error - Error object
 */
export const logError = (msg, answer, error) => {
  console.error(msg, error?.message || "");

  let fields = {
    "Question being processed at time of error":
      answer?.answerName || "Unknown",
  };

  if (error?.message) {
    fields["Message"] = error.message;
  }

  const messageContent = {
    content: "Uncaught exception in Google Docs answer parser",
    embeds: [
      {
        title: msg,
        fields,
      },
    ],
  };
  return sendToDiscord(messageContent, true);
};

/**
 * Executes a function with exponential backoff retry
 * @param {Function} fn - Async function to execute
 * @param {string} operationName - Name of operation for logging
 * @param {Object} options - Options for retry behavior
 * @param {number} [options.maxRetries=5] - Maximum number of retry attempts
 * @param {number} [options.baseDelayMs=10000] - Base delay for exponential backoff in ms
 * @param {Function} [options.isRetryable] - Custom function to determine if an error is retryable
 * @returns {Promise<any>} - Result of the function
 */
export const withRetry = async (fn, operationName, options = {}) => {
  // Configuration constants for retry
  const BASE_RETRY_DELAY_MS = 10000; // Base delay for exponential backoff (10 seconds)
  const MAX_RETRIES = 5; // Maximum number of retry attempts

  const maxRetries = options.maxRetries || MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs || BASE_RETRY_DELAY_MS;

  // Default retryable error check - handle both status codes and content type errors
  const defaultIsRetryable = (error) => {
    // Get status code from either source (Google API or Coda API format)
    const status = error?.response?.status || error?.status;

    if (status) {
      return (
        status === 429 || status === 502 || status === 503 || status === 504
      );
    }

    // Check for content type mismatch errors (HTML instead of JSON)
    if (
      error instanceof SyntaxError &&
      (error.message.includes("Unexpected token") ||
        error.message.includes("non-JSON response"))
    ) {
      console.log("Detected HTML response instead of JSON - will retry");
      return true;
    }

    // Check for network errors
    if (error.message?.includes("fetch failed")) {
      console.log("Detected network error - will retry");
      return true;
    }

    return false;
  };

  const isRetryable = options.isRetryable || defaultIsRetryable;

  let retryCount = 0;
  let success = false;

  while (!success && retryCount < maxRetries) {
    try {
      const result = await fn();
      success = true;
      return result;
    } catch (error) {
      retryCount++;

      // Check if this is a retryable error
      if (!isRetryable(error)) {
        // Don't retry for non-retryable errors
        throw error;
      }

      // If we've reached max attempts, give up
      if (retryCount >= maxRetries) {
        console.error(
          `${operationName} failed after ${maxRetries} attempts:`,
          error.message
        );

        // Log more details about the error for debugging
        if (error instanceof SyntaxError && error.rawHtml) {
          console.error("Failed with HTML response (first 500 chars):");
          console.error(error.rawHtml.substring(0, 500));
        }

        throw error;
      }

      // Calculate exponential backoff delay
      const delay = baseDelayMs * Math.pow(2, retryCount - 1);
      console.log(
        `${operationName} failed (attempt ${retryCount}/${maxRetries}). Retrying in ${
          delay / 1000
        }s...`
      );
      console.log(`Error: ${error.message}`);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};
