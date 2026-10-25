#!/usr/bin/env python3
"""
AI-Powered Product Catalogue OCR & Image Extraction Pipeline for Technic ERP.

Extracts:
1. Product details (Name, Code/SKU, Brand, Category, Size, Surface, Colour, Material, Pcs/Box, Coverage, Prices, HSN).
2. Product images:
   - Priority 1: Direct embedded image extraction via PyMuPDF with exact coordinates.
   - Priority 2: High-resolution page rendering and contour/region cropping for composite pages.
   - Priority 3: Spatial association with confidence scores and audit metadata.
3. Page previews for side-by-side human verification.
"""

import os
import sys
import json
import re
import math
import argparse
import traceback
from typing import List, Dict, Any, Optional, Tuple

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF (fitz) is not installed."}), file=sys.stderr)
    sys.exit(1)

try:
    from PIL import Image, ImageOps
except ImportError:
    print(json.dumps({"error": "Pillow (PIL) is not installed."}), file=sys.stderr)
    sys.exit(1)

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

# Known standard tile brands in ERP
KNOWN_BRANDS = [
    "Kajaria", "Somany", "Simpolo", "Nitco", "Qutone", "Johnson", 
    "Orientbell", "RAK Ceramics", "Varmora", "Sunhearrt", "Asian Granito",
    "AGL", "Cera", "Hindware", "Technic", "Prestige"
]

# Surface / Finish keywords
KNOWN_SURFACES = [
    "High Gloss", "Super Gloss", "Glossy", "Gloss", "Polished", "Matt", "Matte", 
    "Carving", "Satin", "Sugar", "Rustic", "Lappato", "Bookmatch", "Silk", 
    "Metallic", "Structure", "Wood", "Punch", "Rock", "Anti-Skid"
]

# Materials
KNOWN_MATERIALS = [
    "Glazed Vitrified", "Polished Vitrified", "Double Charge", "Full Body Vitrified", 
    "Vitrified", "Ceramic", "Porcelain", "Digital Wall", "GVT", "PGVT"
]

# Common tile size patterns (e.g. 600x600, 600x1200, 800x1600, 300x450 mm or cm)
SIZE_REGEX = re.compile(
    r"\b(\d{2,4})\s*(?:[xX×*])\s*(\d{2,4})\s*(?:mm|cm|in|inch|inches)?\b",
    re.IGNORECASE
)

# Product code / SKU regex (e.g. PGVT-102, K-8012, MARBLE-01, SL204, G6012, ART-401)
CODE_REGEX = re.compile(
    r"\b([A-Z]{1,6}[-_/ ]?[0-9]{2,6}(?:[-_/ ][A-Z0-9]+)?)\b"
)

# Packing regex
PCS_BOX_REGEX = re.compile(r"(\d+)\s*(?:pcs|pieces|pc|pkts?)\b", re.IGNORECASE)
COVERAGE_REGEX = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m(?:tr)?|sqm|sq\.?\s*ft|sqft)\b", 
    re.IGNORECASE
)
PRICE_REGEX = re.compile(
    r"(?:MRP|Price|Rs\.?|₹)\s*[:.-]?\s*(\d+(?:[.,]\d{2})?)", 
    re.IGNORECASE
)


