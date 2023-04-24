import { google } from "googleapis";
import { JWT } from "google-auth-library";
import fs from "fs";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

const keyPath = "credentials.json";

const getCredentials = () => {
  if (process.env.GCLOUD_CREDENTIALS) {
    console.info("Using Google credentials from GCLOUD_CREDENTIALS");
    return JSON.parse(process.env.GCLOUD_CREDENTIALS);
  }

  console.info("Using Google credentials from credentials.json file");
  const data = fs.readFileSync(keyPath, "utf8");
  return JSON.parse(data);
};

const authenticate = async () => {
  try {
    const credentials = getCredentials();
    return new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      SCOPES
    );
  } catch (err) {
    console.error(err);
  }
};

export const getDriveClient = async () => {
  const auth = await authenticate();
  return google.drive({ version: "v3", auth });
};

export const getDocsClient = async () => {
  const auth = await authenticate();
  return google.docs({ version: "v1", auth });
};

export const getGoogleDoc = async (docId, docs) => {
  try {
    const result = await docs.documents.get({ documentId: docId });
    return result.data;
  } catch (err) {
    if (err?.response?.status == 400) {
      console.error(
        `Could not fetch doc ${docId}: ${err.response?.statusText}`
      );
    } else {
      console.error(err);
    }
  }
};

// const isParent = (file, folder) => {
//   try {
//     var folders = file.getParents()
//     while (folders.hasNext()) {
//       if (folders.next().getId() == folder.getId())
//         return true
//     }
//   } catch (error) {
//     console.error('could not check parents for', file.getName(), folder.getName(), error)
//   }
//   return false
// }

const folders = {
  "Live on site": "1feloLCiyc3XSxfaQ0L_fqVVsFMupw2JM",
  "In progress": "1U2h3Tte38EkOff9flwo6FKVZn8OhkNLW",
  Answers: "1XUTbO31BMSBBZLhwFsvPObnuMbVVd59H",
};

// const folders = {
//   'Live on site': DriveApp.getFolderById('1feloLCiyc3XSxfaQ0L_fqVVsFMupw2JM'),
//   'In progress': DriveApp.getFolderById('1U2h3Tte38EkOff9flwo6FKVZn8OhkNLW'),
//   'Answers': DriveApp.getFolderById('1XUTbO31BMSBBZLhwFsvPObnuMbVVd59H'),
// }

// const moveAnswer = (answer) => {
//   var file;
//   try {
//     file = DriveApp.getFileById(answer.docID)
//   } catch (error) {
//     console.error('could not get file for', answer.answerName, error)
//     return answer
//   }
//   if(file.getMimeType() !== 'application/vnd.google-apps.document')
//     return answer

//   const folder = answer[codaColumnIDs.status] == 'Live on site' ? folders['Live on site'] : folders['In progress']
//   if (isParent(file, folders.Answers) && !isParent(file, folder)) {
//     console.log('moving', answer.answerName, 'to', folder.getName())
//     try {
//       file.moveTo(folder)
//     } catch (error) {
//       console.error('could not move file:', error)
//     }
//   }
//   return answer
// }

export const getFilesInFolder = async (folderId, drive) => {
  const query = `'${folderId}' in parents and trashed = false`;
  const files = [];
  let nextPageToken = null;

  do {
    const params = {
      q: query,
      fields: "nextPageToken, files(id, name, mimeType)",
    };
    if (nextPageToken) {
      params.pageToken = nextPageToken;
    }
    const res = await drive.files.list(params);
    files.push(...res.data.files);
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  return files;
};
