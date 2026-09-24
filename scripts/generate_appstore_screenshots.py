#!/usr/bin/env python3
"""
Generate App Store screenshot assets from raw app screenshots.

Usage:
  python3 scripts/generate_appstore_screenshots.py \
    --inputs-dir ./appstore-inputs \
    --output-dir ./appstore-output

Optional:
  --config ./appstore_shots.json
  --font /path/to/font.ttf
  --device-set iphone,ipad

Config format (JSON):
{
  "shots": [
    {
      "id": "01_home",
      "input": "home.png",
      "headline": "Never Forget the People Who Matter",
      "subtitle": "Capture moments, names, dates, and details in seconds."
    }
  ]
}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import re

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    print("Pillow is required. Install it with: pip3 install pillow")
    sys.exit(1)


SIZE_PRESETS: dict[str, list[tuple[int, int]]] = {
    "iphone": [
        (1242, 2688),
        (1284, 2778),
    ],
    "ipad": [
        (2064, 2752),
        (2048, 2732),
    ],
    "watch": [
        (422, 514),
        (410, 502),
        (416, 496),
        (396, 484),
        (368, 448),
        (312, 390),
    ],
}

BG_COLOR = (244, 247, 252)
HEADLINE_COLOR = (23, 33, 52)
SUBTITLE_COLOR = (79, 89, 109)
CARD_BG = (255, 255, 255)


@dataclass
class Shot:
    id: str
    input_file: str
    headline: str
    subtitle: str


DEFAULT_SHOTS = [
    Shot(
        id="01_home",
        input_file="home.png",
        headline="Never Forget the People Who Matter",
        subtitle="Capture moments, names, dates, and details in seconds.",
    ),
    Shot(
        id="02_people",
        input_file="people.png",
        headline="Rich Relationship Profiles, Automatically",
        subtitle="Sessions become organized profiles with key details and memory cues.",
    ),
    Shot(
        id="03_calendar",
        input_file="calendar.png",
        headline="See Every Important Date at a Glance",
        subtitle="Track conversations, events, and follow-ups on one smart calendar.",
    ),
    Shot(
        id="04_record",
        input_file="record.png",
        headline="Capture Interactions Instantly",
        subtitle="Type or speak your notes and let ToHim structure what matters.",
    ),
    Shot(
        id="05_ask",
        input_file="ask.png",
        headline="Ask Questions, Get Instant Memory Recall",
        subtitle="Use AI to surface what someone said, when, and why it matters.",
    ),
]


def load_font(size: int, font_path: str | None = None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path:
        return ImageFont.truetype(font_path, size=size)
    for candidate in ["DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Arial.ttf"]:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def load_regular_font(size: int, font_path: str | None = None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path:
        return ImageFont.truetype(font_path, size=size)
    for candidate in ["DejaVuSans.ttf", "Arial.ttf"]:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        trial = f"{line} {word}".strip()
        bbox = draw.textbbox((0, 0), trial, font=font)
        width = bbox[2] - bbox[0]
        if width <= max_width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def draw_centered_lines(
    draw: ImageDraw.ImageDraw,
    lines: Iterable[str],
    y_start: int,
    canvas_width: int,
    font: ImageFont.ImageFont,
    color: tuple[int, int, int],
    line_spacing: int,
) -> int:
    y = y_start
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_width = bbox[2] - bbox[0]
        line_height = bbox[3] - bbox[1]
        x = (canvas_width - line_width) // 2
        draw.text((x, y), line, fill=color, font=font)
        y += line_height + line_spacing
    return y


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))


def trim_lines(lines: list[str], max_lines: int) -> list[str]:
    if len(lines) <= max_lines:
        return lines
    trimmed = lines[:max_lines]
    if trimmed[-1] and not trimmed[-1].endswith("..."):
        trimmed[-1] = trimmed[-1].rstrip(".") + "..."
    return trimmed


def render_one(
    source_path: Path,
    output_path: Path,
    headline: str,
    subtitle: str,
    target_size: tuple[int, int],
    font_path: str | None = None,
) -> None:
    width, height = target_size
    canvas = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(canvas)

    is_compact = width <= 500 or height <= 700
    headline_size = clamp(int(width * (0.07 if is_compact else 0.053)), 14, 88)
    subtitle_size = clamp(int(width * (0.045 if is_compact else 0.031)), 11, 46)
    headline_font = load_font(headline_size, font_path)
    subtitle_font = load_regular_font(subtitle_size, font_path)

    text_margin = int(width * (0.07 if is_compact else 0.09))
    headline_lines = wrap_text(draw, headline, headline_font, width - (text_margin * 2))
    subtitle_lines = wrap_text(draw, subtitle, subtitle_font, width - (text_margin * 2))
    headline_lines = trim_lines(headline_lines, 2 if is_compact else 3)
    subtitle_lines = trim_lines(subtitle_lines, 1 if is_compact else 3)

    y = int(height * (0.05 if is_compact else 0.08))
    y = draw_centered_lines(
        draw,
        headline_lines,
        y_start=y,
        canvas_width=width,
        font=headline_font,
        color=HEADLINE_COLOR,
        line_spacing=4 if is_compact else 10,
    )
    y += int(height * (0.008 if is_compact else 0.014))
    y = draw_centered_lines(
        draw,
        subtitle_lines,
        y_start=y,
        canvas_width=width,
        font=subtitle_font,
        color=SUBTITLE_COLOR,
        line_spacing=3 if is_compact else 8,
    )

    card_top = y + int(height * (0.02 if is_compact else 0.035))
    card_bottom_margin = int(height * (0.03 if is_compact else 0.055))
    card_left = int(width * (0.04 if is_compact else 0.06))
    card_right = int(width * (0.96 if is_compact else 0.94))
    card_bottom = height - card_bottom_margin
    card_w = card_right - card_left
    card_h = card_bottom - card_top

    min_card_h = int(height * 0.45)
    if card_h < min_card_h:
        card_top = max(int(height * 0.18), card_bottom - min_card_h)
        card_h = card_bottom - card_top

    if card_h <= 4:
        card_top = int(height * 0.2)
        card_bottom = int(height * 0.95)
        card_h = card_bottom - card_top

    card_radius = max(6, int(width * 0.04))

    shadow = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (0, 0, card_w, card_h),
        radius=card_radius,
        fill=(15, 31, 52, 45),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=18))
    canvas.paste(shadow, (card_left, card_top + 12), shadow)

    card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card)
    card_draw.rounded_rectangle((0, 0, card_w, card_h), radius=card_radius, fill=CARD_BG + (255,))
    canvas.paste(card, (card_left, card_top), card)

    src = Image.open(source_path).convert("RGB")
    inner_pad = max(3, int(width * 0.026))
    inner_w = max(1, card_w - (inner_pad * 2))
    inner_h = max(1, card_h - (inner_pad * 2))

    src_ratio = src.width / src.height
    inner_ratio = inner_w / inner_h
    if src_ratio > inner_ratio:
        fit_w = inner_w
        fit_h = int(inner_w / src_ratio)
    else:
        fit_h = inner_h
        fit_w = int(inner_h * src_ratio)
    src = src.resize((fit_w, fit_h), Image.Resampling.LANCZOS)

    holder = Image.new("RGB", (inner_w, inner_h), (236, 240, 248))
    paste_x = (inner_w - fit_w) // 2
    paste_y = (inner_h - fit_h) // 2
    holder.paste(src, (paste_x, paste_y))

    screen_radius = int(width * 0.03)
    screen_mask = rounded_mask((inner_w, inner_h), radius=screen_radius)
    screen_x = card_left + inner_pad
    screen_y = card_top + inner_pad
    canvas.paste(holder, (screen_x, screen_y), screen_mask)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)


def load_shots_from_config(config_path: Path) -> list[Shot]:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    shots = []
    for item in data.get("shots", []):
        shots.append(
            Shot(
                id=item["id"],
                input_file=item["input"],
                headline=item["headline"],
                subtitle=item["subtitle"],
            )
        )
    if not shots:
        raise ValueError("Config file has no shots.")
    return shots


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate App Store screenshot assets.")
    parser.add_argument("--inputs-dir", required=True, help="Directory with source screenshot PNG/JPG files.")
    parser.add_argument("--output-dir", required=True, help="Directory to write generated App Store images.")
    parser.add_argument("--config", help="Optional JSON config for shots/headlines.")
    parser.add_argument("--font", help="Optional path to a .ttf font used for text.")
    parser.add_argument(
        "--device-set",
        default="iphone",
        help=(
            "Comma-separated target sets: iphone,ipad,watch. "
            "Example: --device-set iphone,ipad"
        ),
    )
    return parser.parse_args()


def parse_target_sizes(device_set_arg: str) -> list[tuple[int, int]]:
    names = [x.strip().lower() for x in device_set_arg.split(",") if x.strip()]
    if not names:
        raise ValueError("No device set provided.")

    unknown = [name for name in names if name not in SIZE_PRESETS]
    if unknown:
        valid = ", ".join(sorted(SIZE_PRESETS.keys()))
        raise ValueError(f"Unknown device set(s): {', '.join(unknown)}. Valid options: {valid}")

    sizes: list[tuple[int, int]] = []
    for name in names:
        for size in SIZE_PRESETS[name]:
            if size not in sizes:
                sizes.append(size)
    return sizes


def device_name_for_size(size: tuple[int, int]) -> str:
    for device_name, sizes in SIZE_PRESETS.items():
        if size in sizes:
            return device_name
    return "unknown"


def shot_name_from_id(shot_id: str) -> str:
    # Converts "03_calendar" -> "calendar"
    cleaned = re.sub(r"^\d+[_-]?", "", shot_id)
    cleaned = cleaned.strip().lower().replace(" ", "_").replace("-", "_")
    return cleaned or shot_id.lower()


def main() -> int:
    args = parse_args()
    inputs_dir = Path(args.inputs_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not inputs_dir.exists():
        print(f"Inputs directory not found: {inputs_dir}")
        return 1

    if args.config:
        shots = load_shots_from_config(Path(args.config).expanduser().resolve())
    else:
        shots = DEFAULT_SHOTS

    try:
        target_sizes = parse_target_sizes(args.device_set)
    except ValueError as exc:
        print(str(exc))
        return 1

    missing_files = [s.input_file for s in shots if not (inputs_dir / s.input_file).exists()]
    if missing_files:
        print("Missing input files:")
        for f in missing_files:
            print(f"  - {f}")
        print("\nExpected defaults: home.png, people.png, calendar.png, record.png, ask.png")
        return 1

    print(f"Generating {len(shots)} shots into: {output_dir}")
    print(f"Target sizes: {', '.join(f'{w}x{h}' for w, h in target_sizes)}")
    for shot in shots:
        src = inputs_dir / shot.input_file
        for w, h in target_sizes:
            device_name = device_name_for_size((w, h))
            shot_name = shot_name_from_id(shot.id)
            out = output_dir / f"{device_name}_{shot_name}_{w}x{h}.png"
            render_one(
                source_path=src,
                output_path=out,
                headline=shot.headline,
                subtitle=shot.subtitle,
                target_size=(w, h),
                font_path=args.font,
            )
            print(f"  created: {os.path.relpath(out, Path.cwd())}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