def safe_strip(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    cleaned = val.strip()
    return cleaned if cleaned else None


def clean_image_margins(pil_img: Image.Image, padding: int = 4) -> Image.Image:
    """Safely crops excessive uniform white or near-white borders."""
    try:
        # Convert to RGB if RGBA/P
        rgb = pil_img.convert("RGB")
        # Invert to make white background dark
        inv = ImageOps.invert(rgb)
        bbox = inv.getbbox()
        if bbox:
            w, h = pil_img.size
            x0 = max(0, bbox[0] - padding)
            y0 = max(0, bbox[1] - padding)
            x1 = min(w, bbox[2] + padding)
            y1 = min(h, bbox[3] + padding)
            # Ensure crop area is at least 30% of original to avoid over-trimming
            if (x1 - x0) * (y1 - y0) >= (w * h * 0.25):
                return pil_img.crop((x0, y0, x1, y1))
    except Exception:
        pass
    return pil_img


def extract_embedded_images(
    doc: fitz.Document, 
    page: fitz.Page, 
    page_no: int, 
    job_id: str, 
    out_dir: str
) -> List[Dict[str, Any]]:
    """Priority 1: Extract real embedded images with page bounding boxes."""
    images = []
    image_list = page.get_images(full=True)
    seen_xrefs = set()

    for img_idx, img_info in enumerate(image_list):
        xref = img_info[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)

        try:
            rects = page.get_image_rects(xref)
            if not rects:
                continue

            rect = rects[0]  # First instance on page
            rect_w = abs(rect.x1 - rect.x0)
            rect_h = abs(rect.y1 - rect.y0)

            # Filter out tiny icons, decorative separators (< 45 pt)
            if rect_w < 45 or rect_h < 45:
                continue

            # Filter extreme thin banner / hairline (< 1:12 aspect ratio)
            ratio = max(rect_w, rect_h) / max(min(rect_w, rect_h), 1)
            if ratio > 10.0:
                continue

            extracted = doc.extract_image(xref)
            if not extracted or not extracted.get("image"):
                continue

            raw_bytes = extracted["image"]
            ext = extracted.get("ext", "png").lower()
            if ext not in ["png", "jpg", "jpeg", "webp"]:
                ext = "png"

            filename = f"img_{job_id}_p{page_no}_{xref}_{img_idx}.{ext}"
            file_path = os.path.join(out_dir, filename)

            # Save and clean image
            with open(file_path, "wb") as f:
                f.write(raw_bytes)

            try:
                with Image.open(file_path) as pimg:
                    pw, ph = pimg.size
                    if pw < 40 or ph < 40:
                        os.remove(file_path)
                        continue
                    trimmed = clean_image_margins(pimg)
                    trimmed.save(file_path)
                    pw, ph = trimmed.size
            except Exception:
                pw, ph = int(rect_w), int(rect_h)

            images.append({
                "id": f"img_p{page_no}_{xref}_{img_idx}",
                "filename": filename,
                "storagePath": f"uploads/catalogues/{job_id}/images/{filename}",
                "url": f"/api/files/catalogues/{job_id}/images/{filename}",
                "sourcePage": page_no,
                "bbox": [round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1)],
                "pixelWidth": pw,
                "pixelHeight": ph,
                "method": "EMBEDDED",
                "aspectRatio": round(pw / max(ph, 1), 2),
            })
        except Exception as e:
            continue

    return images


