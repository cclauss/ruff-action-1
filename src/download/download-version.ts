import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { OWNER, REPO, TOOL_CACHE_NAME } from "../utils/constants";
import type { Architecture, Platform } from "../utils/platforms";
import { validateChecksum } from "./checksum/checksum";
import * as github from "@actions/github";

export function tryGetFromToolCache(
  arch: Architecture,
  version: string,
): { version: string; installedPath: string | undefined } {
  core.debug(`Trying to get ruff from tool cache for ${version}...`);
  const cachedVersions = tc.findAllVersions(TOOL_CACHE_NAME, arch);
  core.debug(`Cached versions: ${cachedVersions}`);
  let resolvedVersion = tc.evaluateVersions(cachedVersions, version);
  if (resolvedVersion === "") {
    resolvedVersion = version;
  }
  const installedPath = tc.find(TOOL_CACHE_NAME, resolvedVersion, arch);
  return { version: resolvedVersion, installedPath };
}

export async function downloadVersion(
  platform: Platform,
  arch: Architecture,
  version: string,
  checkSum: string | undefined,
  githubToken: string,
): Promise<{ version: string; cachedToolDir: string }> {
  const resolvedVersion = await resolveVersion(version, githubToken);
  const artifact = `ruff-${arch}-${platform}`;
  let extension = ".tar.gz";
  if (platform === "pc-windows-msvc") {
    extension = ".zip";
  }
  const downloadUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${resolvedVersion}/${artifact}${extension}`;
  core.info(`Downloading ruff from "${downloadUrl}" ...`);

  const downloadPath = await tc.downloadTool(
    downloadUrl,
    undefined,
    githubToken,
  );
  await validateChecksum(
    checkSum,
    downloadPath,
    arch,
    platform,
    resolvedVersion,
  );

  let ruffDir: string;
  if (platform === "pc-windows-msvc") {
    const fullPathWithExtension = `${downloadPath}${extension}`;
    await fs.copyFile(downloadPath, fullPathWithExtension);
    ruffDir = await tc.extractZip(fullPathWithExtension);
    // On windows extracting the zip does not create an intermediate directory
  } else {
    const extractedDir = await tc.extractTar(downloadPath);
    ruffDir = path.join(extractedDir, artifact);
  }
  const cachedToolDir = await tc.cacheDir(
    ruffDir,
    TOOL_CACHE_NAME,
    resolvedVersion,
    arch,
  );
  return { version: resolvedVersion, cachedToolDir };
}

export async function resolveVersion(
  versionInput: string,
  githubToken: string,
): Promise<string> {
  const version =
    versionInput === "latest"
      ? await getLatestVersion(githubToken)
      : versionInput;
  if (tc.isExplicitVersion(version)) {
    core.debug(`Version ${version} is an explicit version.`);
    return version;
  }
  const availableVersions = await getAvailableVersions(githubToken);
  const resolvedVersion = tc.evaluateVersions(availableVersions, version);
  if (resolvedVersion === "") {
    throw new Error(`No version found for ${version}`);
  }
  return resolvedVersion;
}

async function getAvailableVersions(githubToken: string): Promise<string[]> {
  const octokit = github.getOctokit(githubToken);

  const response = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner: OWNER,
    repo: REPO,
  });
  return response.map((release) => release.tag_name);
}

async function getLatestVersion(githubToken: string) {
  const octokit = github.getOctokit(githubToken);

  const { data: latestRelease } = await octokit.rest.repos.getLatestRelease({
    owner: OWNER,
    repo: REPO,
  });

  if (!latestRelease) {
    throw new Error("Could not determine latest release.");
  }
  return latestRelease.tag_name;
}
