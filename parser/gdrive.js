import { google } from "googleapis";
import { JWT } from "google-auth-library";
import fs from "fs";
import { codaColumnIDs } from "./constants.js";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

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

const folders = {
  "Live on site": "1feloLCiyc3XSxfaQ0L_fqVVsFMupw2JM",
  "In progress": "1U2h3Tte38EkOff9flwo6FKVZn8OhkNLW",
  Answers: "1XUTbO31BMSBBZLhwFsvPObnuMbVVd59H",
};

export const moveAnswer = async (drive, answer) => {
  const folderName =
    answer[codaColumnIDs.status] == "Live on site"
      ? "Live on site"
      : "In progress";
  const folder = folders[folderName];

  try {
    const file = await drive.files.get({
      fileId: answer.docID,
      fields: "parents",
    });
    const { parents } = file.data;
    if (!parents.includes(folder) || parents.includes(folders.Answers)) {
      await drive.files.update({
        fileId: answer.docID,
        addParents: folder,
        removeParents: parents.join(","),
        fields: "id, parents",
      });
      console.info(
        `Moved "${answer.answerName}" to "${folderName}" Gdocs folder`
      );
    }
  } catch (err) {
    console.error(
      `Error while checking if doc "${answer.answerName}" is in correct folder: ${err}`
    );
  }
};
