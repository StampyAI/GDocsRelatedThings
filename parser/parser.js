import escapeHtml from "escape-html";

// Extract the whole contents of a paragraph block as a single string
const extractBlockText = (block) =>
  block.paragraph?.elements
    .map((element) => element.textRun?.content)
    .filter(Boolean)
    .map((text) => text.trim())
    .join("");

const extractFootnotes = (documentContext, doc) =>
  Object.keys(documentContext.footnotes)
    .map(
      (fnID) =>
        `[^${fnID}]:` +
        doc.footnotes[fnID].content
          .map(({ paragraph }) => {
            const { elements, ...paragraphContext } = paragraph;
            return elements
              .map(parseElement({ documentContext, paragraphContext }))
              .join("");
          })
          .join("\n    ")
    )
    .join("\n");

// This gets a little messy because we may have related answers referenced with either rich "chip" links or plain text links
const extractRelatedAnswerIDs = (blocks) =>
  blocks
    .map((block) => block.paragraph?.elements[0])
    .filter(Boolean)
    .map((block) =>
      block.richLink
        ? block?.richLink.richLinkProperties.uri
        : block.textRun?.textStyle.link?.url
    )
    .filter(Boolean)
    .map(
      (uri) =>
        uri.match(
          /https:\/\/docs.google.com\/document\/d\/([A-z0-9_-]+)/
        )?.[1] ?? null
    )
    .filter(Boolean);

const extractAllParagraphs = (blocks) =>
  blocks
    .filter((block) => Object.keys(block).includes("paragraph"))
    .map((b) => b.paragraph);

const extractDocParts = (doc) => {
  const sectionHeaders = {
    "alternative phrasings": "alternatives",
    "alternate phrasings": "alternatives",
    scratchpad: "scratchpad",
    related: "related",
  };
  const blocks = doc.body.content.reduce(
    (context, block) => {
      const text = extractBlockText(block)
        ?.replace(":", "")
        .trim()
        .toLowerCase();
      if (sectionHeaders[text]) {
        context.contentType = sectionHeaders[text];
        context[context.contentType] = context[context.contentType] || [];
      } else {
        context[context.contentType].push(block);
      }
      return context;
    },
    {
      ...Object.fromEntries(Object.values(sectionHeaders).map((i) => [i, []])),
      content: [],
      contentType: "content",
    }
  );

  return {
    paragraphs: extractAllParagraphs(blocks.content),
    relatedAnswerDocIDs: extractRelatedAnswerIDs(blocks.related),
    alternativePhrasings: blocks.alternatives
      .map(extractBlockText)
      .filter(Boolean),
  };
};

export const parseDoc = async (doc, answer) => {
  const { paragraphs, relatedAnswerDocIDs, alternativePhrasings, glossary } =
    extractDocParts(doc);

  // contextual information about the doc that is sometimes useful
  // to the parsers of particular elements
  const documentContext = {
    footnotes: doc.footnotes || {},
    namedStyles: doc.namedStyles,
    inlineObjects: doc.inlineObjects,
    lists: doc.lists || {},
    suggestions: new Map(), // Accumulators for the count and total text length of all suggestions
    getBulletOrderNumber: makeBulletOrderMap(paragraphs),
  };
  // If the content is just a link to external content, fetch it and use it as the contents
  const tagContent = await fetchExternalContent(paragraphs);
  if (tagContent) {
    const attributionMessage = `<i>This text was automatically imported from [a tag on ${tagContent.sourceName}](${tagContent.sourceUrl}).</i>\n\n`;
    return {
      md: attributionMessage + tagContent.content,
      relatedAnswerDocIDs,
      alternativePhrasings,
    };
  }

  const body = paragraphs.map(parseParagraph(documentContext)).join("\n\n");
  const footnotes = extractFootnotes(documentContext, doc);

  const md = body + "\n\n" + footnotes;

  // Take the maximum of each suggestion's insertions and deletions
  // This helps replacements not seem ridiculously huge
  const suggestions = documentContext.suggestions;
  let suggestionSize = [...suggestions.entries()]
    .map(([_, s], i, a) => Math.max(...Object.values(s)))
    .reduce((size, acc) => acc + size, 0);
  const debug = Object.fromEntries(suggestions.entries());

  const ret = {
    md,
    relatedAnswerDocIDs,
    alternativePhrasings,
    suggestionCount: suggestions.size,
    suggestionSize,
  };

  return ret;
};

