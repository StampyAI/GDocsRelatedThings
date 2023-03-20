// Constants - probably don't touch these
const basePath = "https://coda.io/apis/v1/"
const codaDocID = "fau7sl2hmG"
const codaDocURL = `${basePath}/docs/${codaDocID}`
const tableID = "grid-sync-1059-File"
const tableURL = `${codaDocURL}/tables/${tableID}`
const codaColumnIDs = {
  docLastEdited: "c-UQjERPXq8o",
  docURL: "c-5qIm4D1QKk",
  initialOrder: "c-PoAylKpEVt",
  lastIngested: "c-Z-xWeQivE_",
  preexistingSuggestionCount: "c-sgnPwFMbn8",
  preexistingSuggestionSize: "c-6DnuBdIZ02",
  relatedAnswerNames: "c-b0YvHsTj0l",
  richText: "c-S6ub6E1V-a",
  suggestionCount: "c-sgnPwFMbn8",
  suggestionSize: "c-6DnuBdIZ02",
}
// End constants

// Our main() equivalent - this function just kinda wraps all the other calls up in one place.
const parseAllAnswerDocs = () => {
  try {
    const allAnswers = getAnswers()

    allAnswers
      // .filter(({answerName}) => answerName === "How might a superintelligence socially manipulate humans?") // Limiting the search for testing purposes
      .filter(answer => {
        const lastIngestDateString = answer[codaColumnIDs.lastIngested]
        const lastIngestDate = new Date(lastIngestDateString)
        const lastDocEditDate = new Date(answer[codaColumnIDs.docLastEdited])

        return (
          lastIngestDateString === ""
          || lastDocEditDate > lastIngestDate
          // || answer.docID === "1hHAx92e89YQfBXT96C7BLiuMipcl6LOszGlG2L7rrZo"
          || answer.answerName === "Example with all the formatting"
          || lastIngestDate < new Date("2023-02-11 15:00") // To force a full purge of Docs-sourced data in Coda, set this time to just a minute before "now" and let it run. Don't update the time between runs if one times out, otherwise it'll restart. Just set the time once and let the script run as many time as it needs to in order to finish.
        )
      }).forEach((answer, i, filteredAnswers) => {
        const doc = Docs.Documents.get(answer.docID)
        // At this point we have a huge blob of JSON that looks kinda like:
        // https://gist.github.com/ChrisRimmer/a2a702fe86b5251c235b22c8f4d0e2b4
        let {md, relatedAnswerDocIDs, suggestionCount, suggestionSize} = parseDoc(doc)
        md = compressMarkdown(md)

        // Keep only doc IDs which actually have matching answers
        const validRelatedAnswers = relatedAnswerDocIDs
          .filter(
            // Search for answers with the doc ID we're looking for
            relatedAnswerDocID => {
              return allAnswers.some(a => {
                return a.docID === relatedAnswerDocID
              })
            }
          )

        const relatedAnswerNames = validRelatedAnswers
          .map(
            relatedAnswerDocID => allAnswers.find(
              a => a.docID === relatedAnswerDocID
            ).answerName
          )

        const rowURL = `${tableURL}/rows/${answer.codaID}`
        const payload = {row: {cells: [
          {
            column: codaColumnIDs.relatedAnswerNames,
            value: relatedAnswerNames
          },
          {
            column: codaColumnIDs.lastIngested,
            value: new Date().toISOString()
          },
          {
            column: codaColumnIDs.richText,
            value: md
          },
          {
            column: codaColumnIDs.preexistingSuggestionCount,
            value: suggestionCount
          },
          {
            column: codaColumnIDs.preexistingSuggestionSize,
            value: suggestionSize
          }
        ]}}

        const response = UrlFetchApp.fetch(
          rowURL,
          {
            method: "put",
            muteHttpExceptions: true,
            contentType: "application/json",
            payload: JSON.stringify(payload),
            headers: {Authorization: `Bearer ${codaToken}`}
          }
        )

        const status = response.getResponseCode()
        const responseText = response.getContentText()

        if (status === 202) {
          console.log(`Submitted update to Coda for answer "${answer.answerName}" with google doc ID ${answer.docID}`)

          if (
            (suggestionSize !== answer[codaColumnIDs.suggestionSize] || suggestionCount !== answer[codaColumnIDs.suggestionCount])
            && (suggestionSize > 0  || suggestionCount > 0)
          ) {
            sendToDiscord(
              {
                content: `There ${suggestionCount > 1 ? "are" : "is"} ${suggestionCount} open suggestion${suggestionCount > 1 ? "s" : ""} on the Google Doc for the question "${answer.answerName}" - does anyone have a minute to review ${suggestionCount > 1 ? "them" : "it"}?`,
                embeds: [{
                  title: answer.answerName,
                  url: answer[codaColumnIDs.docURL],
                  fields: {
                    "Number of suggestions": `Was ${answer[codaColumnIDs.suggestionCount] || 0}, now ${suggestionCount}`,
                    "Total size of suggestions": `Was ${answer[codaColumnIDs.suggestionSize] || 0}, now ${suggestionSize}`,
                  }
                }]
              },
              false
            )
          }
        } else if (status === 429) {
          throw "fine"
        } else if (responseText.includes("Row edit of size")) {
          throw parserError(`Markdown was too large for Coda at ${md.length} bytes`, {answer})
        } else {
          throw parserError(`HTTP ${status} response from Coda`, {answer})
        }

        // Make sure the answer's document is in the correct folder
        moveAnswer(answer)
      })
  } catch (e) {
    if (e !== "fine") {
      const errData = JSON.parse(e.message || {})
      let fields = {
        "Question being processed at time of error": errData.data?.answer?.answerName || "Unknown"
      }

      if (errData.errMsg) {
        fields["Message"] = errData.errMsg
      }

      const messageContent = {
        content: "Uncaught exception in Google Docs answer parser",
        embeds: [
          {
            title: e.name,
            fields
          }
        ]
      }

      sendToDiscord(messageContent, true)
    }
  }
}