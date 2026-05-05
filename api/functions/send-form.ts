import { VercelRequest, VercelResponse } from "@vercel/node";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;

const REPO_OWNER = "ErillLab";
const REPO_NAME = "reCollecTF";
const WORKFLOW_FILE_NAME = "update-db.yml";

function b64(str: string) {
  return Buffer.from(str, "utf8").toString("base64");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntilFileExists(sqlPath: string) {
  // Espera hasta ~5s a que el archivo sea visible en la API (eventual consistency)
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(sqlPath)}?ref=main`;

  for (let i = 0; i < 10; i++) {
    try {
      await axios.get(url, {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      });
      return; // existe
    } catch (e: any) {
      const status = e?.response?.status;
      if (status !== 404) {
        throw e; // si es otro error, lo propagamos
      }
      await sleep(500);
    }
  }

  throw new Error(`SQL file not visible yet in repo after retries: ${sqlPath}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Debug
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "SEND-FORM MIGUEL." });
  }

  // CORS
  const origin = "https://erilllab.github.io";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed." });

  // Auth cookie
  const cookies = parse(req.headers.cookie || "");
  const token = cookies["session_token"];
  if (!token) return res.status(401).json({ error: "No session token" });

  try {
    verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }

  // SQL
  const { inputs } = req.body || {};
  const sqlString = String(inputs?.queries || "");
  if (!sqlString.trim()) {
    return res.status(400).json({ error: "Missing inputs.queries (SQL string)" });
  }

  const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlPath = `pending-sql/${safeTs}.sql`;

  try {
    // 1) Create SQL file in repo
    const putResp = await axios.put(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(sqlPath)}`,
      {
        message: `Add SQL for workflow: ${sqlPath}`,
        content: b64(sqlString),
        branch: "main",
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    // 2) Esperar a que GitHub "vea" el archivo en main
    await waitUntilFileExists(sqlPath);

    // 3) Dispatch workflow (ref = main)
    await axios.post(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`,
      {
        ref: "main",
        inputs: {
          sql_path: sqlPath,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    return res.status(200).json({
      message: "Workflow dispatched",
      sql_path: sqlPath,
      sql_commit_url: putResp.data?.commit?.html_url || null,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err?.message || "Unknown error" };
    console.error("SEND-FORM ERROR:", status, data);
    return res.status(status).json({ error: "SEND-FORM ERROR", details: data });
  }
}
