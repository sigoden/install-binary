import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { isBinaryFile } from "isbinaryfile";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { throttling } from "@octokit/plugin-throttling";

const ThrottlingOctokit = GitHub.plugin(throttling);

async function run() {
  try {
    const token = process.env["GITHUB_TOKEN"] || core.getInput("token");
    const octokit = new ThrottlingOctokit({
      throttle: {
        onRateLimit: (retryAfter, options) => {
          core.warning(
            `RateLimit detected for request ${options.method} ${options.url}.`,
          );
          core.info(`Retrying after ${retryAfter} seconds.`);
          return true;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          core.warning(
            `SecondaryRateLimit detected for request ${options.method} ${options.url}.`,
          );
          core.info(`Retrying after ${retryAfter} seconds.`);
          return true;
        },
      },
      ...getOctokitOptions(token),
    });

    const project = core.getInput("repo");
    if (!project) {
      throw new Error("Repo was not specified");
    }

    const [owner, repo] = project.split("/");

    let tag = core.getInput("tag");
    let release: RestEndpointMethodTypes["repos"]["getLatestRelease"]["response"];
    if (!tag || tag == "latest") {
      release = await octokit.rest.repos.getLatestRelease({
        owner,
        repo,
      });
      tag = release.data.tag_name;
    } else {
      release = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag,
      });
    }

    const cmdName = core.getInput("name") || repo;

    const osArch = os.arch();
    let isWin = false;
    let osPlatform = "";
    switch (os.platform()) {
      case "linux":
        osPlatform = "linux";
        break;
      case "darwin":
        osPlatform = "macos";
        break;
      case "win32":
        isWin = true;
        osPlatform = "windows";
        break;
      default:
        core.setFailed(
          "Unsupported operating system - this action is only released for Linux, Windows and macOS",
        );
        return;
    }

    const installDir = path.join(
      getCacheDirectory(),
      owner,
      repo,
      tag,
      `${osPlatform}-${osArch}`,
    );
    core.info(`==> Binaries will be located at: ${installDir}`);
    await fs.promises.mkdir(installDir, { recursive: true });

    const withCache = core.getInput("cache") === "true";
    const cacheKey = `install-binary/${owner}/${repo}/${tag}/${osPlatform}-${osArch}`;
    if (withCache) {
      const ok = await cache.restoreCache([installDir], cacheKey);
      if (ok !== undefined) {
        core.info(`Found ${repo} in the cache: ${installDir}`);
        core.info(`Adding ${installDir} to the path`);
        core.addPath(installDir);
        return;
      }
    } else {
      core.info(`Cache disabled`);
    }

    const assetName = selectAsset(
      release.data.assets.filter((v) => v.size > 1024 * 10).map((v) => v.name),
      cmdName,
      osPlatform,
      osArch,
    );
    if (!assetName) {
      const found = release.data.assets.map((f) => f.name);
      throw new Error(`Failed to find release for ${tag}. Found: ${found}`);
    }

    const downloadUrl = release.data.assets.find(
      (v) => v.name == assetName,
    )?.browser_download_url;
    if (!downloadUrl) {
      throw new Error(`Failed to find download url for ${assetName}`);
    }

    const tempDir = path.join(os.tmpdir(), "install-binary", cmdName);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const assetFile = path.join(tempDir, assetName);

    core.info(`Downloading ${repo} from ${downloadUrl}`);
    await tc.downloadTool(downloadUrl, assetFile, `token ${token}`, {
      accept: "application/octet-stream",
    });

    let binName = cmdName;
    if (isWin) {
      binName += ".exe";
    }

    let originBinFile;
    if (/\.(gz|tgz|bz2|zip)/.test(assetFile)) {
      core.info(`Uncompressing asset file ${assetFile}`);
      const uncompressDir = path.join(tempDir, "uncompress");
      try {
        if (/\.(gz|tgz|bz2)$/.test(assetFile)) {
          await tc.extractTar(assetFile, uncompressDir);
        } else if (assetFile.endsWith(".bz2")) {
          await tc.extractTar(assetFile, uncompressDir, "xj");
        } else if (assetFile.endsWith(".zip")) {
          await tc.extractZip(assetFile, uncompressDir);
        }
      } catch (err) {
        throw new Error(
          `Failed to extract ${assetFile} to ${uncompressDir}, error: ${err}`,
        );
      }
      const files = await listFiles(uncompressDir);
      originBinFile = await findBinFile(files, binName);
      if (!originBinFile) {
        const filePaths = files.map((v) => v.path);
        throw new Error(
          `No binary found in ${uncompressDir}. check files: ${filePaths}`,
        );
      }
    } else {
      core.info(`Identify binary file ${assetFile}`);
      originBinFile = assetFile;
    }

    const binFile = path.join(installDir, binName);

    await fs.promises.copyFile(originBinFile, binFile);
    if (!isWin) {
      await fs.promises.chmod(binFile, 0o755);
    }

    core.info(`Successfully installed binary ${binFile}`);

    if (withCache) {
      try {
        await cache.saveCache([installDir], cacheKey);
      } catch (error) {
        const typedError = error as Error;
        if (typedError.name === cache.ValidationError.name) {
          throw error;
        } else if (typedError.name === cache.ReserveCacheError.name) {
          core.info(typedError.message);
        } else {
          core.warning(typedError.message);
        }
      }
    }

    core.info(`Adding ${installDir} to the path`);
    core.addPath(installDir);
    core.info(`Successfully installed ${repo}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("catastrophic failure, please file an issue");
    }
  }
}

function selectAsset(
  assets: string[],
  binName: string,
  osPlatform: string,
  osArch: string,
): string | undefined {
  const osWords: { [key: string]: string[] } = {
    linux: ["linux", "linux-musl", "unknown-linux"],
    windows: ["windows", "pc-windows", "win"],
    macos: ["darwin", "apple-darwin", "macos", "osx"],
  };

  const archWords: { [key: string]: string[] } = {
    x64: ["x86_64", "x64", "amd64", "amd_64"],
    ia32: ["i686", "x32", "amd32", "amd_32"],
    arm64: ["aarch64", "aarch_64", "arm64", "arm_64"],
  };

  if (!(osPlatform in osWords) || !(osArch in archWords)) {
    throw new Error(`Unsupported OS/Arch: ${osPlatform}/${osArch}`);
  }

  const targetWords: string[] = [];
  for (const osWord of osWords[osPlatform]) {
    for (const archWord of archWords[osArch]) {
      targetWords.push(
        `${osWord}-${archWord}`,
        `${osWord}_${archWord}`,
        `${osWord}${archWord}`,
        `${osWord}.${archWord}`,
        `${archWord}-${osWord}`,
        `${archWord}_${osWord}`,
        `${archWord}${osWord}`,
        `${archWord}.${osWord}`,
      );
    }
  }

  const reTarget = new RegExp(
    `[^A-Za-z0-9](${targetWords.join("|")})(.*\\.(gz|tgz|bz2|zip|exe)|([^.]*))$`,
    "i",
  );

  let list: string[] = assets
    .filter((name) => reTarget.test(name))
    .filter((name) => !/\.(rpm|deb|dmg|flatpak|msi)$/.test(name));

  if (list.length === 0) {
    const targetWords: string[] = [];
    let archWord = "";
    if (osArch == "x64") {
      archWord = "64";
    } else if (osArch == "ia32") {
      archWord = "32";
    }
    if (archWord) {
      for (const osWord of osWords[osPlatform]) {
        targetWords.push(
          `${osWord}-${archWord}`,
          `${osWord}_${archWord}`,
          `${osWord}${archWord}`,
          `${archWord}-${osWord}`,
          `${archWord}_${osWord}`,
        );
      }
      const reTarget = new RegExp(
        `[^A-Za-z0-9](${targetWords.join("|")})(.*\\.(gz|tgz|bz2|zip|exe)|([^.]*))$`,
        "i",
      );
      list.push(...assets.filter((name) => reTarget.test(name)));
    }
  }

  if (list.length === 1) {
    return list[0];
  } else if (list.length > 1) {
    const strictList = list.filter((v) => v.includes(binName));
    if (strictList.length === 1) {
      return strictList[0];
    } else if (strictList.length > 1) {
      list = strictList;
    }
    list.sort();
    if (list.length === 2) {
      if (list[0].includes("linux-gnu") && list[1].includes("linux-musl")) {
        return list[1];
      }
      if (list[0].endsWith(".tar.gz") && list[1].endsWith(".zip")) {
        if (osPlatform == "windows") {
          return list[1];
        } else {
          return list[0];
        }
      }
    }
  }
}

interface FileObj {
  path: string;
  size: number;
}

async function findBinFile(files: FileObj[], binName: string) {
  if (files.length == 1) {
    return files[0].path;
  } else if (files.length > 1) {
    files.sort((a, b) => b.size - a.size);
    if (binName) {
      const file = files.find((file) => path.basename(file.path) === binName);
      if (file) {
        return file.path;
      }
    }
    return files[0].path;
  }
}

async function listFiles(dirPath) {
  const files: FileObj[] = [];

  async function readDir(currentPath) {
    const entries = await fs.promises.readdir(currentPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await readDir(fullPath);
      } else {
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > 100 * 1024) {
          if (await isBinaryFile(fullPath)) {
            files.push({ path: fullPath, size: stat.size });
          }
        }
      }
    }
  }

  await readDir(dirPath);
  return files;
}

function getCacheDirectory() {
  const cacheDirectory = process.env["RUNNER_TOOL_CACHE"] || "";
  if (cacheDirectory === "") {
    core.warning("Expected RUNNER_TOOL_CACHE to be defined");
  }
  return cacheDirectory;
}

run();
