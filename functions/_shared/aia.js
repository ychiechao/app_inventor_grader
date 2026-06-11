import { constants, inflateRawSync } from "node:zlib";

export function filePayload(file, buffer) {
  return {
    name: file.name || "project.aia",
    mimeType: file.type || "application/octet-stream",
    base64: Buffer.from(buffer).toString("base64"),
  };
}

export function summarizeAia(file, buffer, limits = {}) {
  const entries = readZipEntries(Buffer.from(buffer));
  const screens = entries.filter((entry) => entry.name.endsWith(".scm"));
  const blocks = entries.filter((entry) => entry.name.endsWith(".bky"));
  const properties = entries.filter(
    (entry) => entry.name.endsWith(".properties") || entry.name.endsWith("project.properties"),
  );

  const projectText = joinEntries(properties, limits.maxPropertyFiles ?? 4);
  const screenText = joinEntries(screens, limits.maxScreenFiles ?? 8);
  const blockText = joinEntries(blocks, limits.maxBlockFiles ?? 8);

  return [
    `AIA file name: ${file.name}`,
    `AIA file size: ${file.size} bytes`,
    `ZIP entries: ${entries.length}`,
    `Screen (.scm) files: ${screens.map((entry) => entry.name).join(", ") || "none"}`,
    `Blocks (.bky) files: ${blocks.map((entry) => entry.name).join(", ") || "none"}`,
    "",
    "Project properties:",
    limit(projectText || "none", limits.properties ?? 3000),
    "",
    "Screen/component source (.scm):",
    limit(screenText || "none", limits.screens ?? 18000),
    "",
    "Blocks source (.bky XML):",
    limit(blockText || "none", limits.blocks ?? 28000),
  ].join("\n");
}

export function limit(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function joinEntries(entries, maxFiles) {
  return entries
    .slice(0, maxFiles)
    .map((entry) => `--- ${entry.name} ---\n${entry.text}`)
    .join("\n\n");
}

function readZipEntries(buffer) {
  const entries = [];
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("無法讀取 .aia：檔案不是有效的 ZIP 格式");

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end && buffer.readUInt32LE(offset) === 0x02014b50) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (!name.endsWith("/") && isTextEntry(name)) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      const raw = decompress(compressed, method, uncompressedSize);
      entries.push({ name, text: raw.toString("utf8") });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function isTextEntry(name) {
  return [".scm", ".bky", ".properties", ".txt", ".json"].some((extension) => name.endsWith(extension));
}

function decompress(buffer, method, expectedSize) {
  if (method === 0) return buffer;
  if (method === 8) return inflateRawSync(buffer, { finishFlush: constants.Z_SYNC_FLUSH });
  throw new Error(`不支援的 ZIP 壓縮方式：${method} (${expectedSize} bytes)`);
}
