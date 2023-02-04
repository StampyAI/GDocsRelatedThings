// Accumulators for the count and total text length of all suggestions
let suggestionIDs = new Set()
let suggestionSize = 0

const parseDoc = doc => {
  // contextual information about the doc that is sometimes useful
  // to the parsers of particular elements
  const documentContext = {
    footnotes: doc.footnotes || {},
    namedStyles: doc.namedStyles,
    inlineObjects: doc.inlineObjects,
    lists: doc.lists || {},
  }

  // Finding the position of the related marker - it's a paragraph with only one element whose text content is the word "Related"
  const endOfContentPosition = doc.body.content.findIndex(block => block.paragraph?.elements[0].textRun?.content === "Related\n")

  // Everything up to but not including the "Related" marker is considered answer text
  const answerBody = endOfContentPosition === -1 ? doc.body.content : doc.body.content.slice(0, endOfContentPosition)
  // Everything after it is related answers
  const related = endOfContentPosition === -1 ? [] : doc.body.content.slice(endOfContentPosition+1)

  // Discard everything that doesn't contain a "paragraph", and is before the "Related" boundary
  // Everything we care about preserving is inside a paragraph, and everything that's after the "Related" marker is basically metadata
  const paragraphs = answerBody
    // Grabbing just content that contains paragraphs
    .filter(block => Object.keys(block).includes("paragraph")).map(b => b.paragraph)

  // This gets a little messy because we may have related answers referenced with either rich "chip" links or plain text links
  const relatedAnswerDocIDs = endOfContentPosition > -1
    ? related
      .filter(block => (
        block.paragraph.elements[0].hasOwnProperty("richLink"))
        || block.paragraph.elements[0].textRun?.textStyle.link?.url
      )
      .map(block => {
        if (block.paragraph.elements[0].richLink) {
          return block.paragraph.elements[0].richLink.richLinkProperties.uri
        } else {
          return block.paragraph.elements[0].textRun?.textStyle.link?.url
        }
      })
      .map(uri => uri.match(/https:\/\/docs.google.com\/document\/d\/([A-z0-9_-]+)/)?.[1] ?? null).filter(url => url !== null)
    : []

  // If the doc only contains one paragraph, whose first element which is a link to a LessWrong or EAF tag, do special things
  if (
    paragraphs.length === 1
    && paragraphs[0].elements[0].textRun?.content.match(/https:\/\/(www.)?lesswrong.com\/tag\/[A-z0-9_-]+/)
  ) {
    const match = (paragraphs[0].elements[0].textRun?.content.match(
      /https:\/\/(www.)?lesswrong.com\/tag\/(?<tagName>[A-z0-9_-]+)/
    ))

    const md = getLWTag(match.groups.tagName)
    return {md, relatedAnswerDocIDs}
  } else if (
    paragraphs.length === 1
    && paragraphs[0].elements[0].textRun?.content.match(/https:\/\/forum.effectivealtruism.org\/topics\/[A-z0-9_-]+/)
  ) {
    const match = paragraphs[0].elements[0].textRun?.content.match(
      /https:\/\/forum.effectivealtruism.org\/topics\/(?<tagName>[A-z0-9_-]+)/
    )
    
    const md = getEAFTag(match.groups.tagName)
    return {md, relatedAnswerDocIDs}
  } else {
    const body = paragraphs.map(parseParagraph(documentContext)).join("\n\n")

    const footnotes = Object.keys(documentContext.footnotes).map(fnID => {
      return `[^${fnID}]:` + doc.footnotes[fnID].content.map(
        ({paragraph}) => {
          const { elements, ...paragraphContext } = paragraph
          return elements.map(parseElement({documentContext, paragraphContext})).join("")
        }
      ).join("\n    ")
    }).join("\n")

    const md = (body + "\n\n" + footnotes)

    const ret = {md, relatedAnswerDocIDs, suggestionCount: suggestionIDs.size, suggestionSize}

    suggestionIDs = new Set()
    suggestionSize = 0

    return ret
  }
}

