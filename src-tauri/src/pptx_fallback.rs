use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use zip::ZipArchive;

#[derive(Serialize)]
pub struct ExtractedSlide {
    pub index: usize,
    pub title: String,
    pub paragraphs: Vec<String>,
    pub images: Vec<String>, // data:image/...;base64,...
}

/// Pure-Rust fallback extractor for .pptx files when LibreOffice / PowerPoint are not installed.
/// Reads ppt/slides/slideN.xml, extracts text runs (<a:t>) and linked embedded images via .rels.
pub fn extract_slides(path: &str) -> Result<Vec<ExtractedSlide>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open PPTX: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid PPTX archive: {}", e))?;

    // Collect slide XML paths sorted numerically (slide1.xml, slide2.xml, ...)
    let mut slide_entries: Vec<(usize, String)> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                let num_str = name
                    .trim_start_matches("ppt/slides/slide")
                    .trim_end_matches(".xml");
                if let Ok(num) = num_str.parse::<usize>() {
                    slide_entries.push((num, name));
                }
            }
        }
    }
    slide_entries.sort_by_key(|(num, _)| *num);

    if slide_entries.is_empty() {
        return Err("No slides found inside PPTX archive.".to_string());
    }

    // Cache media files in ppt/media/
    let mut media_map: HashMap<String, String> = HashMap::new();
    for i in 0..archive.len() {
        if let Ok(mut entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if name.starts_with("ppt/media/") {
                let mime = guess_mime(&name);
                if let Some(mime_str) = mime {
                    let mut buf = Vec::new();
                    if entry.read_to_end(&mut buf).is_ok() {
                        let b64 = STANDARD.encode(&buf);
                        media_map.insert(name, format!("data:{};base64,{}", mime_str, b64));
                    }
                }
            }
        }
    }

    let mut slides = Vec::new();
    for (num, slide_path) in slide_entries {
        let mut xml = String::new();
        if let Ok(mut f) = archive.by_name(&slide_path) {
            let _ = f.read_to_string(&mut xml);
        }

        let paragraphs = extract_paragraphs(&xml);
        let title = paragraphs.first().cloned().unwrap_or_else(|| format!("Slide {}", num));
        let body = if paragraphs.len() > 1 {
            paragraphs[1..].to_vec()
        } else {
            Vec::new()
        };

        // Check slide relationships for embedded media
        let rels_path = format!("ppt/slides/_rels/slide{}.xml.rels", num);
        let mut images = Vec::new();
        if let Ok(mut rf) = archive.by_name(&rels_path) {
            let mut rels_xml = String::new();
            if rf.read_to_string(&mut rels_xml).is_ok() {
                for target in extract_media_targets(&rels_xml) {
                    let normalized = if target.starts_with("../media/") {
                        format!("ppt/{}", target.trim_start_matches("../"))
                    } else {
                        target
                    };
                    if let Some(data_url) = media_map.get(&normalized) {
                        images.push(data_url.clone());
                    }
                }
            }
        }

        slides.push(ExtractedSlide {
            index: num,
            title,
            paragraphs: body,
            images,
        });
    }

    Ok(slides)
}

fn guess_mime(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".gif") {
        Some("image/gif")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else if lower.ends_with(".svg") {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn extract_paragraphs(xml: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut rest = xml;
    while let Some(p_start) = rest.find("<a:p") {
        rest = &rest[p_start..];
        let Some(p_end) = rest.find("</a:p>") else {
            break;
        };
        let p_block = &rest[..p_end];
        rest = &rest[p_end + 6..];

        let mut text = String::new();
        let mut inner = p_block;
        while let Some(t_start) = inner.find("<a:t") {
            inner = &inner[t_start..];
            let Some(gt) = inner.find('>') else { break };
            inner = &inner[gt + 1..];
            let Some(t_end) = inner.find("</a:t>") else { break };
            let chunk = &inner[..t_end];
            text.push_str(&decode_xml_entities(chunk));
            inner = &inner[t_end + 6..];
        }
        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            paragraphs.push(trimmed);
        }
    }
    paragraphs
}

fn extract_media_targets(rels_xml: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut rest = rels_xml;
    while let Some(pos) = rest.find("Target=\"") {
        rest = &rest[pos + 8..];
        if let Some(end) = rest.find('"') {
            let val = &rest[..end];
            if val.contains("media/") {
                targets.push(val.to_string());
            }
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
    targets
}

fn decode_xml_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}
