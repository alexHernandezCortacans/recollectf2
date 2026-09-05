// api/functions/dispatch-and-create.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { originConstGlobal, REPO_OWNER_GLOBAL } from "../../consts";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";
import { gzipSync } from "zlib";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const REPO_OWNER = REPO_OWNER_GLOBAL;
const REPO_NAME = "reCollecTF";
const WORKFLOW_FILE_NAME = "update-db-and-create-page.yml";

function b64(str: string): string {
  return Buffer.from(str, "utf8").toString("base64");
}

function b64gzip(str: string): string {
  const compressed = gzipSync(Buffer.from(str, "utf8"));
  return compressed.toString("base64");
}

async function waitUntilFileExists(path: string, timeoutMs = 120000): Promise<void> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=main`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await axios.get(url, {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      });
      return; // trobat, sortim
    } catch (e: any) {
      if (e?.response?.status !== 404) throw e;
    }
    await delay(3000);
  }

  throw new Error(`File not visible in repo after retries: ${path}`);
}

async function getFileSha(path: string): Promise<string | undefined> {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}`,
      { headers: { Authorization: `Bearer ${BOT_TOKEN}`, Accept: "application/vnd.github+json" } }
    );
    return res.data.sha;
  } catch (e: any) {
    if (e?.response?.status === 404) return undefined;
    throw e;
  }
}

async function putFile(path: string, content: string, message: string): Promise<void> {
  const sha = await getFileSha(path);
  await axios.put(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}`,
    {
      message,
      content,
      branch: "main",
      ...(sha ? { sha } : {}),
    },
    { headers: { Authorization: `Bearer ${BOT_TOKEN}`, Accept: "application/vnd.github+json" } }
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "DISPATCH-AND-CREATE" });
  }

  const origin = originConstGlobal;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed." });

  // Auth
  const cookies = parse(req.headers.cookie || "");
  const token = cookies["session_token"];
  if (!token) return res.status(401).json({ error: "No session token" });

  try {
    verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }

  const { inputs, expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

  if (!inputs?.queries) {
    return res.status(400).json({ error: "Missing inputs.queries" });
  }
  if (!expressionId || !/^EXPREG_[a-f0-9A-F]+$/.test(expressionId)) {
    return res.status(400).json({ error: "expressionId inválido o ausente" });
  }
  if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
    return res.status(400).json({ error: "htmlContent ausente o vacío" });
  }

  const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlPath = `pending-sql/${safeTs}.sql`;
  const htmlPath = `pending-html/${expressionId}.html.gz.b64`;

  try {
    // 1) Pujar SQL i HTML simultàniament
    await putFile(sqlPath, b64(inputs.queries), `Add SQL for workflow: ${sqlPath}`);
    await waitUntilFileExists(sqlPath);

    await putFile(htmlPath, b64gzip(htmlContent), `Add HTML for: ${expressionId}`);
    await waitUntilFileExists(htmlPath);

    // Espera que tots dos siguin visibles abans de disparar el workflow
    // 2) Disparar el workflow un sol cop quan tots dos fitxers estan al repo
    await axios.post(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`,
      {
        ref: "main",
        inputs: {
          sql_path: sqlPath,
          expression_id: expressionId,
          expressionInfo: String(expressionInfo),
          uniprot_accession: uniprotAccession || "",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err?.message || "Unknown error" };
    console.error("DISPATCH-AND-CREATE ERROR:", status, data);
    return res.status(status).json({ error: "DISPATCH-AND-CREATE ERROR", details: data });
  }

  return res.status(200).json({
    message: "Workflow dispatched",
    sql_path: sqlPath,
    expression_id: expressionId,
  });
}