def extract_composite_crops(
    page_img_path: str, 
    page_no: int, 
    job_id: str, 
    out_dir: str, 
    page_rect: fitz.Rect
) -> List[Dict[str, Any]]:
    """Priority 2: Detect individual product tile regions on composite raster pages."""
    crops = []
    if not HAS_OPENCV:
        return crops

    try:
        img = cv2.imread(page_img_path)
        if img is None:
            return crops

        h, w, _ = img.shape
        scale_x = (page_rect.x1 - page_rect.x0) / float(w)
        scale_y = (page_rect.y1 - page_rect.y0) / float(h)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Apply bilateral filter to keep edges sharp while smoothing background
        blurred = cv2.bilateralFilter(gray, 7, 50, 50)
        edges = cv2.Canny(blurred, 30, 120)

        # Dilate edges to close contours of tile panels
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        dilated = cv2.dilate(edges, kernel, iterations=2)

        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (w * h) * 0.02  # At least 2% of page area
        max_area = (w * h) * 0.75  # Not the entire page

        crop_idx = 0
        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            area = cw * ch
            if area < min_area or area > max_area:
                continue

            aspect = float(cw) / float(max(ch, 1))
            if aspect < 0.25 or aspect > 4.0:
                continue

            # Ensure this box doesn't include mostly empty borders
            tile_crop = img[y:y+ch, x:x+cw]
            if tile_crop.size == 0:
                continue

            crop_filename = f"crop_{job_id}_p{page_no}_{crop_idx}.jpg"
            crop_path = os.path.join(out_dir, crop_filename)
            cv2.imwrite(crop_path, tile_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

            pdf_x0 = round(x * scale_x, 1)
            pdf_y0 = round(y * scale_y, 1)
            pdf_x1 = round((x + cw) * scale_x, 1)
            pdf_y1 = round((y + ch) * scale_y, 1)

            crops.append({
                "id": f"crop_p{page_no}_{crop_idx}",
                "filename": crop_filename,
                "storagePath": f"uploads/catalogues/{job_id}/images/{crop_filename}",
                "url": f"/api/files/catalogues/{job_id}/images/{crop_filename}",
                "sourcePage": page_no,
                "bbox": [pdf_x0, pdf_y0, pdf_x1, pdf_y1],
                "pixelWidth": cw,
                "pixelHeight": ch,
                "method": "PAGE_CROP",
                "aspectRatio": round(aspect, 2),
            })
            crop_idx += 1
    except Exception:
        pass

    return crops


def extract_tile_specifications(text: str) -> Dict[str, Any]:
    """Extracts size, surface, packaging, and commercial fields from text snippet."""
    specs: Dict[str, Any] = {
        "size": None,
        "surface": None,
        "material": None,
        "color": None,
        "piecesPerBox": None,
        "coveragePerBox": None,
        "mrp": None,
        "sellingPrice": None,
        "hsnCode": "6907",
        "gstRate": 18,
        "unit": "box",
    }

    # Size
    size_match = SIZE_REGEX.search(text)
    if size_match:
        dim1, dim2 = size_match.group(1), size_match.group(2)
        specs["size"] = f"{dim1}x{dim2} mm"

    # Surface
    surf_explicit = re.search(r"Surface\s*(?:/\s*Finish)?\s*[:.-]\s*([^\n·,;]+)", text, re.IGNORECASE)
    if surf_explicit:
        specs["surface"] = surf_explicit.group(1).strip()
    else:
        for surface in sorted(KNOWN_SURFACES, key=len, reverse=True):
            if re.search(r"\b" + re.escape(surface) + r"\b", text, re.IGNORECASE):
                specs["surface"] = surface
                break

    # Material
    mat_explicit = re.search(r"Material\s*[:.-]\s*([^\n·,;]+)", text, re.IGNORECASE)
    if mat_explicit:
        specs["material"] = mat_explicit.group(1).strip()
    else:
        for mat in sorted(KNOWN_MATERIALS, key=len, reverse=True):
            if re.search(r"\b" + re.escape(mat) + r"\b", text, re.IGNORECASE):
                specs["material"] = mat
                break

    # Pieces per box
    pcs_match = PCS_BOX_REGEX.search(text)
    if pcs_match:
        try:
            specs["piecesPerBox"] = int(pcs_match.group(1))
        except ValueError:
            pass

    # Coverage per box
    cov_match = COVERAGE_REGEX.search(text)
    if cov_match:
        try:
            specs["coveragePerBox"] = float(cov_match.group(1))
        except ValueError:
            pass

    # Price / MRP
    price_match = PRICE_REGEX.search(text)
    if price_match:
        try:
            p_val = float(price_match.group(1).replace(",", ""))
            specs["mrp"] = p_val
            specs["sellingPrice"] = p_val
        except ValueError:
            pass

    return specs


def detect_brand(text: str, fallback_brand: Optional[str] = None) -> Optional[str]:
    """Finds matching known brand in text or header."""
    for brand in KNOWN_BRANDS:
        if re.search(r"\b" + re.escape(brand) + r"\b", text, re.IGNORECASE):
            return brand
    return fallback_brand


def compute_spatial_association(
    product_bbox: List[float], 
    images: List[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, Any]], float, List[Dict[str, Any]]]:
    """Associates product card with nearest / containing image and returns confidence."""
    if not images:
        return None, 0.0, []

    px0, py0, px1, py1 = product_bbox
    p_center_x = (px0 + px1) / 2.0
    p_center_y = (py0 + py1) / 2.0

    scored = []
    for img in images:
        ix0, iy0, ix1, iy1 = img["bbox"]
        i_center_x = (ix0 + ix1) / 2.0
        i_center_y = (iy0 + iy1) / 2.0

        # Distance between centers
        dist = math.hypot(p_center_x - i_center_x, p_center_y - i_center_y)

        # Check column alignment (x overlap)
        x_overlap = max(0.0, min(px1, ix1) - max(px0, ix0))
        y_overlap = max(0.0, min(py1, iy1) - max(py0, iy0))

        confidence = 1.0 / (1.0 + (dist / 300.0))
        if x_overlap > 20:
            confidence += 0.25
        if y_overlap > 10:
            confidence += 0.15

        confidence = min(0.99, max(0.1, confidence))
        scored.append((confidence, dist, img))

    # Sort descending by confidence, then distance
    scored.sort(key=lambda item: (-item[0], item[1]))

    best_conf, _, best_img = scored[0]
    alternate_images = [item[2] for item in scored[1:4]]
    return best_img, round(best_conf, 2), alternate_images


