"""RIFE 4.26 補幀（慢動作用），自成一檔、不 import 下載來的程式碼。

網路結構依作者公開的 IFNet_HDv3（RIFE v4.26，MIT，https://github.com/hzwer/Practical-RIFE）逐層重寫，
只保留推論需要的部分。權重 flownet.pkl 取自作者的 HuggingFace（https://huggingface.co/hzwer/RIFE，
RIFEv4.26_0921.zip），解壓到 output/anniversary-film/rife/（已 gitignore），用 `weights_only=True`
載入：只還原張量，不執行 pickle 裡的任何程式。只在 CPU 上跑。

    r = Rife()
    mid = r(img0, img1, t)   # img0/img1: HxWx3 uint8，t: 0~1
"""
from __future__ import annotations

import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

WEIGHTS = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'output', 'anniversary-film',
                                       'rife', 'RIFEv4.26_0921', 'flownet.pkl'))

torch.set_grad_enabled(False)
torch.set_num_threads(max(1, int(os.environ.get('RIFE_THREADS', '3'))))

_grid: dict = {}


def warp(x: torch.Tensor, flow: torch.Tensor) -> torch.Tensor:
    k = (str(flow.device), str(flow.size()))
    if k not in _grid:
        n, _, h, w = flow.shape
        gx = torch.linspace(-1.0, 1.0, w).view(1, 1, 1, w).expand(n, -1, h, -1)
        gy = torch.linspace(-1.0, 1.0, h).view(1, 1, h, 1).expand(n, -1, -1, w)
        _grid[k] = torch.cat([gx, gy], 1)
    flow = torch.cat([flow[:, 0:1] / ((x.shape[3] - 1.0) / 2.0), flow[:, 1:2] / ((x.shape[2] - 1.0) / 2.0)], 1)
    g = (_grid[k] + flow).permute(0, 2, 3, 1)
    return F.grid_sample(x, g, mode='bilinear', padding_mode='border', align_corners=True)


def conv(cin: int, cout: int, k: int = 3, s: int = 1, p: int = 1) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(cin, cout, k, s, p, bias=True), nn.LeakyReLU(0.2, True))


class Head(nn.Module):
    def __init__(self):
        super().__init__()
        self.cnn0 = nn.Conv2d(3, 16, 3, 2, 1)
        self.cnn1 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn2 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn3 = nn.ConvTranspose2d(16, 4, 4, 2, 1)
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        x = self.relu(self.cnn0(x))
        x = self.relu(self.cnn1(x))
        x = self.relu(self.cnn2(x))
        return self.cnn3(x)


class ResConv(nn.Module):
    def __init__(self, c: int):
        super().__init__()
        self.conv = nn.Conv2d(c, c, 3, 1, 1)
        self.beta = nn.Parameter(torch.ones((1, c, 1, 1)))
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        return self.relu(self.conv(x) * self.beta + x)


class IFBlock(nn.Module):
    def __init__(self, cin: int, c: int):
        super().__init__()
        self.conv0 = nn.Sequential(conv(cin, c // 2, 3, 2, 1), conv(c // 2, c, 3, 2, 1))
        self.convblock = nn.Sequential(*[ResConv(c) for _ in range(8)])
        self.lastconv = nn.Sequential(nn.ConvTranspose2d(c, 4 * 13, 4, 2, 1), nn.PixelShuffle(2))

    def forward(self, x, flow=None, scale=1.0):
        x = F.interpolate(x, scale_factor=1.0 / scale, mode='bilinear', align_corners=False)
        if flow is not None:
            flow = F.interpolate(flow, scale_factor=1.0 / scale, mode='bilinear', align_corners=False) / scale
            x = torch.cat((x, flow), 1)
        tmp = self.lastconv(self.convblock(self.conv0(x)))
        tmp = F.interpolate(tmp, scale_factor=scale, mode='bilinear', align_corners=False)
        return tmp[:, :4] * scale, tmp[:, 4:5], tmp[:, 5:]


class IFNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.block0 = IFBlock(7 + 8, c=192)
        self.block1 = IFBlock(8 + 4 + 8 + 8, c=128)
        self.block2 = IFBlock(8 + 4 + 8 + 8, c=96)
        self.block3 = IFBlock(8 + 4 + 8 + 8, c=64)
        self.block4 = IFBlock(8 + 4 + 8 + 8, c=32)
        self.encode = Head()

    def forward(self, img0, img1, timestep: float, scale_list):
        t = (img0[:, :1] * 0 + 1) * timestep
        f0, f1 = self.encode(img0), self.encode(img1)
        blocks = [self.block0, self.block1, self.block2, self.block3, self.block4]
        flow = mask = feat = None
        w0, w1 = img0, img1
        for i, blk in enumerate(blocks):
            if flow is None:
                flow, mask, feat = blk(torch.cat((img0, img1, f0, f1, t), 1), None, scale=scale_list[i])
            else:
                wf0, wf1 = warp(f0, flow[:, :2]), warp(f1, flow[:, 2:4])
                fd, mask, feat = blk(torch.cat((w0, w1, wf0, wf1, t, mask, feat), 1), flow, scale=scale_list[i])
                flow = flow + fd
            w0, w1 = warp(img0, flow[:, :2]), warp(img1, flow[:, 2:4])
        m = torch.sigmoid(mask)
        return w0 * m + w1 * (1 - m)


class Rife:
    def __init__(self, scale: float = 1.0):
        self.net = IFNet()
        sd = torch.load(WEIGHTS, map_location='cpu', weights_only=True)
        sd = {k.replace('module.', ''): v for k, v in sd.items()}
        missing, unexpected = self.net.load_state_dict(sd, strict=False)
        unexpected = [k for k in unexpected if not k.startswith(('teacher.', 'caltime.'))]
        if missing or unexpected:
            raise RuntimeError(f'RIFE weights mismatch: missing={missing[:5]} unexpected={unexpected[:5]}')
        self.net.eval()
        self.scale = scale

    @staticmethod
    def _tensor(img: np.ndarray) -> torch.Tensor:
        return torch.from_numpy(np.ascontiguousarray(img)).permute(2, 0, 1).float().unsqueeze(0) / 255.0

    def __call__(self, img0: np.ndarray, img1: np.ndarray, t: float) -> np.ndarray:
        h, w = img0.shape[:2]
        tmp = max(128, int(128 / self.scale))
        ph, pw = ((h - 1) // tmp + 1) * tmp, ((w - 1) // tmp + 1) * tmp
        pad = (0, pw - w, 0, ph - h)
        a, b = F.pad(self._tensor(img0), pad), F.pad(self._tensor(img1), pad)
        s = self.scale
        out = self.net(a, b, t, [16 / s, 8 / s, 4 / s, 2 / s, 1 / s])[0, :, :h, :w].clamp(0, 1)
        return (out.permute(1, 2, 0).numpy() * 255.0 + 0.5).astype(np.uint8)
