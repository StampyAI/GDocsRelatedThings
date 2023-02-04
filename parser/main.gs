// CONFIG OPTIONS
const forceFullSync = false // Set to true to make the parser try to run on all questions, which will fail because it takes too long and Google kills the script
// END CONFIG OPTIONS

// Constants - probably don't touch these
const basePath = "https://coda.io/apis/v1/"
const codaDocID = "fau7sl2hmG"
const docURL = `${basePath}/docs/${codaDocID}`
const tableID = "grid-sync-1059-File"
const tableURL = `${docURL}/tables/${tableID}`
const codaColumnIDs = {
  docLastEdited: "c-UQjERPXq8o",
  docURL: "c-5qIm4D1QKk",
  initialOrder: "c-PoAylKpEVt",
  lastIngested: "c-Z-xWeQivE_",
  preexistingSuggestionCount: "c-sgnPwFMbn8",
  preexistingSuggestionSize: "c-6DnuBdIZ02",
  relatedAnswerNames: "c-b0YvHsTj0l",
  richText: "c-S6ub6E1V-a",
}
// End constants

// Our main() equivalent - this function just kinda wraps all the other calls up in one place.
const parseAllAnswerDocs = () => {
  const allAnswers = getAnswers()

  allAnswers
    // .filter(({codaID}) => codaID === "i-94b6d980d29da08d2c47b14967d79713e1331d8c9dcbc6eab191b47b949d5bfc") // Uncomment this line to run only on the example question
    .filter(answer => {
      const lastIngestDateString = answer[codaColumnIDs.lastIngested]
      const lastIngestDate = new Date(lastIngestDateString)
      const lastDocEditDate = new Date(answer[codaColumnIDs.docLastEdited])

      return (
        forceFullSync
        || lastIngestDateString === ""
        || lastDocEditDate > lastIngestDate
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

      if (status === 202) console.log(`Submitted update to Coda for answer "${answer.answerName}" with google doc ID ${answer.docID}`)
      else console.log(`Something went wrong submitting an update for answer "${answer.answerName}" with google doc ID ${answer.docID}`)
    })
}
