import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { ValidationError } from "./errors.js";

/** Create a structurally valid but empty PPTX with `slideCount` slides. */
export function createMinimalPptx(path: string, slideCount: number): void {
  slideCount = Math.max(1, Math.floor(slideCount));
  mkdirSync(dirname(path), { recursive: true });

  const overrides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    overrides +
    "</Types>";

  const presentation =
    '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>';
  const slide =
    '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>';

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "ppt/presentation.xml": strToU8(presentation),
  };
  for (let i = 1; i <= slideCount; i++) {
    files[`ppt/slides/slide${i}.xml`] = strToU8(slide);
  }

  writeFileSync(path, zipSync(files, { level: 6 }));
}

export interface PptxValidation {
  path: string;
  slides: number;
  sha256: string;
}

/** Validate a PPTX's ZIP structure, required entries, and minimum slide count. */
export function validatePptx(path: string, minSlides = 1): PptxValidation {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new ValidationError(`PPTX is missing or empty: ${path}`);
  }
  let names: string[];
  try {
    names = Object.keys(unzipSync(readFileSync(path)));
  } catch {
    throw new ValidationError(`invalid PPTX zip: ${path}`);
  }
  const required = ["[Content_Types].xml", "ppt/presentation.xml"];
  const missing = required.filter((n) => !names.includes(n));
  if (missing.length > 0) {
    throw new ValidationError(`PPTX misses required entries: ${missing.sort()}`);
  }
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  if (slides.length < minSlides) {
    throw new ValidationError(`PPTX has ${slides.length} slides, expected at least ${minSlides}`);
  }
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { path, slides: slides.length, sha256: sha };
}
