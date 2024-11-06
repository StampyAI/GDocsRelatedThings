import express from "express";
import { getDocsClient, getGoogleDoc } from "./parser/gdrive.js";

const app = express();
const PORT = 3000;

// NOTE: Need credentials.json file in root to query Gdocs aPI
app.get("/doc/", async (req, res) => {
  try {
    const client = await getDocsClient();
    const answer = { docID: "10g6U9SL0CBy__wCBTib7_WhB3S3aaFt7Fx1vVgCzg2I" };
    const doc = await getGoogleDoc(answer, client);
    const jsonString = JSON.stringify(doc, null, 2);
    res.json(jsonString);
  } catch (error) {
    console.error("An error occurred:", error);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
