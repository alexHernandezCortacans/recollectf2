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

async function pushMultipleFiles(files: { path: string; content: string }[], message: string): Promise<void> {
  const baseUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
  const headers = { Authorization: `Bearer ${BOT_TOKEN}`, Accept: "application/vnd.github+json" };

  // 1) Obtenir el SHA del HEAD de main
  const refRes = await axios.get(`${baseUrl}/git/ref/heads/main`, { headers });
  const headSha = refRes.data.object.sha;

  // 2) Obtenir el tree del commit actual
  const commitRes = await axios.get(`${baseUrl}/git/commits/${headSha}`, { headers });
  const treeSha = commitRes.data.tree.sha;

  // 3) Crear un nou tree amb tots els fitxers
  const treeRes = await axios.post(`${baseUrl}/git/trees`, {
    base_tree: treeSha,
    tree: files.map(f => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      content: f.content,
    })),
  }, { headers });

  // 4) Crear el commit
  const newCommitRes = await axios.post(`${baseUrl}/git/commits`, {
    message,
    tree: treeRes.data.sha,
    parents: [headSha],
  }, { headers });

  // 5) Actualitzar la referència de main
  await axios.patch(`${baseUrl}/git/refs/heads/main`, {
    sha: newCommitRes.data.sha,
    force: false,
  }, { headers });
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
  const htmlPath = `pending-html/${expressionId}.html.gz`;

  try {
    // 1) Crear el blob de l'HTML (binari, necessita base64)
    const blobRes = await axios.post(
      `${baseUrl}/git/blobs`,
      { content: b64gzip(htmlContent), encoding: "base64" },
      { headers }
    );

    // 2) Pujar tots dos en un sol commit
    const refRes = await axios.get(`${baseUrl}/git/ref/heads/main`, { headers });
    const headSha = refRes.data.object.sha;
    const commitRes = await axios.get(`${baseUrl}/git/commits/${headSha}`, { headers });

    const treeRes = await axios.post(`${baseUrl}/git/trees`, {
      base_tree: commitRes.data.tree.sha,
      tree: [
        {
          path: sqlPath,
          mode: "100644",
          type: "blob",
          content: inputs.queries,  // ← SQL en text pla
        },
        {
          path: htmlPath,
          mode: "100644",
          type: "blob",
          sha: blobRes.data.sha,    // ← HTML com a blob binari
        },
      ],
    }, { headers });

    const newCommitRes = await axios.post(`${baseUrl}/git/commits`, {
      message: `Add SQL and HTML for: ${expressionId}`,
      tree: treeRes.data.sha,
      parents: [headSha],
    }, { headers });

    await axios.patch(`${baseUrl}/git/refs/heads/main`, {
      sha: newCommitRes.data.sha,
      force: false,
    }, { headers });

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