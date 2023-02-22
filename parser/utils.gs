const pprint = data => console.log(JSON.stringify(data, null, 2))
const codaToken = "get your own at https://coda.io/account -> API Settings -> Generate API token"
const ftch = (url, body = {}, options = {headers: {}}) => (
  JSON.parse(
    UrlFetchApp.fetch(
      encodeURI(url),
      {
        ...options,
        ...(body ? {body: JSON.stringify(body)} : {}),
        headers: { ...options.headers, Authorization: `Bearer ${codaToken}` },
      }
    ).getContentText("UTF-8")
  )
)

const getDocIDFromLink = docLink => docLink.match(/https:\/\/\w+.google.com\/(\w+\/)+(?<docID>[_-\w]{25,}).*/).groups.docID

const isInitialQuestion = question => question.values[codaColumnIDs.initialOrder] !== ""

// Returns a list of tuples, each looking like [answer ID from coda, answer document ID fromn GDocs]
const getAnswers = () => {
  let queryURL = `${tableURL}/rows`

  // Coda only sends a limited number of rows at a time, so track whether we've retrieved all of them yet
  let isScanComplete = false
  let rows = []
  while (isScanComplete === false) {
    const { items: answerBatch, nextPageLink = null } = ftch(queryURL)
    rows = rows.concat(answerBatch)

    // If there are more rows we haven't yet retrieved, Coda gives us a link we can access to get the next page
    if (nextPageLink) {
      queryURL = nextPageLink
    // If that link isn't provided, we can assume we've retrieved all rows
    } else {
      isScanComplete = true
    }
  }

  return rows
    // There are some malformed rows in the table thanks to the Coda / GDocs pack. These are manually set to have a UI ID of -1 so we can filter them out
    .filter(row => row.values["c-J0hTr2p6-T"] !== "-1")
    // And finally do some transformations to keep the data we use downstream and discard what we don't
    .map(row => ({
      codaID: row.id,
      answerName: row.name,
      docID: getDocIDFromLink(row.values[codaColumnIDs.docURL]),
      ...row.values
    }))
}

// Some answers are HUGE and full of youtube embeds, so we sometimes need to squash them as Coda only lets us push 85KB into their API at a time. 40K of markdown seems to become 95K over the wire, so we set our limit a good few K under that.
const compressMarkdown = md => {
  const beforeSize = md.length
  let currentSize = beforeSize
  let ret = md

  if (beforeSize > 25000) {
    // <iframe src="https://www.youtube.com/embed/${videoID}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n\n
    ret = ret.replaceAll(/<iframe src="https:\/\/www.youtube.com\/embed\/(?<videoID>[A-z0-9\-_]+)" title="(?<videoTitle>.*?)" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen><\/iframe>/g, "\n[$<videoTitle>](https://youtu.be/$<videoID>)\n")
    currentSize = ret.length
  }

  // Also clear out excessive newlines, we get a lot of those
  ret = ret.replaceAll(/\n\n(\n+)/g, "\n\n")
  currentSize = ret.length

  return ret
}

const parserError = (text, data) => {
  return new Error(JSON.stringify({errMsg: text, ...(data ? {data} : {})}))
}

const sendToDiscord = ({content = "Missing error details", embeds = []} = {}, isError = false) => {
  const url = isError
    ? "Secret webhook URL goes here" // Goes to #stampy-error-log in Rob's Discord
    : "Secret webhook URL goes here" // Goes to #wiki-feed in Rob's Discord

  const body = {
    author: {
      name: "Stampy's answer doc parser"
    },
    content,
    ...(embeds.length ? {
      embeds: embeds.map(embed => ({...embed, fields: [...Object.entries(embed.fields)].map(([name, value]) => ({name, value}))}))
    } : {})
  }

  UrlFetchApp.fetch(
    url,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body)
    }
  )
}

const isParent = (file, folder) => {
  try {
    var folders = file.getParents()
    while (folders.hasNext()) {
      if (folders.next().getId() == folder.getId())
        return true
    }
  } catch (error) {
    console.error('could not check parents for', file.getName(), folder.getName(), error)
  }
  return false
}

const folders = {
  'Live on site': DriveApp.getFolderById('1feloLCiyc3XSxfaQ0L_fqVVsFMupw2JM'),
  'In progress': DriveApp.getFolderById('1U2h3Tte38EkOff9flwo6FKVZn8OhkNLW'),
  'Answers': DriveApp.getFolderById('1XUTbO31BMSBBZLhwFsvPObnuMbVVd59H'),
}

const moveAnswer = (answer) => {
  var file;
  try {
    file = DriveApp.getFileById(answer.docID)
  } catch (error) {
    console.error('could not get file for', answer.answerName, error)
    return answer
  }
  if(file.getMimeType() !== 'application/vnd.google-apps.document')
    return answer

  const folder = answer[codaColumnIDs.status] == 'Live on site' ? folders['Live on site'] : folders['In progress']
  if (isParent(file, folders.Answers) && !isParent(file, folder)) {
    console.log('moving', answer.answerName, 'to', folder.getName())
    try {
      file.moveTo(folder)
    } catch (error) {
      console.error('could not move file:', error)
    }
  }
  return answer
}