def parse_page(
    doc: fitz.Document,
    page_no: int,
    job_id: str,
    out_dir: str,
    doc_brand: Optional[str] = None
) -> Dict[str, Any]:
    """Extracts text, images, and products for a single page."""
    page = doc[page_no - 1]
    page_rect = page.rect

    # 1. Render page preview PNG for user verification
    page_preview_name = f"page_{job_id}_p{page_no}.png"
    page_preview_path = os.path.join(out_dir, page_preview_name)
    pix = page.get_pixmap(dpi=150)
    pix.save(page_preview_path)
    page_preview_url = f"/api/files/catalogues/{job_id}/images/{page_preview_name}"

    # 2. Extract text blocks
    text_blocks = page.get_text("blocks")
    total_text = "".join(b[4] for b in text_blocks).strip()
    is_scanned = len(total_text) < 40

    # 3. Extract images (Priority 1: Embedded, Priority 2: Composite Page Crops)
    extracted_images = extract_embedded_images(doc, page, page_no, job_id, out_dir)
    if not extracted_images:
        extracted_images = extract_composite_crops(page_preview_path, page_no, job_id, out_dir, page_rect)

    page_brand = detect_brand(total_text, doc_brand)

    # 4. Identify product candidates on this page
    products = []
    
    # Analyze text blocks to find product card blocks
    # A tile product card usually contains a code (SKU/Model), a name, or specifications
    # Identify code anchors
    code_anchors = []
    other_blocks = []
    for b in text_blocks:
        bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4].strip()
        if not btext or len(btext) < 2:
            continue
        if by1 < 75 and ("catalogue" in btext.lower() or "collection" in btext.lower() or "series" in btext.lower()):
            continue
        if CODE_REGEX.search(btext):
            code_anchors.append(b)
        else:
            other_blocks.append(b)

    card_candidates = []
    if code_anchors:
        assigned_others = set()
        for anc in code_anchors:
            ax0, ay0, ax1, ay1 = anc[0], anc[1], anc[2], anc[3]
            cluster = [anc]
            for idx, ob in enumerate(other_blocks):
                if idx in assigned_others:
                    continue
                ox0, oy0, ox1, oy1 = ob[0], ob[1], ob[2], ob[3]
                # Within vertical proximity (< 100 pt) and roughly same column (< 160 pt)
                vert_dist = min(abs(oy0 - ay1), abs(ay0 - oy1), abs(oy0 - ay0))
                horiz_dist = abs(ox0 - ax0)
                if vert_dist < 100 and horiz_dist < 160:
                    cluster.append(ob)
                    assigned_others.add(idx)
            cluster.sort(key=lambda item: (item[1], item[0]))
            merged_text = "\n".join(item[4].strip() for item in cluster)
            cx0 = min(item[0] for item in cluster)
            cy0 = min(item[1] for item in cluster)
            cx1 = max(item[2] for item in cluster)
            cy1 = max(item[3] for item in cluster)
            card_candidates.append({
                "bbox": [cx0, cy0, cx1, cy1],
                "text": merged_text,
                "has_code": True,
            })
    else:
        for b in text_blocks:
            bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4].strip()
            if not btext or len(btext) < 3:
                continue
            card_candidates.append({
                "bbox": [bx0, by0, bx1, by1],
                "text": btext,
                "has_code": False,
            })

    # If no structured text cards found but images exist, create candidate per image
    if not card_candidates and extracted_images:
        for idx, img in enumerate(extracted_images):
            card_candidates.append({
                "bbox": img["bbox"],
                "text": f"Product Sample {idx + 1}",
                "has_code": False,
            })

    # Process each card into a product record
    for card_idx, card in enumerate(card_candidates):
        card_text = card["text"]
        lines = [l.strip() for l in card_text.splitlines() if l.strip()]
        first_line = lines[0] if lines else "Tile Product"
        code_match = CODE_REGEX.search(card_text)
        sku = code_match.group(1).upper() if code_match else f"PRD-P{page_no}-{card_idx + 1}"

        # Extract Name: find the best non-code, non-spec, non-header line
        name = None
        for l in lines:
            l_clean = l.strip()
            # Skip if it is the product code
            if code_match and l_clean.upper() == code_match.group(1).upper():
                continue
            # Skip if it's a spec line
            if any(l_clean.lower().startswith(prefix) for prefix in ["size", "surface", "material", "mrp", "price", "hsn", "gst", "pcs", "coverage"]):
                continue
            # Skip catalogue/series headers
            if any(w in l_clean.lower() for w in ["catalogue", "collection", "brochure", "edition", "architectural"]):
                continue
            if len(l_clean) >= 3:
                name = l_clean
                break
        if not name:
            name = first_line
        if len(name) > 60:
            name = name[:60]

        # Extract specs
        specs = extract_tile_specifications(card_text)
        
        # Fallback to page-level specs if not on card
        if not specs["size"]:
            page_specs = extract_tile_specifications(total_text)
            if page_specs["size"]:
                specs["size"] = page_specs["size"]
            if not specs["surface"] and page_specs["surface"]:
                specs["surface"] = page_specs["surface"]
            if not specs["material"] and page_specs["material"]:
                specs["material"] = page_specs["material"]

        # Category determination
        category = "Floor Tiles"
        subcategory = specs.get("material") or "Vitrified Tiles"
        if "wall" in card_text.lower() or "wall" in total_text.lower():
            category = "Wall Tiles"
            subcategory = "Ceramic Wall"
        elif "outdoor" in card_text.lower() or "parking" in card_text.lower():
            category = "Outdoor Tiles"
            subcategory = "Heavy Duty"
        elif "slab" in card_text.lower() or (specs.get("size") and "1600" in specs["size"]):
            category = "Slab Tiles"
            subcategory = "Large Format"

        # Spatial image association
        best_img, conf, alts = compute_spatial_association(card["bbox"], extracted_images)

        warnings = []
        if not code_match:
            warnings.append("Product code generated automatically; verify code.")
        if not best_img:
            warnings.append("No matching product image found on page.")
        elif conf < 0.60:
            warnings.append(f"Low image matching confidence ({int(conf * 100)}%); verify image.")
        if not specs["size"]:
            warnings.append("Size/dimension not detected in text.")

        images_payload = []
        if best_img:
            images_payload.append({
                **best_img,
                "isPrimary": True,
                "confidence": conf
            })
        for alt in alts:
            images_payload.append({
                **alt,
                "isPrimary": False,
                "confidence": 0.50
            })

        # Attributes list for flexible ERP specifications
        attributes = []
        if specs.get("size"):
            attributes.append({"name": "Size", "value": specs["size"]})
        if specs.get("surface"):
            attributes.append({"name": "Surface / Finish", "value": specs["surface"]})
        if specs.get("material"):
            attributes.append({"name": "Material", "value": specs["material"]})
        if specs.get("piecesPerBox"):
            attributes.append({"name": "Pieces per Box", "value": str(specs["piecesPerBox"])})
        if specs.get("coveragePerBox"):
            attributes.append({"name": "Coverage per Box", "value": f"{specs['coveragePerBox']} Sqm"})

        products.append({
            "sourcePage": page_no,
            "productCode": sku,
            "productName": name,
            "brandName": page_brand,
            "categoryName": category,
            "subcategory": subcategory,
            "size": specs.get("size"),
            "surface": specs.get("surface"),
            "color": specs.get("color"),
            "material": specs.get("material"),
            "unit": specs.get("unit") or "box",
            "piecesPerBox": specs.get("piecesPerBox"),
            "coveragePerBox": specs.get("coveragePerBox"),
            "mrp": specs.get("mrp") or 0.0,
            "purchasePrice": specs.get("purchasePrice") or 0.0,
            "sellingPrice": specs.get("sellingPrice") or 0.0,
            "gstRate": specs.get("gstRate") or 18.0,
            "hsnCode": specs.get("hsnCode") or "6907",
            "description": f"{name} - {specs.get('size') or ''} {specs.get('surface') or ''}".strip(),
            "confidence": conf if best_img else 0.50,
            "reviewWarnings": warnings,
            "attributes": attributes,
            "rawText": card_text,
            "primaryImageUrl": best_img["url"] if best_img else None,
            "images": images_payload,
        })

    return {
        "pageNo": page_no,
        "width": page_rect.width,
        "height": page_rect.height,
        "isScanned": is_scanned,
        "previewUrl": page_preview_url,
        "previewPath": page_preview_path,
        "brand": page_brand,
        "products": products,
        "extractedImagesCount": len(extracted_images)
    }