// If the doc only contains one paragraph, whose first element which is a link to a LessWrong or EAF tag, do special things
export const fetchExternalContent = async (paragraphs) => {
  const texts = paragraphs
    .map(({ elements }) =>
      elements
        .filter(
          (e) =>
            e?.textRun?.content?.trim() && !e?.textRun?.suggestedInsertionIds
        )
        .map((e) => e?.textRun?.content)
    )
    .flat();

  if (texts.length !== 1) return null;

  const text = texts[0];

  const tagHandlers = [
    [
      /https:\/\/(www.)?lesswrong.com\/tag\/(?<tagName>[A-z0-9_-]+)/,
      getLWTag,
      "LessWrong",
    ],
    [
      /https:\/\/forum.effectivealtruism.org\/topics\/(?<tagName>[A-z0-9_-]+)/,
      getEAFTag,
      "the EA Forum",
    ],
    [
      /https:\/\/(www.)?alignmentforum.org\/tag\/(?<tagName>[A-z0-9_-]+)/,
      getAFTag,
      "the Alignment Forum",
    ],
  ];

  for (const [regex, handler, sourceName] of tagHandlers) {
    const match = text.match(regex);
    if (match) {
      const content = await handler(match.groups.tagName);
      return { content, sourceName, sourceUrl: text };
    }
  }
  return null;
};

const LWGraphQLQuery = async (host, query) => {
  const result = await fetch(encodeURI(`${host}/graphql?query=${query}`), {
    timeout: 5000,
  });
  return await result.json();
};