const getLWTag = tagName => {
  const md = JSON.parse(UrlFetchApp.fetch(encodeURI(`https://www.lesswrong.com/graphql?query={tag(input:{selector:{slug:"${tagName}"}}){result{description{markdown}}}}`)).getContentText()).data.tag.result.description.markdown

  // EAF mostly gives us valid markdown but their citations are in a really weird format
  // It's unlike anything I can see in the reference material I'm using to write our markdown
  // https://www.markdownguide.org/extended-syntax/#footnotes

  // Lots and lots of escaping here because the text we're sent looks like:
  // ^[\\[1\\]](#fn0f5x8s34vee)^
  // and needs to become:
  // [^0f5x8s34vee]
  const footnotePattern = /\^\[\\\[\d+\\\]\]\(#fn([A-z0-9]+)\)\^/gm
  const footnoteReplacement = "[^$1]"

  // This one's even worse! We need to replace things that look like:
  // 1.  ^**[^](#fnref0f5x8s34vee)**^ [and then two newlines]
  // With things that look like:
  // [^0f5x8s34vee]:
  const footnoteRefPattern = /^\d+\.  \^\*\*\[\^\]\(#fnref([A-z0-9]+)\)\*\*\^\n    \n    /gm
  const footnoteRefReplacement = "[^$1]: "

  return md
    .replace(footnotePattern, footnoteReplacement)
    .replace(footnoteRefPattern, footnoteRefReplacement)
}

const getEAFTag = tagName => {
    const md = JSON.parse(UrlFetchApp.fetch(encodeURI(`https://forum.effectivealtruism.org/graphql?query={tag(input:{selector:{slug:"${tagName}"}}){result{description{markdown}}}}`)).getContentText()).data.tag.result.description.markdown

  // EAF mostly gives us valid markdown but their citations are in a really weird format
  // It's unlike anything I can see in the reference material I'm using to write our markdown
  // https://www.markdownguide.org/extended-syntax/#footnotes

  // Lots and lots of escaping here because the text we're sent looks like:
  // ^[\\[1\\]](#fn0f5x8s34vee)^
  // and needs to become:
  // [^0f5x8s34vee]
  const footnotePattern = /\^\[\\\[\d+\\\]\]\(#fn([A-z0-9]+)\)\^/gm
  const footnoteReplacement = "[^$1]"

  // This one's even worse! We need to replace things that look like:
  // 1.  ^**[^](#fnref0f5x8s34vee)**^ [and then two newlines]
  // With things that look like:
  // [^0f5x8s34vee]:
  const footnoteRefPattern = /^\d+\.  \^\*\*\[\^\]\(#fnref([A-z0-9]+)\)\*\*\^\n    \n    /gm
  const footnoteRefReplacement = "[^$1]: "

  return md
    .replace(footnotePattern, footnoteReplacement)
    .replace(footnoteRefPattern, footnoteRefReplacement)
}

const parseParagraph = documentContext => paragraph => {
  const { elements, ...paragraphContext } = paragraph
  const paragraphStyleName = paragraphContext.paragraphStyle.namedStyleType

  let md = elements.map(parseElement({documentContext, paragraphContext})).join("").replace(/\n$/g, "")

  let prefix = ""
  
  // First we check if the "paragraph" is a heading, because the markdown for a heading is the first thing we need to output
  if (paragraphStyleName.indexOf("HEADING_") === 0) {
    const headingLevel = parseInt(paragraphStyleName[8])
    const headingPrefix = new Array(headingLevel).fill("#").join("") + " "
    prefix = headingPrefix
  }

  if (paragraphContext.bullet) {
    const nestingLevel = paragraphContext.bullet.nestingLevel || 0

    // Ugly as sin, but necessary because GDocs doesn't actually clearly say "this is an [un]ordered list" anywhere
    // I think this is because internally, all lists are ordered and it just only sometimes uses glyphs which represent that
    // Anyway, ordered lists specify a "glyphType" while unordered ones specify a "glyphSymbol" so we're using that as a discriminator
    const isOrdered = documentContext.lists[paragraphContext.bullet.listId].listProperties.nestingLevels[nestingLevel].hasOwnProperty("glyphType")
      && documentContext.lists[paragraphContext.bullet.listId].listProperties.nestingLevels[nestingLevel].glyphType !== "GLYPH_TYPE_UNSPECIFIED"

    // Please forgive me for always using 1. as the sequence number on list items
    // It's sorta hard to count them properly so I'm depending on markdown renderers doing the heavy lifting for me.
    // Which, in fairness, they're supposed to.
    prefix = new Array(nestingLevel).fill("    ").join("") + (isOrdered ? "1. " : "- ") + prefix
  }

  return prefix + md
}

const parsetextRun = textRun => {
  const isType = type => Object.keys(textRun.textStyle).includes(type) && textRun.textStyle[type] !== false

  // GDocs spits out lots of differently formatted things as "textRun" elements so we need a bunch of checks here to make sure we do everything required by the formatting

  if (
    textRun.content === "\n"
    || textRun.content.length === 0
  ) {
    //  We add newlines into the markdown when joining all the segments up, so we don't need to keep pieces of text that are just newlines
    return ""
  } else {
    let prefix = ""
    let suffix = ""

    if (isType("bold")) {
      prefix += "**"
      suffix += "**"
    }

    if (isType("italic")) {
      prefix += "*"
      suffix += "*"
    }

    if (isType("link")) {
      prefix += "["
      suffix = `](${textRun.textStyle.link.url})` + suffix
    }

    // This looks kinda weird but basically sometimes Google gives us a string like "THIS IS SOME BOLD TEXT " - notice the trailing space
    // Markdown doesn't handle **THIS IS SOME BOLD TEXT ** correctly so we need to move that whitespace outside of the formatting markers.
    const leadingSpaceRegex = /^ */
    const trailingSpaceRegex = / *$/
    prefix = (textRun.content.match(leadingSpaceRegex)?.[0] || "") + prefix
    suffix = suffix + (textRun.content.match(trailingSpaceRegex)?.[0] || "")
    const trimmedText = textRun.content.trim()

    return prefix + trimmedText + suffix
  }
}

const parserichLink = ({richLinkProperties: {title, uri}}) => {
  const youtubeURL =
    /^(https?:)?\/\/(www.)?youtube.com\/watch\?v=(?<videoID>[A-z0-9\-_]+)/;
  const youtubeURLShort =
    /^(https?:)?\/\/(www.)?youtu.be\/(?<videoID>[A-z0-9\-_]+)/;

  const videoID =
    uri.match(youtubeURL)?.groups?.videoID ||
    uri.match(youtubeURLShort)?.groups?.videoID || null

  if (videoID) {
    // Many markdown renderers might not like iframes so some clients will need to replace this with the commented out Markdown below
    // Also append two newlines, as that punts any text that's been put in the same paragraph as the link in the GDoc into a new paragraph, which is necessary to ensure some Markdown renderers don't choke. Github-flavoured Markdown in particular seems to refuse to render any additional syntax that's on the same line as an iframe, and just spits everything out as plain text
     return `<iframe src="https://www.youtube.com/embed/${videoID}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n\n`
    // return `[![Youtube video - ${title}](https://img.youtube.com/vi/${videoID}/maxresdefault.jpg "${title}")](${uri})`
  } else {
    return `[${title}](${uri})`
  } 
}

const parsefootnoteReference = footnoteReference => {
  return `[^${footnoteReference.footnoteId}]`
}

const parseinlineObjectElement = (inlineObjectElement, { documentContext }) => {
  // I hate this line. The JSON representation of a google Doc is fairly deeply nested, this is just the path we have to probe top get the URL of the image that's been references by the object ID in the paragraph
  const embeddedObject = documentContext.inlineObjects[inlineObjectElement.inlineObjectId].inlineObjectProperties.embeddedObject
  const imageURL = embeddedObject.imageProperties.contentUri
  return `![${embeddedObject.description || ""}](${imageURL}${embeddedObject.title && ` "${embeddedObject.title}"`})`
}

const parsehorizontalRule = () => {
  return "___"
}

const parseElement = context => element => {
  const parsers = {
    textRun: parsetextRun,
    richLink: parserichLink,
    footnoteReference: parsefootnoteReference,
    inlineObjectElement: parseinlineObjectElement,
    horizontalRule: parsehorizontalRule,
  }

  const elementType = Object.keys(element).find(property => (
    property !== "startIndex" &&
    property !== "endIndex"
  ))

  const elementContent = element[elementType]

  // Pending insertions are useful for us to track, but we don't want to actually output their content.
  // This check just returns nothing if the element we're currently looking at is tagged as a suggested insertion
  if (elementContent.hasOwnProperty("suggestedInsertionIds")) {
    elementContent.suggestedInsertionIds.forEach(id => suggestionIDs.add(id))
    suggestionSize += parsers[elementType](elementContent, context).length
  } else return parsers[elementType](elementContent, context)
}
