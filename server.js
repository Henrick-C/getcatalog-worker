import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import archiver from "archiver";
import { runCrawl } from "./crawler.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Render define PORT automaticamente
const PORT = process.env.PORT || 3000;

// token opcional (se não definir, aceita sem auth)
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

// pasta temporária (Render permite /tmp)
const BASE_DIR = "/tmp/getcatalog";
fs.mkdirSync(BASE_DIR, { recursive: true });

/* =========================
   HEALTH CHECK
========================= */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   AUTH MIDDLEWARE
========================= */
function auth(req, res, next) {
  if (!WORKER_TOKEN) return next(); // sem token = liberado

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (token !== WORKER_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

/* =========================
   CRAWL ENDPOINT
========================= */
app.post("/crawl", auth, async (req, res) => {
  try {
    const {
      url,
      username,
      password,
      max_items = 500,
      delay_ms = 800
    } = req.body || {};

    if (!url) {
      return res.status(400).json({ error: "Missing url" });
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(BASE_DIR, jobId);
    const imgDir = path.join(jobDir, "imagens");

    fs.mkdirSync(imgDir, { recursive: true });

    const csvPath = path.join(jobDir, "produtos.csv");
    const zipPath = path.join(jobDir, "output.zip");

    console.log(`Starting crawl job ${jobId}`);
    console.log(`URL: ${url}`);

    const result = await runCrawl({
      url,
      username,
      password,
      maxItems: Number(max_items),
      delayMs: Number(delay_ms),
      csvPath,
      imgDir
    });

    /* =========================
       CREATE ZIP (CSV + IMAGES)
    ========================= */
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", {
        zlib: { level: 9 }
      });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      archive.file(csvPath, { name: "produtos.csv" });
      archive.directory(imgDir, "imagens");
      archive.finalize();
    });

    console.log(`Job ${jobId} finished: ${result.totalItems} items`);

    res.json({
      status: "success",
      total_items: result.totalItems,
      csv_url: `/download/${jobId}/produtos.csv`,
      zip_url: `/download/${jobId}/output.zip`
    });
  } catch (err) {
    console.error("Crawl error:", err);
    res.status(500).json({
      error: String(err?.message || err)
    });
  }
});

/* =========================
   DOWNLOAD FILES
========================= */
app.get("/download/:jobId/:file", (req, res) => {
  const { jobId, file } = req.params;

  const filePath = path.join(BASE_DIR, jobId, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found");
  }

  res.download(filePath);
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Worker running on ${PORT}`);
});
