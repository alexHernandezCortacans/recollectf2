import { VercelRequest, VercelResponse } from "@vercel/node";
import { originConstGlobal, REPO_OWNER_GLOBAL } from "../../consts";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const REPO_OWNER = REPO_OWNER_GLOBAL;
const REPO_NAME = "reCollecTF";
const WORKFLOW_FILE_NAME = "update-db-and-create-page.yml";

async function createBlob(content: string): Promise<string> {
  const res = await axios.post(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
    {
      content,
      encoding: "utf-8",
    },
    {
      headers: {
        Authorization: `Bearer ${BOT_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  return res.data.sha;
}

async function pushMultipleFiles(
  files: { path: string; content?: string; sha?: string }[],
  message: string
): Promise<void> {
  const baseUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

  const headers = {
    Authorization: `Bearer ${BOT_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  const refRes = await axios.get(
    `${baseUrl}/git/ref/heads/main`,
    { headers }
  );

  const headSha = refRes.data.object.sha;

  const commitRes = await axios.get(
    `${baseUrl}/git/commits/${headSha}`,
    { headers }
  );

  const treeSha = commitRes.data.tree.sha;

  const treeRes = await axios.post(
    `${baseUrl}/git/trees`,
    {
      base_tree: treeSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        ...(file.sha
          ? { sha: file.sha }
          : { content: file.content }),
      })),
    },
    { headers }
  );

  const newCommitRes = await axios.post(
    `${baseUrl}/git/commits`,
    {
      message,
      tree: treeRes.data.sha,
      parents: [headSha],
    },
    { headers }
  );

  await axios.patch(
    `${baseUrl}/git/refs/heads/main`,
    {
      sha: newCommitRes.data.sha,
      force: false,
    },
    { headers }
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === "GET") {
    return res.status(200).json({
      whoami: "DISPATCH-AND-CREATE",
    });
  }

  const origin = originConstGlobal;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST allowed.",
    });
  }

  const cookies = parse(req.headers.cookie || "");
  const token = cookies["session_token"];

  if (!token) {
    return res.status(401).json({
      error: "No session token",
    });
  }

  try {
    verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({
      error: "Invalid session",
    });
  }

  const {
    inputs,
    expressionId,
    htmlContent,
    expressionInfo,
    uniprotAccession,
  } = req.body || {};

  if (!inputs?.queries) {
    return res.status(400).json({
      error: "Missing inputs.queries",
    });
  }

  if (
    !expressionId ||
    !/^EXPREG_[a-f0-9A-F]+$/.test(expressionId)
  ) {
    return res.status(400).json({
      error: "expressionId inválido o ausente",
    });
  }

  if (
    !htmlContent ||
    typeof htmlContent !== "string" ||
    !htmlContent.trim()
  ) {
    return res.status(400).json({
      error: "htmlContent ausente o vacío",
    });
  }

  const safeTs = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const sqlPath = `pending-sql/${safeTs}.sql`;
  const htmlPath = `pending-html/${expressionId}.html`;

  try {
    // El HTML llega como texto plano.
    // Se crea un Blob explícitamente para poder referenciarlo
    // mediante su SHA desde el Git Tree.
    const htmlBlobSha = await createBlob(htmlContent);

    await pushMultipleFiles(
      [
        {
          path: sqlPath,
          content: inputs.queries,
        },
        {
          path: htmlPath,
          sha: htmlBlobSha,
        },
      ],
      `Add SQL and HTML for: ${expressionId}`
    );

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
    const data =
      err?.response?.data || {
        message: err?.message || "Unknown error",
      };

    console.error(
      "DISPATCH-AND-CREATE ERROR:",
      status,
      data
    );

    return res.status(status).json({
      error: "DISPATCH-AND-CREATE ERROR",
      details: data,
    });
  }

  return res.status(200).json({
    message: "Workflow dispatched",
    sql_path: sqlPath,
    expression_id: expressionId,
  });
}