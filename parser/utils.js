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

  // Also clear out excessive newlines, we get a lot of those
  ret = ret.replaceAll(/\n\n(\n+)/g, "\n\n");
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
