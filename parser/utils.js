import fetch from "node-fetch";

const pprint = (data) => console.log(JSON.stringify(data, null, 2));

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
  
  // Post-process to ensure no consecutive empty lines (fixes display issues)
  ret = ret.replace(/\n{2,}/g, "\n\n");
  
  // Fix unordered list spacing - normalize all items to single lines
  // This pattern handles any number of consecutive bullet points with any amount of spacing between them
  ret = ret.replace(/^(\s*-[^\n]+\n)(?:\s*\n)*(?=\s*-)/gm, "$1");
  
  // Fix ordered list spacing - normalize all items to single lines
  // Similar pattern for numbered lists
  ret = ret.replace(/^(\s*\d+\.[^\n]+\n)(?:\s*\n)*(?=\s*\d+\.)/gm, "$1");
  
  // Ensure proper spacing between list items and paragraphs
  ret = ret.replace(/^(\s*-[^\n]+?\n)([^-\s])/gm, "$1\n$2");
  ret = ret.replace(/^(\s*\d+\.[^\n]+?\n)([^\d\s])/gm, "$1\n$2");
  
  // Ensure no trailing newlines
  ret = ret.replace(/\n+$/, "");
  
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
