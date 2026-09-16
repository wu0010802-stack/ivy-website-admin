#!/bin/sh
# 從園方廣告片剪出首頁主視覺背景片（2026-09-15）。
# 來源：~/Downloads/常春藤廣告+配音.mp4（1080×1080、30fps、55s，含字幕與右上角校徽浮水印）。
# 作法：delogo 抹掉右上角浮水印 → 裁掉底部字幕帶（保留 y 0–800）→ 每個鏡頭放慢 0.5× 並做動態補幀
#       → 依序接起來。
# 用法：sh design/hero-video/build.sh [來源檔] [輸出檔]
set -e
SRC=${1:-"$HOME/Downloads/常春藤廣告+配音.mp4"}
OUT=${2:-assets/hero-campus.mp4}
STILL=${OUT%.mp4}-still.webp
# 鏡頭清單（秒，start end）。開頭是黃衣女孩的笑容（也是海報幀），結尾是另一個鏡頭，
# 所以 loop 接點只是一個普通的剪接點，不會在同一鏡頭內跳格。
# 刻意不用 31.6–32.4 秒（綠色 T 恤大字 VIETNAM 會搶過中文標語）。
SHOTS="29.9 30.64
30.7 31.55
0.15 1.0
1.0 1.7
2.333 3.6
4.833 5.767
5.767 6.567"
MI="minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
n=0; chains=""; labels=""
while read -r a b; do
  [ -z "$a" ] && continue
  chains="$chains[v$n]trim=start=$a:end=$b,setpts=(PTS-STARTPTS)*2,$MI[s$n];"
  labels="$labels[s$n]"
  n=$((n+1))
done <<EOS
$SHOTS
EOS
splits=""; i=0; while [ $i -lt $n ]; do splits="$splits[v$i]"; i=$((i+1)); done
ffmpeg -v error -y -i "$SRC" -filter_complex \
  "[0:v]delogo=x=896:y=8:w=176:h=176,crop=1080:800:0:0,split=$n$splits;$chains${labels}concat=n=$n:v=1:a=0,format=yuv420p[out]" \
  -map "[out]" -an -r 30 -c:v libx264 -profile:v high -crf 26 -preset slow -movflags +faststart "$OUT"
ffmpeg -v error -y -i "$OUT" -frames:v 1 "${STILL%.webp}.png"
python3 -c "from PIL import Image;import sys;Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2],'WEBP',quality=82,method=6)" "${STILL%.webp}.png" "$STILL"
rm -f "${STILL%.webp}.png"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
ls -la "$OUT" "$STILL"
