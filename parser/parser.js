const identity = (a) => a;

export const parseDoc = async (doc) => {
  // contextual information about the doc that is sometimes useful
  // to the parsers of particular elements
  const documentContext = {
    footnotes: doc.footnotes || {},
    namedStyles: doc.namedStyles,
    inlineObjects: doc.inlineObjects,
    lists: doc.lists || {},
    suggestions: new Map(), // Accumulators for the count and total text length of all suggestions
  };

  // Finding the position of the related marker - it's a paragraph with only one element whose text content is the word "Related"
  const endOfContentPosition = doc.body.content.findIndex(
    (block) => block.paragraph?.elements[0].textRun?.content === "Related\n"
  );

  // Everything up to but not including the "Related" marker is considered answer text
  const answerBody =
    endOfContentPosition === -1
      ? doc.body.content
      : doc.body.content.slice(0, endOfContentPosition);
  // Everything after it is related answers
  const related =
    endOfContentPosition === -1
      ? []
      : doc.body.content.slice(endOfContentPosition + 1);

  // Discard everything that doesn't contain a "paragraph", and is before the "Related" boundary
  // Everything we care about preserving is inside a paragraph, and everything that's after the "Related" marker is basically metadata
  const paragraphs = answerBody
    // Grabbing just content that contains paragraphs
    .filter((block) => Object.keys(block).includes("paragraph"))
    .map((b) => b.paragraph);

  // This gets a little messy because we may have related answers referenced with either rich "chip" links or plain text links
  const relatedAnswerDocIDs =
    endOfContentPosition > -1
      ? related
          .map((block) => block.paragraph.elements[0])
          .map((block) =>
            block.richLink
              ? block?.richLink.richLinkProperties.uri
              : block.textRun?.textStyle.link?.url
          )
          .filter(identity)
          .map(
            (uri) =>
              uri.match(
                /https:\/\/docs.google.com\/document\/d\/([A-z0-9_-]+)/
              )?.[1] ?? null
          )
          .filter(identity)
      : [];

  // If the content is just a link to external content, fetch it and return it right away
  const tagContent = await fetchExternalContent(paragraphs);
  if (tagContent) {
    return { md: tagContent, relatedAnswerDocIDs };
  }

  const body = paragraphs.map(parseParagraph(documentContext)).join("\n\n");

  const footnotes = Object.keys(documentContext.footnotes)
    .map((fnID) => {
      return (
        `[^${fnID}]:` +
        doc.footnotes[fnID].content
          .map(({ paragraph }) => {
            const { elements, ...paragraphContext } = paragraph;
            return elements
              .map(parseElement({ documentContext, paragraphContext }))
              .join("");
          })
          .join("\n    ")
      );
    })
    .join("\n");

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
    suggestionCount: suggestions.size,
    suggestionSize,
  };

  return ret;
};

// If the doc only contains one paragraph, whose first element which is a link to a LessWrong or EAF tag, do special things
export const fetchExternalContent = async (paragraphs) => {
  const nonEmpty = paragraphs.filter(({ elements }) =>
    elements.some((element) => (element?.textRun?.content?.trim() || "") !== "")
  );
  if (nonEmpty.length !== 1 || !nonEmpty[0].elements[0]?.textRun?.content)
    return null;

  const text = nonEmpty[0].elements[0].textRun.content;

  const tagHandlers = [
    [/https:\/\/(www.)?lesswrong.com\/tag\/(?<tagName>[A-z0-9_-]+)/, getLWTag],
    [
      /https:\/\/forum.effectivealtruism.org\/topics\/(?<tagName>[A-z0-9_-]+)/,
      getEAFTag,
    ],
  ];

  for (const [regex, handler] of tagHandlers) {
    const match = text.match(regex);
    if (match) {
      return await handler(match.groups.tagName);
    }
  }
  return null;
};

