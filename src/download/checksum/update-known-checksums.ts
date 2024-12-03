import { promises as fs } from "node:fs";
import * as tc from "@actions/tool-cache";
import { KNOWN_CHECKSUMS } from "./known-checksums";
export async function updateChecksums(
  filePath: string,
  downloadUrls: string[],
): Promise<void> {
  await fs.rm(filePath);
  await fs.appendFile(
    filePath,
    "// AUTOGENERATED_DO_NOT_EDIT\nexport const KNOWN_CHECKSUMS: { [key: string]: string } = {\n",
  );
  let firstLine = true;
  for (const downloadUrl of downloadUrls) {
    const key = getKey(downloadUrl);
    if (key === undefined) {
      continue;
    }
    const checksum = await getOrDownloadChecksum(key, downloadUrl);
    if (!firstLine) {
      await fs.appendFile(filePath, ",\n");
    }
    await fs.appendFile(filePath, `  "${key}":\n    "${checksum}"`);
    firstLine = false;
  }
  await fs.appendFile(filePath, ",\n};\n");
}

function getKey(downloadUrl: string): string | undefined {
  const parts = downloadUrl.split("/");
  const version = parts[parts.length - 2].replace("v", "");
  const fileName = parts[parts.length - 1];
  if (fileName.startsWith("source")) {
    return undefined;
  }
  if (fileName.includes(version)) {
    // https://github.com/astral-sh/ruff/releases/download/v0.4.10/ruff-0.4.10-aarch64-apple-darwin.tar.gz.sha256
    const name = fileName.split(version)[1].split(".")[0].substring(1);
    return `${name}-${version}`;
  }
  // https://github.com/astral-sh/ruff/releases/download/v0.1.7/ruff-aarch64-apple-darwin.tar.gz.sha256
  // or
  // https://github.com/astral-sh/ruff/releases/download/0.8.0/ruff-aarch64-apple-darwin.tar.gz.sha256
  const name = fileName.split(".")[0].split("ruff-")[1];
  return `${name}-${version}`;
}

async function getOrDownloadChecksum(
  key: string,
  downloadUrl: string,
): Promise<string> {
  let checksum: string;
  if (key in KNOWN_CHECKSUMS) {
    checksum = KNOWN_CHECKSUMS[key];
  } else {
    const content = await downloadAssetContent(downloadUrl);
    checksum = content.split(" ")[0].trim();
  }
  return checksum;
}

async function downloadAssetContent(downloadUrl: string): Promise<string> {
  const downloadPath = await tc.downloadTool(downloadUrl);
  return await fs.readFile(downloadPath, "utf8");
}