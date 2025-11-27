// --- LOAD ENV FIRST ---
import "dotenv/config"; // ✅ Must be first line
import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import pkgSupabase from "@supabase/supabase-js";
import { SupabaseStore } from "./supabaseStore.js"; 

const { Client, RemoteAuth } = pkg;
const { createClient } = pkgSupabase;

// --- ENV CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || "whatsapp-sessions";
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || "render-bot-478";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Supabase URL/KEY missing");
  process.exit(1);
}

// --- Supabase client + Store ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const store = new SupabaseStore(supabase, BUCKET_NAME);

// --- WhatsApp client ---
const client = new Client({
  sessionData: { skipMediaDownload: true },
  authStrategy: new RemoteAuth({
    clientId: CLIENT_ID,
    store,
    backupSyncIntervalMs: 24 * 60 * 60 * 1000, 
    syncFullHistory: false, 
  }),
  puppeteer: {
    headless: true,
    // Minimal, essential arguments for low-resource environments
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-translate",
      "--disable-sync",
      "--disable-software-rasterizer", // Further resource reduction
      "--disable-web-security",        // Can sometimes reduce overhead
    ],
  },
});

// --- Events ---
client.on("qr", (qr) => {
  console.log("📲 QR RECEIVED - scan to login:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log(`✅ WhatsApp ready: ${client.info?.me?.user || "?"}`);
});

client.on("authenticated", () => console.log("🔐 Authenticated!"));
client.on("auth_failure", (msg) => console.error("⚠️ Auth failure:", msg));
client.on("disconnected", (reason) =>
  console.warn("⚠️ Disconnected:", reason)
);

// --- Track bot startup (COOLDOWN LOGIC RETAINED) ---
const botStartTime = Date.now();
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cool-off

// --- Handle incoming messages ---
client.on("message", async (msg) => {
  // 1. Ignore old messages (sent before bot started)
  if (msg.timestamp * 1000 < botStartTime) {
    return;
  }

  // 2. Ignore all messages during initial cool-off period
  if (Date.now() - botStartTime < COOLDOWN_MS) {
    return;
  }

  // 3. Ignore status broadcasts and non-text
  if (msg.from === "status@broadcast") return;
  if (msg.type !== "chat" || !msg.body?.trim()) return;

  console.log(`📩 ${msg.from}: ${msg.body.substring(0, 30)}...`);

  if (!N8N_WEBHOOK_URL) return;

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: msg.from, message: msg.body }),
    });

    let replyData;
    try {
      replyData = await res.json();
    } catch {
      replyData = {};
    }

    if (Array.isArray(replyData)) replyData = replyData[0];
    const replyText = replyData?.Reply || replyData?.reply;

    if (replyText) {
      await client.sendMessage(msg.from, replyText);
      console.log("💬 Sent reply:", String(replyText).substring(0, 30));
    }
  } catch (err) {
    console.error("❌ n8n webhook error:", err.message);
  }
});

// --- Start bot ---
client.initialize();

// --- Tiny web server (Render health checks) ---
const app = express();
app.get("/", (req, res) => res.send("✅ WhatsApp bot is running"));
app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));