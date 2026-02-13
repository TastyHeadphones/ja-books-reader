#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const cheerio = require("cheerio");
const { XMLParser } = require("fast-xml-parser");

const BOOKS_DIR = path.resolve(__dirname, "..", "books");
const OUTPUT_PATH = path.resolve(__dirname, "..", "public", "data", "book.json");

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textValue(item);
      if (text) {
        return text;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    if (typeof value["#text"] === "string") {
      return value["#text"].trim();
    }

    for (const nested of Object.values(value)) {
      const text = textValue(nested);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function normalizeZipPath(zipPath) {
  return path.posix.normalize(zipPath).replace(/^\.\/+/, "");
}

function resolveZipPath(baseFilePath, href) {
  const withoutHash = decodeURIComponent(String(href || "").split("#")[0]);
  return normalizeZipPath(path.posix.join(path.posix.dirname(baseFilePath), withoutHash));
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function looksLikeGeneratedTitle(title) {
  return /^part\d+/i.test(title) || /^ch\d+$/i.test(title) || /^id\d+$/i.test(title);
}

function titleFromParagraph(paragraphs) {
  const source = paragraphs.find((paragraph) => paragraph.length >= 6);
  if (!source) {
    return "";
  }

  const shortened = source.slice(0, 22);
  return source.length > 22 ? `${shortened}...` : shortened;
}

function selectDefaultEpub() {
  const epubFile = fs
    .readdirSync(BOOKS_DIR)
    .find((fileName) => fileName.toLowerCase().endsWith(".epub"));

  if (!epubFile) {
    throw new Error(`No .epub file found in ${BOOKS_DIR}`);
  }

  return path.join(BOOKS_DIR, epubFile);
}

function parseTocTitles(ncxXml, ncxPath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true
  });
  const tocDoc = parser.parse(ncxXml);
  const titleMap = new Map();

  function walk(navPointNode) {
    const points = asArray(navPointNode);

    for (const point of points) {
      const src = point?.content?.src;
      const navLabel = textValue(point?.navLabel?.text) || textValue(point?.navLabel);

      if (src) {
        const chapterPath = resolveZipPath(ncxPath, src);
        if (navLabel && !titleMap.has(chapterPath)) {
          titleMap.set(chapterPath, navLabel);
        }
      }

      walk(point?.navPoint);
    }
  }

  walk(tocDoc?.ncx?.navMap?.navPoint);
  return titleMap;
}

function extractBook(epubPath) {
  const zip = new AdmZip(epubPath);
  const entryMap = new Map(
    zip
      .getEntries()
      .map((entry) => [normalizeZipPath(entry.entryName), entry])
  );

  const readZipText = (zipPath) => {
    const normalized = normalizeZipPath(zipPath);
    const entry = entryMap.get(normalized);
    return entry ? entry.getData().toString("utf8") : "";
  };

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true
  });

  const containerXml = readZipText("META-INF/container.xml");
  if (!containerXml) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found");
  }

  const containerDoc = parser.parse(containerXml);
  let rootfile = containerDoc?.container?.rootfiles?.rootfile;
  if (Array.isArray(rootfile)) {
    rootfile = rootfile[0];
  }

  const opfPath = rootfile?.["full-path"];
  if (!opfPath) {
    throw new Error("Invalid EPUB: package rootfile path is missing");
  }

  const opfXml = readZipText(opfPath);
  if (!opfXml) {
    throw new Error(`Invalid EPUB: package file "${opfPath}" not found`);
  }

  const opfDoc = parser.parse(opfXml);
  const pkg = opfDoc?.package || {};
  const metadata = pkg?.metadata || {};
  const manifestItems = asArray(pkg?.manifest?.item);
  const spineItems = asArray(pkg?.spine?.itemref);
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  const tocId = pkg?.spine?.toc;

  let tocTitles = new Map();
  if (tocId && manifestById.has(tocId)) {
    const tocItem = manifestById.get(tocId);
    const tocPath = resolveZipPath(opfPath, tocItem.href);
    const tocXml = readZipText(tocPath);
    if (tocXml) {
      tocTitles = parseTocTitles(tocXml, tocPath);
    }
  }

  const chapters = [];

  for (const itemref of spineItems) {
    const item = manifestById.get(itemref.idref);
    if (!item) {
      continue;
    }

    const mediaType = String(item["media-type"] || "");
    if (!/xhtml|html/i.test(mediaType)) {
      continue;
    }

    const chapterPath = resolveZipPath(opfPath, item.href);
    const chapterHtml = readZipText(chapterPath);
    if (!chapterHtml) {
      continue;
    }

    const $ = cheerio.load(chapterHtml, {
      decodeEntities: false,
      xmlMode: false
    });

    $("rt, rp, script, style, noscript").remove();

    const heading =
      cleanText($("h1").first().text()) ||
      cleanText($("h2").first().text()) ||
      cleanText($("h3").first().text());

    const paragraphs = [];
    $("body p, body li, body blockquote").each((_, element) => {
      const paragraph = cleanText($(element).text());
      if (paragraph) {
        paragraphs.push(paragraph);
      }
    });

    if (paragraphs.length === 0) {
      const fallbackText = cleanText($("body").text());
      if (fallbackText) {
        paragraphs.push(fallbackText);
      }
    }

    const contentLength = paragraphs.reduce((sum, text) => sum + text.length, 0);
    if (contentLength < 24) {
      continue;
    }

    const htmlTitleRaw = cleanText($("head > title").first().text()).replace(
      /\.(xhtml|html)$/i,
      ""
    );
    const htmlTitle = looksLikeGeneratedTitle(htmlTitleRaw) ? "" : htmlTitleRaw;
    const inferredTitle = titleFromParagraph(paragraphs);
    const chapterTitle =
      cleanText(tocTitles.get(chapterPath)) ||
      heading ||
      htmlTitle ||
      inferredTitle ||
      `Section ${chapters.length + 1}`;

    chapters.push({
      id: `chapter-${String(chapters.length + 1).padStart(3, "0")}`,
      title: chapterTitle,
      source: chapterPath,
      paragraphs
    });
  }

  const creators = asArray(metadata["dc:creator"])
    .map((entry) => textValue(entry))
    .filter(Boolean);

  return {
    title: textValue(metadata["dc:title"]) || path.basename(epubPath, ".epub"),
    creators,
    language: textValue(metadata["dc:language"]) || "ja",
    sourceFile: path.basename(epubPath),
    generatedAt: new Date().toISOString(),
    chapterCount: chapters.length,
    chapters
  };
}

function main() {
  const epubArg = process.argv[2];
  const outputArg = process.argv[3];
  const epubPath = epubArg ? path.resolve(epubArg) : selectDefaultEpub();
  const outputPath = outputArg ? path.resolve(outputArg) : OUTPUT_PATH;

  if (!fs.existsSync(epubPath)) {
    throw new Error(`EPUB file not found: ${epubPath}`);
  }

  const book = extractBook(epubPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(book, null, 2), "utf8");

  console.log(`Extracted book: ${book.title}`);
  console.log(`Chapters: ${book.chapterCount}`);
  console.log(`Saved data: ${outputPath}`);
}

main();
