#!/usr/bin/env python3
"""從園方原片重製既有 Hero 七個鏡頭；不寫入正式網站素材。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHOTS = [(29.9, 30.64), (30.7, 31.55), (0.15, 1.0), (1.0, 1.7),
         (2.333, 3.6), (4.833, 5.767), (5.767, 6.567)]
RESTORE = "hqdn3d=0.6:0.45:0.9:0.7"
MOTION = "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
DETAIL = "cas=strength=0.18:planes=1"


def run(args):
    subprocess.run(args, check=True)


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    temp = ROOT / "output/hero-video-restoration-20260922/lossless"
    temp.mkdir(parents=True, exist_ok=True)
    source_info = probe(source)
    video = next(s for s in source_info["streams"] if s["codec_type"] == "video")
    if (video["width"], video["height"], video["r_frame_rate"]) != (1080, 1080, "30/1"):
        raise SystemExit("來源須為已確認的 1080×1080、30fps 廣告原片。")

    clips = []
    shot_manifest = []
    for index, (start, end) in enumerate(SHOTS, 1):
        print(f"鏡頭 {index}/7：來源 {start}–{end} 秒", flush=True)
        seek = math.floor(start)
        target = temp / f"shot-{index:02d}.mkv"
        # 大幅揮手、跳躍的光流補幀會產生雙手／輪廓重影；這兩鏡保留真實來源幀。
        # 裁到既有補幀長度，讓七鏡頭切點與 11.7 秒循環維持一致。
        frame_count = (math.ceil(end * 30) - math.ceil(start * 30)) * 2 - 3
        motion = f"fps=30,trim=end_frame={frame_count}" if index in (5, 7) else MOTION
        filters = ",".join([
            f"trim=start={start-seek:.6f}:end={end-seek:.6f}",
            "setpts=(PTS-STARTPTS)*2", "delogo=x=896:y=8:w=176:h=176",
            "crop=1080:800:0:0", RESTORE, motion, DETAIL, "format=yuv420p",
        ])
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2",
             "-ss", str(seek), "-t", str(math.ceil(end)-seek), "-i", str(source),
             "-filter_threads", "2", "-vf", filters, "-an", "-r", "30",
             "-c:v", "ffv1", "-threads", "2", str(target)])
        clips.append(target)
        shot_manifest.append({"shot": index, "source_start": start, "source_end": end,
                              "motion": motion,
                              "duration": probe(target)["format"]["duration"]})

    playlist = temp / "concat.txt"
    playlist.write_text("".join(f"file '{p.name}'\n" for p in clips))
    variants = []
    for name, width, crf in [("hero-restored-master", 1080, 18),
                             ("hero-restored-desktop", 1080, 21),
                             ("hero-restored-mobile", 720, 22)]:
        print(f"輸出 {name}（CRF {crf}）", flush=True)
        target = HERE / f"{name}.mp4"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2",
             "-f", "concat", "-safe", "0", "-i", str(playlist), "-filter_threads", "2",
             "-vf", f"scale={width}:-2:flags=lanczos,setsar=1,format=yuv420p",
             "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow",
             "-crf", str(crf), "-threads", "2", "-movflags", "+faststart", str(target)])
        info = probe(target)
        stream = info["streams"][0]
        assert len(info["streams"]) == 1 and stream["codec_type"] == "video"
        variants.append({"file": target.name, "width": stream["width"], "height": stream["height"],
                         "fps": stream["r_frame_rate"], "frames": stream["nb_frames"],
                         "duration": info["format"]["duration"], "bytes": target.stat().st_size,
                         "crf": crf, "sha256": sha256(target)})
    manifest = {"source_filename": source.name, "source_sha256": sha256(source),
                "crop": "1080:800:0:0", "speed": 0.5, "denoise": RESTORE,
                "motion": MOTION, "detail": DETAIL, "shots": shot_manifest,
                "variants": variants, "status": "preview-only"}
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