export const getTag = async (host, tagName) => {
  const result = await fetch(
    encodeURI(
      `${host}/graphql?query={tag(input:{selector:{slug:"${tagName}"}}){result{description{markdown}}}}`
    )
  );
  const contents = await result.json();
  const md = contents?.data?.tag?.result?.description?.markdown || "";

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

export const parseParagraph = (documentContext) => (paragraph) => {
  const { elements, ...paragraphContext } = paragraph;
  const paragraphStyleName = paragraphContext.paragraphStyle.namedStyleType;

  let md = elements.map(parseElement({ documentContext, paragraphContext }));

  let prefix = "";
  let itemMarker = "";
  let leadingSpace = "";

  // First we check if the "paragraph" is a heading, because the markdown for a heading is the first thing we need to output
  if (paragraphStyleName.indexOf("HEADING_") === 0) {
    const headingLevel = parseInt(paragraphStyleName[8]);
    const headingPrefix = new Array(headingLevel).fill("#").join("") + " ";
    prefix = headingPrefix;
  }

  if (paragraphContext.bullet) {
    const pb = paragraphContext.bullet;
    const nestingLevel = pb.nestingLevel || 0;
    const listID = pb.listId;
    const list = documentContext.lists[listID];
    const currentLevel = list.listProperties.nestingLevels[nestingLevel];

    // This check is ugly as sin, but necessary because GDocs doesn't actually clearly say "this is an [un]ordered list" anywhere
    // I think this is because internally, all lists are ordered and it just only sometimes uses glyphs which represent that
    // Anyway, ordered lists specify a "glyphType" while unordered ones specify a "glyphSymbol" so we're using that as a discriminator
    const isOrdered =
      currentLevel.hasOwnProperty("glyphType") &&
      currentLevel.glyphType !== "GLYPH_TYPE_UNSPECIFIED";

    // Please forgive me for always using 1. as the sequence number on list items
    // It's sorta hard to count them properly so I'm depending on markdown renderers doing the heavy lifting for me.
    // Which, in fairness, they're supposed to.
    itemMarker = isOrdered ? "1. " : "- ";
    leadingSpace = new Array(nestingLevel).fill("    ").join("");

    return (
      leadingSpace +
      itemMarker +
      prefix +
      md.join("").replaceAll("\n", "\n" + leadingSpace + "    ")
    );
  } else {
    return (
      leadingSpace +
      itemMarker +
      prefix +
      md.join("").replaceAll("\n", "\n" + leadingSpace)
    );
  }
};

const isGrey = (textStyle) => {
  const rgb = textStyle?.foregroundColor?.color?.rgbColor;
  const rgbVals = rgb && Object.values(rgb);
  const tolerance = 0.01;
  return (
    rgbVals && rgbVals.every((val) => Math.abs(val - rgbVals[0]) <= tolerance)
  );
};

export const parsetextRun = ({ textStyle, content }) => {
  if (content === "\n" || content.length === 0 || isGrey(textStyle)) {
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

  if (isType("bold")) {
    prefix += "**";
    suffix += "**";
  }

  if (isType("italic")) {
    prefix += "*";
    suffix += "*";
  }

  if (isType("link")) {
    prefix += "[";
    suffix = `](${textStyle.link.url})` + suffix;
  }

  // This looks kinda weird but basically sometimes Google gives us a string like "THIS IS SOME BOLD TEXT " - notice the trailing space
  // Markdown doesn't handle **THIS IS SOME BOLD TEXT ** correctly so we need to move that whitespace outside of the formatting markers.
  // Though sometimes strings consisting of only spaces come, and those should be left alone.
  if (content.trim() !== "") {
    const leadingSpaceRegex = /^ */;
    const trailingSpaceRegex = / *$/;
    prefix = (content.match(leadingSpaceRegex)?.[0] || "") + prefix;
    suffix = suffix + (content.match(trailingSpaceRegex)?.[0] || "");
    text = text.trim();
  }
  return prefix + text + suffix;
};

export const parserichLink = ({ richLinkProperties: { title, uri } }) => {
  const youtubeURL =
    /^(https?:)?\/\/(www.)?youtube.com\/watch\?v=(?<videoID>[A-z0-9\-_]+)/;
  const youtubeURLShort =
    /^(https?:)?\/\/(www.)?youtu.be\/(?<videoID>[A-z0-9\-_]+)/;

  const videoID =
    uri.match(youtubeURL)?.groups?.videoID ||
    uri.match(youtubeURLShort)?.groups?.videoID ||
    null;

  if (videoID) {
    // Many markdown renderers might not like iframes so some clients will need to replace this with the commented out Markdown below
    // Also append two newlines, as that punts any text that's been put in the same paragraph as the link in the GDoc into a new paragraph, which is necessary to ensure some Markdown renderers don't choke. Github-flavoured Markdown in particular seems to refuse to render any additional syntax that's on the same line as an iframe, and just spits everything out as plain text
    return `<iframe src="https://www.youtube.com/embed/${videoID}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n\n`;
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
  // I hate this line. The JSON representation of a google Doc is fairly deeply nested, this is just the path we have to probe top get the URL of the image that's been references by the object ID in the paragraph
  const image =
    documentContext.inlineObjects[inlineObjectElement.inlineObjectId]
      .inlineObjectProperties.embeddedObject;
  const imageURL = image.imageProperties.contentUri;

  return (
    "\n" +
    `![${image.description || ""}](${imageURL}${
      image.title ? ` ${image.title}` : ""
    })` +
    "\n"
  );
};

export const parsehorizontalRule = () => {
  return "___";
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
  };

  const elementType = Object.keys(element).find(
    (property) => property !== "startIndex" && property !== "endIndex"
  );

  const elementContent = element[elementType];

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