export const getTag = async (host, tagName) => {
  const tagQuery = `tag(input:{selector:{slug:"${tagName}"}})`;
  const asMd = await LWGraphQLQuery(
    host,
    `{${tagQuery}{result{description{markdown,version}}}}`
  );

  if (asMd?.data?.tag?.result?.description?.version < "1.1.0") {
    const contents = await LWGraphQLQuery(
      host,
      `{${tagQuery}{result{htmlWithContributorAnnotations}}}`
    );
    return contents?.data?.tag?.result?.htmlWithContributorAnnotations;
  }

  const md = asMd?.data?.tag?.result?.description?.markdown || "";

  // EAF mostly gives us valid markdown but their citations are in a really weird format
  // It's unlike anything I can see in the reference material I'm using to write our markdown
  // https://www.markdownguide.org/extended-syntax/#footnotes

  // Lots and lots of escaping here because the text we're sent looks like:
  // ^[\\[1\\]](#fn0f5x8s34vee)^
  // and needs to become:
  // [^0f5x8s34vee]
  const footnotePattern = /\^\[\\\[\d+\\\]\]\(#fn([A-z0-9]+)\)\^/gm;
  const footnoteReplacement = "[^$1]";

  // This one's even worse! We need to replace things that look like:
  // 1.  ^**[^](#fnref0f5x8s34vee)**^ [and then two newlines]
  // With things that look like:
  // [^0f5x8s34vee]:
  const footnoteRefPattern =
    /^\d+\.  \^\*\*\[\^\]\(#fnref([A-z0-9]+)\)\*\*\^\n    \n    /gm;
  const footnoteRefReplacement = "[^$1]: ";

  return md
    .replace(footnotePattern, footnoteReplacement)
    .replace(footnoteRefPattern, footnoteRefReplacement);
};

const getLWTag = (tagName) => getTag("https://www.lesswrong.com", tagName);
const getEAFTag = (tagName) =>
  getTag("https://forum.effectivealtruism.org", tagName);
const getAFTag = (tagName) => getTag("https://www.alignmentforum.org", tagName);

const extractUrl = (element) => element?.textRun?.textStyle?.link?.url;
// Google docs sometime split things that obviously go together into smaller parts.
// This is usually fine if it's just a matter of styling, but can be annoying when it
// does it to links
export const mergeSameElements = (elements) =>
  elements.reduce((acc, item) => {
    const prev = acc[acc.length - 1];
    if (extractUrl(item) && extractUrl(prev) === extractUrl(item)) {
      if (!item?.textRun?.suggestedInsertionIds) {
        prev.textRun.content += item.textRun.content;
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);

const isQuote = (paragraphStyle) => {
  const indentStart = paragraphStyle?.indentStart?.magnitude || 0;
  const QUOTE_INDENT_THRESHOLD = 18; // Standard indentation button is 36pt, we test lower
  return indentStart >= QUOTE_INDENT_THRESHOLD;
};

export const parseParagraph = (documentContext) => (paragraph) => {
  const { elements, ...paragraphContext } = paragraph;
  const paragraphStyle = paragraphContext.paragraphStyle || {};
  const paragraphStyleName = paragraphStyle.namedStyleType;

  let md = mergeSameElements(elements).map(
    parseElement({ documentContext, paragraphContext })
  );

  let prefix = "";
  let itemMarker = "";
  let leadingSpace = "";

  // First we check if the "paragraph" is a heading, because the markdown for a heading is the first thing we need to output
  if (paragraphStyleName?.indexOf("HEADING_") === 0) {
    const headingLevel = parseInt(paragraphStyleName[8]);
    const headingPrefix = new Array(headingLevel).fill("#").join("") + " ";
    prefix = headingPrefix;
  }

  if (md.join("").trim() === "") {
    // If the paragraph is empty (e.g. consists only of suggestions), then ignore it
    return "";
  } else if (paragraphContext.bullet) {
    const pb = paragraphContext.bullet;
    const nestingLevel = pb.nestingLevel || 0;
    const listID = pb.listId;
    const list = documentContext.lists[listID];
    const currentLevel = list.listProperties.nestingLevels[nestingLevel];
    if (!currentLevel) {
      throw new Error(
        "Level information should be available for all nesting levels. Input json must be incorrect"
      );
    }

    // This check is ugly as sin, but necessary because GDocs doesn't actually clearly say "this is an [un]ordered list" anywhere
    // I think this is because internally, all lists are ordered and it just only sometimes uses glyphs which represent that
    // Anyway, ordered lists specify a "glyphType" while unordered ones specify a "glyphSymbol" so we're using that as a discriminator
    const isOrdered =
      currentLevel.hasOwnProperty("glyphType") &&
      currentLevel.glyphType !== "GLYPH_TYPE_UNSPECIFIED";

    const getBulletOrder = (paragraph) => {
      const orderNumber = documentContext.getBulletOrderNumber(paragraph);
      if (!orderNumber) {
        throw new Error(
          "Order number should be available for all ordered paragraphs"
        );
      }
      return orderNumber;
    };
    itemMarker = isOrdered ? getBulletOrder(paragraph) + ". " : "- ";
    leadingSpace = new Array(nestingLevel).fill("    ").join("");
    return (
      leadingSpace +
      itemMarker +
      prefix +
      md.join("").replaceAll("\n", "\n" + leadingSpace + "    ")
    );
  } else {
    let quotePrefix = "";
    if (isQuote(paragraphStyle)) {
      quotePrefix = "> ";
    }
    return (
      leadingSpace +
      itemMarker +
      quotePrefix +
      prefix +
      md.join("").replaceAll("\n", "\n" + leadingSpace + quotePrefix)
    );
  }
};

/**
 * The order numbers for paragraph bullets are stored to then be used in the actual parsing.
 * This is done separately from the parsing because it must be done on the paragraphs in order.
 * Once the bullet orders are determined then further parsing could be done out of order.
 * @param {*} paragraphs an array of paragraphs where the list items are in the desired order
 * @returns order number getter function
 */
export const makeBulletOrderMap = (paragraphs) => {
  // Using the startIndex of the first element of the paragraph
  // Assuming that each paragraph has at least one element
  const getParagraphId = (paragraph) => {
    const firstElement = paragraph.elements[0];
    return firstElement.startIndex;
  };

  const bulletOrderNumbers = new Map();
  const listBulletCounters = new Map();
  paragraphs.forEach((paragraph) => {
    const { elements, ...paragraphContext } = paragraph;
    const { bullet: pb } = paragraphContext;
    if (!pb) return;

    const listCounter = listBulletCounters.get(pb.listId) || new Map();
    listBulletCounters.set(pb.listId, listCounter);

    // Each nesting level should have separate count
    const nestingLevel = pb.nestingLevel || 0;
    const paragraphOrderNum = (listCounter.get(nestingLevel) || 0) + 1;
    listCounter.set(nestingLevel, paragraphOrderNum);

    const paragraphId = getParagraphId(paragraph);
    if (bulletOrderNumbers.has(paragraphId)) {
      throw new Error("ParagraphId should be unique for each paragraph");
    }
    bulletOrderNumbers.set(paragraphId, paragraphOrderNum);
  });

  return (paragraph) => {
    const paragraphId = getParagraphId(paragraph);
    return bulletOrderNumbers.get(paragraphId);
  };
};

export const parsetextRun = ({ textStyle, content }) => {
  if (content === "\n" || content.length === 0) {
    //  We add newlines into the markdown when joining all the segments up, so we don't need to keep pieces of text that are just newlines
    return "";
  }

  const isType = (type) =>
    textStyle &&
    Object.keys(textStyle).includes(type) &&
    textStyle[type] !== false;

  let text = content;

  // GDocs spits out lots of differently formatted things as "textRun" elements so we need a bunch of checks here to make sure we do everything required by the formatting

  let prefix = "";
  let suffix = "";

  if (content.trim() !== "") {
    if (isType("underline") && !Object.keys(textStyle).includes("link")) {
      prefix = "<u>" + prefix;
      suffix += "</u>";
    }

    if (isType("bold")) {
      prefix = "**" + prefix;
      suffix += "**";
    }

    if (isType("italic")) {
      prefix = "*" + prefix;
      suffix += "*";
    }
  }

  // Allow links that are have whitespace as their label. Probably a typo if happens, but they do happen
  if (isType("link")) {
    prefix += "[";
    suffix = `](${textStyle.link.url})` + suffix;
  }

  // This looks kinda weird but basically sometimes Google gives us a string like "THIS IS SOME BOLD TEXT " - notice the trailing space
  // Markdown doesn't handle **THIS IS SOME BOLD TEXT ** correctly so we need to move that whitespace outside of the formatting markers.
  // Though sometimes strings consisting of only spaces come, and those should be left alone.
  if (content.trim() !== "") {
    const leadingSpaceRegex = /^\s+/u;
    const trailingSpaceRegex = /\s+$/u;
    prefix = (content.match(leadingSpaceRegex)?.[0] || "") + prefix;
    suffix = suffix + (content.match(trailingSpaceRegex)?.[0] || "");
    text = text.trim();
    // Escape HTML, but only if the line doesn't look like a block quote. Markdown blockquotes start with a '>', which would be escaped away.
    // This of course means that a multiline HTML tag might not get escaped properly... The hope is that people avoid using raw HTML in docs
    // which would make this issue moot. Unless someone wants to quote HTML for some reason.
    if (text.search(/^\s*>/) === -1) {
      text = escapeHtml(text);
    }
  }

  return (prefix + text + suffix).replace(/\u000B/g, "\n");
};

export const parserichLink = (
  { richLinkProperties: { title, uri } },
  context
) => {
  const youtubeURL =
    /^(https?:)?\/\/(www.)?youtube.com\/watch\?v=(?<videoID>[A-z0-9\-_]+)/;
  const youtubeURLShort =
    /^(https?:)?\/\/(www.)?youtu.be\/(?<videoID>[A-z0-9\-_]+)/;

  const videoID =
    uri.match(youtubeURL)?.groups?.videoID ||
    uri.match(youtubeURLShort)?.groups?.videoID ||
    null;

  if (videoID && !context.paragraphContext.bullet) {
    const params = new URL(uri).searchParams;
    const extra = !!params.get("t")
      ? `?start=${params.get("t").replace("s", "")}`
      : "";
    // Many markdown renderers might not like iframes so some clients will need to replace this with the commented out Markdown below
    // Also append two newlines, as that punts any text that's been put in the same paragraph as the link in the GDoc into a new paragraph, which is necessary to ensure some Markdown renderers don't choke. Github-flavoured Markdown in particular seems to refuse to render any additional syntax that's on the same line as an iframe, and just spits everything out as plain text
    const iframeParams = [
      `src="https://www.youtube.com/embed/${videoID}${extra}"`,
      `title="${title}"`,
      `style="width: 100%;height: 100%;position: absolute;top: 0;"`,
      `frameborder="0"`,
      `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"`,
      `allowfullscreen`,
    ];
    const iframe = `<iframe ${iframeParams.join(" ")}></iframe>`;
    return `<div style="position: relative; width: 100%; padding-top: 56.25%;">${iframe}</div>\n\n`;
    // return `[![Youtube video - ${title}](https://img.youtube.com/vi/${videoID}/maxresdefault.jpg "${title}")](${uri})`
  } else {
    return `[${title}](${uri})`;
  }
};

export const parsefootnoteReference = (footnoteReference) => {
  return `[^${footnoteReference.footnoteId}]`;
};

export const parseinlineObjectElement = (
  inlineObjectElement,
  { documentContext }
) => {
  // I hate this line. The JSON representation of a google Doc is fairly deeply nested, this is just the path we have to probe to get the URL of the image that's been references by the object ID in the paragraph
  const image =
    documentContext.inlineObjects[inlineObjectElement.inlineObjectId]
      .inlineObjectProperties.embeddedObject;
  const imageURL = image.imageProperties.contentUri;

  return (
    "\n" +
    `![${image.description || ""}](${imageURL}${
      image.title ? ` "${image.title.replace(/"/g, '\\"')}"` : ""
    })` +
    "\n"
  );
};

export const parsehorizontalRule = () => {
  return "___";
};

export const tableParser = (context) => {
  const paragraphParser = parseParagraph(context);
  const extractRow = ({ tableCells }) =>
    tableCells.map(({ content }) =>
      extractAllParagraphs(content).map(paragraphParser).join("\n")
    );

  return ({ tableRows }) => {
    const rawRows = tableRows.map(extractRow);
    const header = rawRows[0].map((i) => i.toLowerCase().trim());

    return rawRows
      .slice(1)
      .map((row) => Object.fromEntries(row.map((val, i) => [header[i], val])));
  };
};

const updateSuggestions = (docContext, elementContent, key, amount) => {
  const suggestions = docContext?.suggestions;
  if (!suggestions) return;

  const id =
    key == "insertions"
      ? elementContent.suggestedInsertionIds[0]
      : elementContent.suggestedDeletionIds[0];
  const existingSuggestion = suggestions.get(id) || {
    insertions: 0,
    deletions: 0,
  };
  suggestions.set(id, {
    ...existingSuggestion,
    [key]: existingSuggestion[key] + amount,
  });
};

export const parseElement = (context) => (element) => {
  const parsers = {
    textRun: parsetextRun,
    richLink: parserichLink,
    footnoteReference: parsefootnoteReference,
    inlineObjectElement: parseinlineObjectElement,
    horizontalRule: parsehorizontalRule,
    table: tableParser(context),
    pageBreak: () => "\n\n", // Page breaks will render as paragraph changes
  };

  const elementType = Object.keys(element).find(
    (property) => property !== "startIndex" && property !== "endIndex"
  );

  const elementContent = element[elementType];

  // Add a fallback for unknown element types
  if (!parsers[elementType]) {
    console.warn(`Warning: Unknown element type "${elementType}" - ignoring`);
    return "";
  }

  let md = parsers[elementType](elementContent, context);

  // We want to store the total size of all insertions and deletions for each suggestion so we can search for Answers with lots of pending changes
  // If the suggestion is a replacement, we don't want it to seem super huge compared to an insertion or a deletion
  // So rather than adding the sizes of the insertion and deletion, we just take the larger of the two
  if (elementContent.suggestedInsertionIds) {
    updateSuggestions(
      context.documentContext,
      elementContent,
      "insertions",
      md.length
    );
    return "";
  } else if (elementContent.suggestedDeletionIds) {
    updateSuggestions(
      context.documentContext,
      elementContent,
      "deletions",
      md.length
    );
    return md;
  } else {
    return md;
  }
};