def main():
    parser = argparse.ArgumentParser(description="ERP Catalogue OCR and Image Extractor")
    parser.add_argument("--pdf", required=True, help="Path to source PDF catalogue")
    parser.add_argument("--output-dir", required=True, help="Directory to save extracted images and results")
    parser.add_argument("--job-id", required=True, help="Unique import job ID")
    parser.add_argument("--start-page", type=int, default=1, help="Start page (1-based)")
    parser.add_argument("--end-page", type=int, default=0, help="End page (1-based, 0 = all)")
    args = parser.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    out_dir = os.path.abspath(args.output_dir)
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.isfile(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Cannot open PDF: {str(e)}"}))
        sys.exit(1)

    total_pages = len(doc)
    start_p = max(1, args.start_page)
    end_p = total_pages if args.end_page <= 0 else min(total_pages, args.end_page)

    # Initial quick scan for document brand across first 3 pages
    doc_brand = None
    for p_idx in range(min(3, total_pages)):
        header_text = doc[p_idx].get_text()
        doc_brand = detect_brand(header_text)
        if doc_brand:
            break

    pages_result = []
    all_products = []
    for p in range(start_p, end_p + 1):
        try:
            page_data = parse_page(doc, p, args.job_id, out_dir, doc_brand)
            pages_result.append({
                "pageNo": page_data["pageNo"],
                "isScanned": page_data["isScanned"],
                "previewUrl": page_data["previewUrl"],
                "brand": page_data["brand"],
                "productCount": len(page_data["products"]),
                "imageCount": page_data["extractedImagesCount"]
            })
            all_products.extend(page_data["products"])
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            pages_result.append({
                "pageNo": p,
                "error": str(e),
                "productCount": 0,
                "imageCount": 0
            })

    output_payload = {
        "jobId": args.job_id,
        "totalPages": total_pages,
        "processedStartPage": start_p,
        "processedEndPage": end_p,
        "documentBrand": doc_brand,
        "totalProducts": len(all_products),
        "pages": pages_result,
        "products": all_products,
    }

    # Save extraction JSON into output directory
    json_path = os.path.join(out_dir, "extraction_result.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=2, ensure_ascii=False)

    # Output to stdout for caller
    print(json.dumps(output_payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
