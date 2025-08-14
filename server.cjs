// server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
require("dotenv").config(); // Load environment variables from .env

// ✅ Start-up log
console.log("🚩 server.js is starting...");

// ✅ Firebase Admin Setup
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ SendGrid Setup
if (!process.env.SENDGRID_API_KEY) {
  console.error("❌ SENDGRID_API_KEY not set.");
  process.exit(1);
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ✅ Express App Setup
const app = express();
const PORT = 5001;

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ✅ Token verification middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided." });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("❌ Invalid token:", error);
    return res.status(403).json({ error: "Forbidden: Invalid token." });
  }
};
app.get("/trackOpen/:quoteId", async (req, res) => {
  const quoteId = req.params.quoteId;
  const docRef = db.collection("quotes").doc(quoteId);

  try {
    await docRef.update({
      viewed: true,
      viewedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`👁️ Quote ${quoteId} was opened!`);

    // TODO: Emit socket or push notification here

    // Return a 1x1 transparent GIF
    const pixel = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64"
    );
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": pixel.length,
    });
    res.end(pixel);
  } catch (err) {
    console.error("❌ Failed to track open:", err);
    res.sendStatus(500);
  }
});

// ✅ Status check
app.get("/", (req, res) => {
  res.send("✅ Valdicass SendGrid Server is running!");
});
// ✅ Mark quote as viewed
app.post("/quoteViewed", async (req, res) => {
  const { quoteId } = req.body;
  if (!quoteId) return res.status(400).json({ error: "Missing quoteId" });

  try {
    const docRef = db.collection("quotes").doc(quoteId);
    await docRef.update({
      viewed: true,
      viewedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`👁️ Quote ${quoteId} marked as viewed`);

    // ✅ TODO: Notify client via WebSocket or push notification (next step)
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error marking quote viewed:", err);
    res.status(500).json({ error: "Failed to mark quote as viewed" });
  }
});

// ✅ Protected route
app.post("/sendQuoteEmail", verifyFirebaseToken, async (req, res) => {
  const { quoteId, clientEmail } = req.body;
  console.log("📨 /sendQuoteEmail hit with:", { quoteId, clientEmail });

  if (!quoteId || !clientEmail) {
    return res.status(400).json({ error: "Missing quoteId or clientEmail." });
  }

  try {
    const docRef = db.collection("quotes").doc(quoteId.trim());
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Quote not found." });
    }

    const quote = docSnap.data();
    const quoteCreator = quote.createdBy || quote.userId;

    console.log("🔐 Firebase decoded token UID:", req.user.uid);
    console.log("🧪 Firestore quoteCreator (createdBy or userId):", quoteCreator);

    if (String(quoteCreator).trim() !== String(req.user.uid).trim()) {
      console.warn("⛔ Unauthorized send attempt (mismatch).");
      return res.status(403).json({ error: "You do not have permission to send this quote." });
    }

    const msg = {
      to: clientEmail,
      from: "walter@valdicass.com", // ✅ Must be verified in SendGrid
      subject: "Your Valdicass Quote is Ready",
      text: `Quote Total: $${quote.total}`,
      html: `
  <strong>Your quote total is $${quote.total}</strong><br />
  <img src="http://localhost:5001/sendQuoteEmail/trackOpen/${quoteId}" alt="" width="1" height="1" style="display:none;" />
`,
    };

    await sgMail.send(msg);
    console.log(`✅ Email successfully sent to ${clientEmail} for quote ${quoteId}`);
    res.json({ success: true, message: "Quote sent successfully." });

  } catch (error) {
    if (error.response) {
      console.error("❌ SendGrid Response Error:", error.response.body);
    } else {
      console.error("❌ Unknown Error:", error);
    }
    res.status(500).json({ error: "Failed to send quote." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Valdicass SendGrid server running on port ${PORT}`);
});
