import { google } from "googleapis";
import { JWT } from "google-auth-library";
import fs from "fs";
import { codaColumnIDs } from "./constants.js";
import { logError } from "./utils.js";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
];

const keyPath = "credentials.json";

const getCredentials = () => {
  if (process.env.GCLOUD_CREDENTIALS) {
    return JSON.parse(process.env.GCLOUD_CREDENTIALS);
  } else {
    const data = fs.readFileSync(keyPath, "utf8");
    return JSON.parse(data);
  }
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

export const getGoogleDoc = async (answer, docs) => {
  try {
    const result = await docs.documents.get({ documentId: answer.docID });
    return result.data;
  } catch (err) {
    if (err?.response?.status == 400) {
      logError(
        `Could not fetch doc ${answer.docID}: ${err.response?.statusText}`,
        answer
      );
    } else if (err?.response?.status == 403) {
      logError(`Permission denied while fetching doc ${answer.docID}`, answer);
    } else if (err?.response?.status == 429) {
      logError(
        `${err?.response.statusText} while fetching doc ${answer.docID}`,
        answer
      );
      throw err;
    } else {
      logError(err, answer);
    }
  }
};

export const getGoogleDocComments = async (answer, drive) => {
  try {
    const comments = await drive.comments.list({
      fileId: answer.docID,
      fields: "*",
      includeDeleted: false,
    });
    return comments.data;
  } catch (err) {
    if (err?.response?.status == 400) {
      logError(
        `Could not fetch comments for ${answer.docID}: ${err.response?.statusText}`,
        answer
      );
    } else if (err?.response?.status == 403) {
      logError(
        `Permission denied while fetching comments of doc ${answer.docID}`,
        answer
      );
    } else if (err?.response?.status == 429) {
      logError(
        `${err?.response.statusText} while fetching comments of doc ${answer.docID}`,
        answer
      );
      throw err;
    } else {
      logError(err, answer);
    }
  }
};

const folders = {
  "Live on site": "1feloLCiyc3XSxfaQ0L_fqVVsFMupw2JM",
  "In progress": "1U2h3Tte38EkOff9flwo6FKVZn8OhkNLW",
  Answers: "1XUTbO31BMSBBZLhwFsvPObnuMbVVd59H",
};

export const moveAnswer = async (drive, answer) => {
  const folderName = ["Live on site", "Subsection"].includes(
    answer[codaColumnIDs.status]
  )
    ? "Live on site"
    : "In progress";
  const folder = folders[folderName];

  try {
    const file = await drive.files.get({
      fileId: answer.docID,
      fields: "parents",
    });
    const parents = file.data?.parents;
    if (
      !parents ||
      !parents.includes(folder) ||
      parents.includes(folders.Answers)
    ) {
      await drive.files.update({
        fileId: answer.docID,
        addParents: folder,
        removeParents: parents ? parents.join(",") : "",
        fields: "id, parents",
      });
      console.info(
        `Moved "${answer.answerName}" to "${folderName}" Gdocs folder`
      );
    }
  } catch (err) {
    // Don't send these to Discord - they're not critical
    console.log(
      `Error while checking if doc "${answer.answerName}" is in correct folder: ${err}`
    );
    // return true;
  }
  return true;
};
